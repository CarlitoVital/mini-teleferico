// Express-App für Teleférico: Konten, Spielstände, Bestenliste und Auslieferung des Frontends.
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bcrypt from 'bcrypt';
import { openDb } from './db.js';
import { RateLimiter, ipKey } from './ratelimit.js';
import { implausible } from './plausible.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearedSessionCookie,
  cookieValues,
  hashToken,
  isWellFormedToken,
  newToken,
  sessionCookie,
} from './session.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const API_VERSION = 1;
const BODY_LIMIT = '512kb';
// Gespeicherter Spielstand nach erneutem Serialisieren (echte Stände: 10–60 KB)
const MAX_DATA_BYTES = 256 * 1024;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const SLOT_RE = /^[a-z0-9-]{1,40}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const MAX_SLOTS = 20;
const MAX_ACCOUNT_BYTES = 2 * 1024 * 1024; // alle Spielstände eines Kontos zusammen
const MAX_META_CHARS = 4000;
const MAX_DEPTH = 100;
const MAX_SCORE = 10_000_000;
const MAX_WEEK = 999;
const MAX_SEED = 32;
const MAX_AREA = 40;
const MAX_TIME = 86_400; // Spielsekunden – keine Runde dauert annähernd so lange
const MAX_SCORES_PER_USER = 50;
// Öffentlich angezeigter Freitext: Buchstaben (auch mit Akzent), Ziffern, Leerzeichen, wenige Satzzeichen
const LABEL_RE = /^[\p{L}\p{M}\p{N} _.,:#()\/+-]*$/u;
const MINUTE = 60_000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const MSG = {
  loginFailed: 'Benutzername oder Passwort falsch.',
  loginLimited: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.',
  registerLimited: 'Zu viele Registrierungen. Bitte später erneut versuchen.',
  taken: 'Dieser Benutzername ist bereits vergeben.',
  unauthorized: 'Nicht angemeldet.',
  csrf: 'Anfrage von fremder Seite abgelehnt.',
  saveNotFound: 'Spielstand nicht gefunden.',
  apiNotFound: 'Unbekannter API-Endpunkt.',
  badJson: 'Ungültiges JSON.',
  tooLarge: 'Anfrage zu groß (max. 512 KB).',
  savesLimited: 'Zu viele Speichervorgänge. Bitte kurz warten.',
  scoresLimited: 'Zu viele Ergebnisse in kurzer Zeit. Bitte kurz warten.',
  badRequest: 'Ungültige Anfrage.',
  internal: 'Interner Serverfehler.',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const bodyOf = (req) => (isPlainObject(req.body) ? req.body : {});
// IPv6 je /64-Netz, damit wechselnde Adressen aus einem Netz die Limits nicht umgehen
const clientIp = (req) => ipKey(req.ip || req.socket?.remoteAddress);

// bcrypt wertet nur die ersten 72 Byte aus. Vorab per HMAC-SHA-256 auf 44 ASCII-Zeichen verdichten,
// damit jedes Zeichen zählt. Der Schlüssel ist kein Geheimnis, er trennt nur von reinen SHA-256-Hashes.
const PREHASH_KEY = 'teleferico/passwort/v1';
const prehash = (password) => crypto.createHmac('sha256', PREHASH_KEY).update(password, 'utf8').digest('base64');

function checkUsername(u) {
  if (typeof u !== 'string' || !u) return 'Bitte einen Benutzernamen angeben.';
  if (u.trim() !== u) return 'Der Benutzername darf nicht mit Leerzeichen beginnen oder enden.';
  if (!USERNAME_RE.test(u)) return 'Benutzername: 3–24 Zeichen, erlaubt sind A–Z, a–z, 0–9 sowie _ . -';
  return null;
}

function checkPassword(p) {
  if (typeof p !== 'string' || !p) return 'Bitte ein Passwort angeben.';
  if (p.length < PASSWORD_MIN) return `Das Passwort muss mindestens ${PASSWORD_MIN} Zeichen lang sein.`;
  if (p.length > PASSWORD_MAX) return `Das Passwort darf höchstens ${PASSWORD_MAX} Zeichen lang sein.`;
  return null;
}

function checkSlot(slot) {
  if (typeof slot !== 'string' || !SLOT_RE.test(slot)) {
    throw new HttpError(400, 'Ungültiger Speicherplatz (erlaubt: a–z, 0–9 und -, höchstens 40 Zeichen).');
  }
  return slot;
}

/** true, wenn Objekte/Arrays tiefer als max Ebenen verschachtelt sind (ohne Rekursion). */
function nestedDeeper(root, max) {
  const values = [root];
  const depths = [1];
  while (values.length) {
    const v = values.pop();
    const d = depths.pop();
    if (d > max) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      if (child !== null && typeof child === 'object') {
        values.push(child);
        depths.push(d + 1);
      }
    }
  }
  return false;
}

/** Prüft {meta, data} und liefert beides als JSON-Text. */
function parseSaveBody(body) {
  if (!isPlainObject(body)) throw new HttpError(400, 'Erwartet wird ein JSON-Objekt mit „meta“ und „data“.');
  const { meta, data } = body;
  if (!isPlainObject(meta)) throw new HttpError(400, '„meta“ muss ein Objekt sein.');
  if (!isPlainObject(data)) throw new HttpError(400, '„data“ muss ein Objekt sein.');
  if (nestedDeeper(meta, MAX_DEPTH) || nestedDeeper(data, MAX_DEPTH)) {
    throw new HttpError(400, `Spielstand ist zu tief verschachtelt (höchstens ${MAX_DEPTH} Ebenen).`);
  }
  let metaJson;
  let dataJson;
  try {
    metaJson = JSON.stringify(meta);
    dataJson = JSON.stringify(data);
  } catch {
    // Sicherheitsnetz (Tiefe ist oben bereits begrenzt)
    throw new HttpError(400, 'Spielstand kann nicht gespeichert werden.');
  }
  if (metaJson.length > MAX_META_CHARS) {
    throw new HttpError(400, `„meta“ ist zu groß (höchstens ${MAX_META_CHARS} Zeichen).`);
  }
  // Nach dem Serialisieren prüfen: Zahlen wie 9e20 werden dabei viel länger als im Request
  if (Buffer.byteLength(dataJson, 'utf8') > MAX_DATA_BYTES) {
    throw new HttpError(413, `Spielstand ist zu groß (höchstens ${MAX_DATA_BYTES / 1024} KB).`);
  }
  return { metaJson, dataJson };
}

function parseScoreBody(body) {
  const { score, week, seed, area, time } = isPlainObject(body) ? body : {};
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    throw new HttpError(400, '„score“ muss eine ganze Zahl von 0 bis 10.000.000 sein.');
  }
  if (!Number.isInteger(week) || week < 1 || week > MAX_WEEK) {
    throw new HttpError(400, '„week“ muss eine ganze Zahl von 1 bis 999 sein.');
  }
  if (typeof seed !== 'string' || seed.length > MAX_SEED || !LABEL_RE.test(seed)) {
    throw new HttpError(400, `„seed“ muss ein Text mit höchstens ${MAX_SEED} Zeichen sein (ohne Sonderzeichen wie < > & " ').`);
  }
  if (typeof area !== 'string' || area.length > MAX_AREA || !LABEL_RE.test(area)) {
    throw new HttpError(400, `„area“ muss ein Text mit höchstens ${MAX_AREA} Zeichen sein (ohne Sonderzeichen wie < > & " ').`);
  }
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > MAX_TIME) {
    throw new HttpError(400, `„time“ muss eine Zahl von 0 bis ${MAX_TIME} sein.`);
  }
  const problem = implausible({ score, week, seed, area, time });
  if (problem) throw new HttpError(400, `Ergebnis abgelehnt: ${problem}`);
  return { score, week, seed, area, time };
}

/** Übersetzt Fehler in Status + deutsche Meldung (ohne interne Details). */
function describeError(err) {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  switch (err?.type) {
    case 'entity.too.large':
      return { status: 413, message: MSG.tooLarge };
    case 'entity.parse.failed':
      return { status: 400, message: MSG.badJson };
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return { status: 415, message: 'Zeichenkodierung wird nicht unterstützt.' };
    default:
  }
  const status = err?.status ?? err?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) return { status, message: MSG.badRequest };
  return { status: 500, message: MSG.internal };
}

export function createApp({
  dbPath,
  cookieSecure = false,
  now = () => Date.now(),
  bcryptRounds = 12,
  trustProxy = false,
  publicOrigins = [],
} = {}) {
  if (!dbPath) throw new TypeError('createApp: dbPath fehlt.');
  const db = openDb(dbPath);

  const q = {
    userByName: db.prepare('SELECT id, username, pass_hash FROM users WHERE username = ?'),
    insertUser: db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)'),
    insertSession: db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ),
    sessionUser: db.prepare(
      `SELECT s.user_id, s.expires_at, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    listSaves: db.prepare(
      'SELECT slot, meta, updated_at FROM saves WHERE user_id = ? ORDER BY updated_at DESC, slot',
    ),
    getSave: db.prepare('SELECT meta, data, updated_at FROM saves WHERE user_id = ? AND slot = ?'),
    saveExists: db.prepare('SELECT 1 FROM saves WHERE user_id = ? AND slot = ?'),
    countSaves: db.prepare('SELECT COUNT(*) AS n FROM saves WHERE user_id = ?'),
    otherSavesBytes: db.prepare(
      'SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS n FROM saves WHERE user_id = ? AND slot <> ?',
    ),
    upsertSave: db.prepare(
      `INSERT INTO saves (user_id, slot, meta, data, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, slot) DO UPDATE
         SET meta = excluded.meta, data = excluded.data, updated_at = excluded.updated_at`,
    ),
    deleteSave: db.prepare('DELETE FROM saves WHERE user_id = ? AND slot = ?'),
    insertScore: db.prepare(
      `INSERT INTO scores (user_id, score, week, seed, area, play_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    // Nur die besten MAX_SCORES_PER_USER Ergebnisse je Spieler behalten
    trimScores: db.prepare(
      `DELETE FROM scores WHERE id IN (
         SELECT id FROM scores WHERE user_id = ? ORDER BY score DESC, created_at, id LIMIT -1 OFFSET ${MAX_SCORES_PER_USER}
       )`,
    ),
    bestScore: db.prepare('SELECT score AS best FROM user_best WHERE user_id = ?'),
    myScores: db.prepare(
      `SELECT score, week, seed, area, play_time, created_at FROM scores
        WHERE user_id = ? ORDER BY score DESC, created_at, id LIMIT 10`,
    ),
    // Bestes Ergebnis je Spieler (bei Gleichstand das frühere), per Index statt über alle Ergebnisse
    leaderboard: db.prepare(
      `SELECT u.username, b.score, b.week, b.area, b.seed, b.created_at
         FROM user_best b JOIN users u ON u.id = b.user_id
        ORDER BY b.score DESC, b.created_at, b.score_id
        LIMIT 20`,
    ),
  };

  const writeSave = db.transaction((userId, slot, metaJson, dataJson, t) => {
    if (!q.saveExists.get(userId, slot) && q.countSaves.get(userId).n >= MAX_SLOTS) {
      throw new HttpError(409, `Höchstens ${MAX_SLOTS} Spielstände pro Konto – bitte zuerst einen löschen.`);
    }
    if (q.otherSavesBytes.get(userId, slot).n + Buffer.byteLength(dataJson, 'utf8') > MAX_ACCOUNT_BYTES) {
      throw new HttpError(409, 'Der Speicherplatz deines Kontos ist voll – bitte zuerst einen Spielstand löschen.');
    }
    q.upsertSave.run(userId, slot, metaJson, dataJson, t);
  });

  const addScore = db.transaction((userId, s, t) => {
    const id = Number(q.insertScore.run(userId, s.score, s.week, s.seed, s.area, s.time, t).lastInsertRowid);
    q.trimScores.run(userId);
    return { id, best: q.bestScore.get(userId).best };
  });

  // Vergleichshash für unbekannte Benutzer, damit die Antwortzeit nichts verrät
  const dummyHash = bcrypt.hashSync(prehash('teleferico-kein-konto'), bcryptRounds);

  // Je IP zählen nur Fehlversuche bzw. angelegte Konten – viele Spieler hinter einer Adresse
  // (Schule, Mobilfunk-NAT) sollen sich nicht gegenseitig aussperren. Die Gesamt-Limits begrenzen
  // zusätzlich die bcrypt-Last.
  const loginIpLimiter = new RateLimiter({ limit: 30, windowMs: 15 * MINUTE, now });
  const loginIpTotal = new RateLimiter({ limit: 300, windowMs: 15 * MINUTE, now });
  const loginUserLimiter = new RateLimiter({ limit: 8, windowMs: 15 * MINUTE, now });
  const registerIpLimiter = new RateLimiter({ limit: 20, windowMs: 60 * MINUTE, now });
  const registerIpTotal = new RateLimiter({ limit: 60, windowMs: 60 * MINUTE, now });
  // Schreibzugriffe je Konto, damit ein einzelnes Konto den Server nicht auslasten kann
  const saveUserLimiter = new RateLimiter({ limit: 30, windowMs: MINUTE, now });
  const scoreUserLimiter = new RateLimiter({ limit: 10, windowMs: MINUTE, now });

  function tooMany(res, limiter, key, message) {
    res.set('Retry-After', String(limiter.retryAfter(key)));
    res.status(429).json({ error: message });
  }

  // Zählt jede Anfrage – vor dem Einlesen des Bodys
  const gate = (limiter, message, keyOf) => (req, res, next) => {
    const key = keyOf(req);
    if (limiter.blocked(key)) return tooMany(res, limiter, key, message);
    limiter.hit(key);
    next();
  };
  const ipGate = (limiter, message) => gate(limiter, message, clientIp);
  const userGate = (limiter, message) => gate(limiter, message, (req) => req.user.id);

  function startSession(res, userId) {
    const token = newToken();
    const t = now();
    q.deleteExpiredSessions.run(t);
    q.insertSession.run(hashToken(token), userId, t, t + SESSION_TTL_MS);
    res.append('Set-Cookie', sessionCookie(token, cookieSecure));
  }

  function dropCurrentSession(req) {
    if (req.sessionHash) q.deleteSession.run(req.sessionHash);
    req.sessionHash = null;
  }

  // ---------------------------------------------------------------- Middleware

  const allowedOrigins = new Set(publicOrigins.map((o) => o.toLowerCase()));

  /** CSRF-Schutz: schreibende Anfragen nur von derselben Herkunft. */
  function csrfGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const site = req.get('sec-fetch-site');
    if (site && site.toLowerCase() === 'cross-site') throw new HttpError(403, MSG.csrf);
    const origin = req.get('origin');
    if (origin !== undefined) {
      let originHost = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (allowedOrigins.size > 0) {
        // Hinter einem Proxy, der den Host-Header umschreibt: feste Liste erlaubter Herkünfte
        if (!allowedOrigins.has(origin.toLowerCase())) throw new HttpError(403, MSG.csrf);
        return next();
      }
      const host = (trustProxy ? req.host : req.get('host')) || '';
      if (!originHost || originHost.toLowerCase() !== host.toLowerCase()) throw new HttpError(403, MSG.csrf);
    }
    next();
  }

  /** Löscht gleichnamige Cookies mit engerem Pfad (z. B. von einer Subdomain untergeschoben). */
  function clearShadowCookies(req, res) {
    let cookiePath = '';
    for (const segment of req.originalUrl.split('?')[0].split('/').filter(Boolean).slice(0, 4)) {
      if (!/^[A-Za-z0-9._~-]+$/.test(segment)) break;
      cookiePath += `/${segment}`;
      res.append('Set-Cookie', clearedSessionCookie(cookieSecure, cookiePath));
    }
  }

  function loadSession(req, res, next) {
    req.user = null;
    req.sessionHash = null;
    const sent = cookieValues(req.headers.cookie, SESSION_COOKIE);
    const tokens = [...new Set(sent.filter(Boolean))];
    if (tokens.length === 0) return next();
    req.staleSession = true;
    if (sent.length > 1) clearShadowCookies(req, res);
    if (tokens.length > 5) return next();
    const t = now();
    const valid = [];
    for (const token of tokens) {
      if (!isWellFormedToken(token)) continue;
      const hash = hashToken(token);
      const row = q.sessionUser.get(hash);
      if (!row) continue;
      if (row.expires_at <= t) {
        q.deleteSession.run(hash);
        continue;
      }
      valid.push({ hash, row });
    }
    // Mehrere Sitzungs-Cookies verschiedener Konten: keines verwenden, statt still das erste zu nehmen
    if (valid.length === 0 || valid.some((v) => v.row.user_id !== valid[0].row.user_id)) return next();
    const { hash, row } = valid[0];
    req.staleSession = false;
    req.sessionHash = hash;
    req.user = { id: row.user_id, username: row.username };
    next();
  }

  function requireUser(req, res, next) {
    if (!req.user) throw new HttpError(401, MSG.unauthorized);
    next();
  }

  const json = express.json({ limit: BODY_LIMIT });
  // sendBeacon schickt oft text/plain – Rohtext selbst als JSON lesen
  const beaconText = express.text({ type: () => true, limit: BODY_LIMIT });

  // ---------------------------------------------------------------- API
  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(csrfGuard);
  api.use(loadSession);

  api.get('/health', (req, res) => {
    res.json({ ok: true, version: API_VERSION });
  });

  api.post('/auth/register', ipGate(registerIpTotal, MSG.registerLimited), json, async (req, res) => {
    const ip = clientIp(req);
    if (registerIpLimiter.blocked(ip)) return tooMany(res, registerIpLimiter, ip, MSG.registerLimited);
    const { username, password } = bodyOf(req);
    const problem = checkUsername(username) ?? checkPassword(password);
    if (problem) throw new HttpError(400, problem);
    if (q.userByName.get(username)) throw new HttpError(409, MSG.taken);
    // Vor dem (asynchronen) Hashen zählen, damit parallele Anfragen das Limit nicht umgehen
    registerIpLimiter.hit(ip);
    let id;
    try {
      const hash = await bcrypt.hash(prehash(password), bcryptRounds);
      id = Number(q.insertUser.run(username, hash, now()).lastInsertRowid);
    } catch (err) {
      registerIpLimiter.undo(ip); // kein Konto angelegt
      // gleichzeitige Registrierung desselben Namens
      if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, MSG.taken);
      throw err;
    }
    dropCurrentSession(req);
    startSession(res, id);
    res.status(201).json({ user: { id, username } });
  });

  api.post('/auth/login', ipGate(loginIpTotal, MSG.loginLimited), json, async (req, res) => {
    const ip = clientIp(req);
    if (loginIpLimiter.blocked(ip)) return tooMany(res, loginIpLimiter, ip, MSG.loginLimited);
    // Als Fehlversuch zählen; ein erfolgreicher Login nimmt ihn unten wieder zurück
    loginIpLimiter.hit(ip);
    const { username, password } = bodyOf(req);
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw new HttpError(400, 'Bitte Benutzername und Passwort angeben.');
    }
    // Formal unmögliche Angaben können zu keinem Konto passen
    if (!USERNAME_RE.test(username) || password.length > PASSWORD_MAX) throw new HttpError(401, MSG.loginFailed);
    const key = username.toLowerCase();
    // Bewusst laut Vorgabe: Die Sperre gilt auch für das richtige Passwort, sonst wäre sie wirkungslos.
    // Folge: Jeder kann ein Konto für 15 Minuten sperren (begrenzt durch das IP-Limit).
    if (loginUserLimiter.blocked(key)) return tooMany(res, loginUserLimiter, key, MSG.loginLimited);
    // Versuch vor dem (asynchronen) Vergleich zählen, damit parallele Anfragen das Limit nicht umgehen
    loginUserLimiter.hit(key);
    const user = q.userByName.get(username);
    const ok = await bcrypt.compare(prehash(password), user ? user.pass_hash : dummyHash);
    if (!user || !ok) throw new HttpError(401, MSG.loginFailed);
    loginUserLimiter.reset(key);
    loginIpLimiter.undo(ip);
    dropCurrentSession(req);
    startSession(res, user.id);
    res.json({ user: { id: user.id, username: user.username } });
  });

  api.post('/auth/logout', (req, res) => {
    dropCurrentSession(req);
    res.append('Set-Cookie', clearedSessionCookie(cookieSecure));
    res.json({ ok: true });
  });

  api.get('/auth/me', (req, res) => {
    if (!req.user && req.staleSession) res.append('Set-Cookie', clearedSessionCookie(cookieSecure));
    res.json({ user: req.user });
  });

  // ---- Spielstände
  // Gespeicherter JSON-Text wird unverändert eingesetzt (kein erneutes Parsen und Serialisieren)
  api.get('/saves', requireUser, (req, res) => {
    const saves = q.listSaves
      .all(req.user.id)
      .map((r) => `{"slot":${JSON.stringify(r.slot)},"meta":${r.meta},"updatedAt":${r.updated_at}}`);
    res.type('application/json').send(`{"saves":[${saves.join(',')}]}`);
  });

  api.get('/saves/:slot', requireUser, (req, res) => {
    const slot = checkSlot(req.params.slot);
    const row = q.getSave.get(req.user.id, slot);
    if (!row) throw new HttpError(404, MSG.saveNotFound);
    res
      .type('application/json')
      .send(`{"slot":${JSON.stringify(slot)},"meta":${row.meta},"data":${row.data},"updatedAt":${row.updated_at}}`);
  });

  const saveGate = userGate(saveUserLimiter, MSG.savesLimited);

  api.put('/saves/:slot', requireUser, saveGate, json, (req, res) => {
    const slot = checkSlot(req.params.slot);
    const { metaJson, dataJson } = parseSaveBody(req.body);
    const updatedAt = now();
    writeSave(req.user.id, slot, metaJson, dataJson, updatedAt);
    res.json({ slot, updatedAt });
  });

  api.post('/saves/:slot/beacon', requireUser, saveGate, beaconText, (req, res) => {
    const slot = checkSlot(req.params.slot);
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        throw new HttpError(400, MSG.badJson);
      }
    }
    const { metaJson, dataJson } = parseSaveBody(body);
    writeSave(req.user.id, slot, metaJson, dataJson, now());
    res.status(204).end();
  });

  api.delete('/saves/:slot', requireUser, (req, res) => {
    const slot = checkSlot(req.params.slot);
    if (q.deleteSave.run(req.user.id, slot).changes === 0) throw new HttpError(404, MSG.saveNotFound);
    res.json({ ok: true });
  });

  // ---- Bestenliste
  api.post('/scores', requireUser, userGate(scoreUserLimiter, MSG.scoresLimited), json, (req, res) => {
    const s = parseScoreBody(req.body);
    res.status(201).json(addScore(req.user.id, s, now()));
  });

  api.get('/scores/me', requireUser, (req, res) => {
    const scores = q.myScores.all(req.user.id).map((r) => ({
      score: r.score,
      week: r.week,
      seed: r.seed,
      area: r.area,
      time: r.play_time,
      createdAt: r.created_at,
    }));
    res.json({ scores });
  });

  api.get('/leaderboard', (req, res) => {
    const scores = q.leaderboard.all().map((r) => ({
      username: r.username,
      score: r.score,
      week: r.week,
      area: r.area,
      seed: r.seed,
      createdAt: r.created_at,
    }));
    res.json({ scores });
  });

  api.use((req, res) => {
    res.status(404).json({ error: MSG.apiNotFound });
  });

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    const { status, message } = describeError(err);
    if (status >= 500) console.error('[teleferico] Fehler bei', req.method, req.originalUrl, err);
    if (res.headersSent) return void res.end();
    res.status(status).json({ error: message });
  });

  // ---------------------------------------------------------------- App
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });

  app.use('/api', api);

  // Frontend: nur ausdrücklich freigegebene Dateien und Ordner
  const sendRootFile = (name) => (req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(name, { root: ROOT_DIR, dotfiles: 'deny', cacheControl: false }, (err) => {
      if (!err || res.headersSent) return;
      if (err.status === 404 || err.code === 'ENOENT') return next();
      next(err);
    });
  };
  // index.html mit Markierung ausliefern: So erkennt das Spiel, dass Konten verfügbar sind
  const sendIndex = async (req, res, next) => {
    try {
      const html = await readFile(path.join(ROOT_DIR, 'index.html'), 'utf8');
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(html.replace('</head>', '  <meta name="teleferico-server" content="1" />\n  </head>'));
    } catch (err) {
      next(err);
    }
  };
  app.get(['/', '/index.html'], sendIndex);
  app.get('/style.css', sendRootFile('style.css'));
  app.use(
    '/src',
    express.static(path.join(ROOT_DIR, 'src'), {
      index: false,
      redirect: false,
      cacheControl: false,
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }),
  );

  app.use((req, res) => {
    res.status(404).type('text/plain').send('Nicht gefunden');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const { status } = describeError(err);
    if (status >= 500) console.error('[teleferico] Fehler bei', req.method, req.originalUrl, err);
    if (res.headersSent) return void res.end();
    res
      .status(status)
      .type('text/plain')
      .send(status === 404 ? 'Nicht gefunden' : status >= 500 ? 'Interner Serverfehler' : 'Ungültige Anfrage');
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    db.close();
  }

  return { app, db, close };
}
