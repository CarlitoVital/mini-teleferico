// Tests für das Teleférico-Backend: echte HTTP-Anfragen gegen createApp auf einem freien Port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.js';
import { parseTrustProxy } from '../server/config.js';
import { MIGRATIONS } from '../server/db.js';
import { RateLimiter, ipKey } from '../server/ratelimit.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LOGIN_FAILED = 'Benutzername oder Passwort falsch.';
const LOGIN_LIMITED = 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.';

/** Set-Cookie-Zeilen; Headers.getSetCookie fehlt vor Node 18.14. */
function setCookiesOf(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const joined = headers.get('set-cookie');
  return joined ? joined.split(/,(?=\s*[^;,=\s]+=)/).map((c) => c.trim()) : [];
}

/** Kleiner HTTP-Client mit Cookie-Speicher für tf_session. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookie = null;
  }

  async request(method, url, { body, raw, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = `tf_session=${this.cookie}`;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
    }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    const setCookies = setCookiesOf(res.headers);
    for (const c of setCookies) {
      const m = /^tf_session=([^;]*);.*Path=\/(;|$)/.exec(c);
      if (m) this.cookie = m[1] || null;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json, setCookies };
  }

  get(url, opts) {
    return this.request('GET', url, opts);
  }
  post(url, body, opts = {}) {
    return this.request('POST', url, { ...opts, body });
  }
  put(url, body, opts = {}) {
    return this.request('PUT', url, { ...opts, body });
  }
  del(url, opts) {
    return this.request('DELETE', url, opts);
  }
}

/** Startet eine frische App mit eigener Temp-Datenbank und steuerbarer Uhr. */
async function startServer(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleferico-test-'));
  const clock = { t: Date.UTC(2026, 0, 5, 12) };
  const { app, db, close } = createApp({
    dbPath: path.join(dir, 'test.db'),
    bcryptRounds: 4,
    now: () => clock.t,
    ...opts,
  });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve(s)));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    port,
    db,
    clock,
    advance(ms) {
      clock.t += ms;
    },
    client() {
      return new Client(base);
    },
    async stop() {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.(); // erst ab Node 18.2
      await closed;
      close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Test mit eigenem Server, der danach sicher beendet wird. */
function serverTest(name, fn, opts) {
  test(name, async (t) => {
    const srv = await startServer(opts);
    try {
      await fn(srv, t);
    } finally {
      await srv.stop();
    }
  });
}

/** Rohe GET-Anfrage ohne URL-Normalisierung (fetch würde ../ und %2e%2e auflösen). */
function rawGet(base, rawPath) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: rawPath, method: 'GET', agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function registered(srv, username, password = 'geheim123') {
  const c = srv.client();
  const res = await c.post('/api/auth/register', { username, password });
  assert.equal(res.status, 201, `Registrierung von ${username}: ${res.text}`);
  c.user = res.json.user;
  return c;
}

const validScore = (over = {}) => ({ score: 100, week: 3, seed: '12345', area: 'El Alto', time: 321.5, ...over });

// ---------------------------------------------------------------- Health

serverTest('GET /api/health', async (srv) => {
  const res = await srv.client().get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, version: 1 });
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
});

// ---------------------------------------------------------------- Registrierung

serverTest('Registrierung: Erfolg, Cookie und automatische Anmeldung', async (srv) => {
  const c = srv.client();
  const res = await c.post('/api/auth/register', { username: 'alice', password: 'geheim123' });
  assert.equal(res.status, 201);
  assert.equal(typeof res.json.user.id, 'number');
  assert.equal(res.json.user.username, 'alice');
  assert.deepEqual(Object.keys(res.json.user).sort(), ['id', 'username']);

  const cookie = res.setCookies.find((s) => s.startsWith('tf_session='));
  assert.ok(cookie, 'Session-Cookie fehlt');
  assert.match(cookie, /^tf_session=[A-Za-z0-9_-]{43};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=2592000/);
  assert.doesNotMatch(cookie, /Secure/);

  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.json, { user: res.json.user });

  // Nur der Hash des Tokens liegt in der Datenbank
  const row = srv.db.prepare('SELECT token_hash FROM sessions').get();
  assert.notEqual(row.token_hash, c.cookie);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  const user = srv.db.prepare('SELECT pass_hash FROM users WHERE username = ?').get('alice');
  assert.match(user.pass_hash, /^\$2[aby]\$/);
});

serverTest('Registrierung: doppelter Name (ohne Groß-/Kleinschreibung) → 409', async (srv) => {
  await registered(srv, 'alice');
  for (const name of ['alice', 'ALICE', 'Alice']) {
    const res = await srv.client().post('/api/auth/register', { username: name, password: 'anderes123' });
    assert.equal(res.status, 409, name);
    assert.equal(typeof res.json.error, 'string');
    assert.equal(res.setCookies.length, 0);
  }
});

serverTest('Registrierung: ungültige Eingaben → 400', async (srv) => {
  const badNames = ['ab', 'a'.repeat(25), 'bad name', ' alice', 'alice ', 'ümlaut', '', 12345, null];
  for (const username of badNames) {
    const res = await srv.client().post('/api/auth/register', { username, password: 'geheim123' });
    assert.equal(res.status, 400, `Benutzername ${JSON.stringify(username)}`);
    assert.equal(typeof res.json.error, 'string');
  }
  srv.advance(61 * MINUTE); // Registrierungs-Limit pro IP zurücksetzen

  const badPasswords = ['kurz', '1234567', 'x'.repeat(129), 12345678, null, ''];
  for (const password of badPasswords) {
    const res = await srv.client().post('/api/auth/register', { username: 'bob', password });
    assert.equal(res.status, 400, `Passwort ${JSON.stringify(password)}`);
    assert.equal(typeof res.json.error, 'string');
  }
  const missing = await srv.client().post('/api/auth/register', {});
  assert.equal(missing.status, 400);
  srv.advance(61 * MINUTE);

  const malformed = await srv.client().request('POST', '/api/auth/register', {
    raw: '{"username": "bob",',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(malformed.status, 400);
  assert.equal(typeof malformed.json.error, 'string');
  assert.doesNotMatch(malformed.text, /at \w+ \(|node_modules/, 'kein Stacktrace');

  // Grenzwerte sind erlaubt
  await registered(srv, 'abc', 'x'.repeat(8));
  await registered(srv, 'a'.repeat(24), 'y'.repeat(128));
  await registered(srv, 'Mi_x.ed-1');
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 3);
});

serverTest(
  'COOKIE_SECURE: Cookie mit Secure-Flag',
  async (srv) => {
    const res = await srv.client().post('/api/auth/register', { username: 'secure', password: 'geheim123' });
    assert.equal(res.status, 201);
    assert.match(res.setCookies[0], /; Secure/);
  },
  { cookieSecure: true },
);

// ---------------------------------------------------------------- Login

serverTest('Login: Erfolg, falsches Passwort, unbekannter Benutzer', async (srv) => {
  const reg = await registered(srv, 'bob', 'richtig123');

  const c = srv.client();
  const ok = await c.post('/api/auth/login', { username: 'bob', password: 'richtig123' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { user: reg.user });
  assert.ok(c.cookie, 'Login setzt Cookie');
  assert.notEqual(c.cookie, reg.cookie, 'neue Sitzung pro Login');
  assert.equal((await c.get('/api/auth/me')).json.user.username, 'bob');

  // Benutzername ohne Groß-/Kleinschreibung, Antwort mit gespeicherter Schreibweise
  const upper = await srv.client().post('/api/auth/login', { username: 'BOB', password: 'richtig123' });
  assert.equal(upper.status, 200);
  assert.equal(upper.json.user.username, 'bob');

  const wrong = await srv.client().post('/api/auth/login', { username: 'bob', password: 'falsch123' });
  const unknown = await srv.client().post('/api/auth/login', { username: 'niemand', password: 'falsch123' });
  const impossible = await srv.client().post('/api/auth/login', { username: 'x y', password: 'falsch123' });
  for (const res of [wrong, unknown, impossible]) {
    assert.equal(res.status, 401);
    assert.deepEqual(res.json, { error: LOGIN_FAILED });
    assert.equal(res.setCookies.length, 0);
  }

  const missing = await srv.client().post('/api/auth/login', { username: 'bob' });
  assert.equal(missing.status, 400);
});

serverTest('Login: jedes Zeichen des Passworts zählt (bcrypt liest nur 72 Byte)', async (srv) => {
  const cases = [
    // [Benutzer, Passwort, anderes Passwort mit denselben ersten 72 Byte]
    ['lang', 'p'.repeat(72) + 'AAAA', 'p'.repeat(72) + 'ZZZZZZ'],
    ['umlaut', 'ä'.repeat(40), 'ä'.repeat(36)],
    ['emoji', '😀'.repeat(20), '😀'.repeat(18) + 'xx'],
    ['maximal', 'ä'.repeat(36) + 'X'.repeat(92), 'ä'.repeat(36) + 'z'],
  ];
  for (const [username, password, samePrefix] of cases) {
    assert.equal(password.length <= 128, true);
    await registered(srv, username, password);
    const wrong = await srv.client().post('/api/auth/login', { username, password: samePrefix });
    assert.equal(wrong.status, 401, username);
    assert.deepEqual(wrong.json, { error: LOGIN_FAILED });
    assert.equal(wrong.setCookies.length, 0);
    const ok = await srv.client().post('/api/auth/login', { username, password });
    assert.equal(ok.status, 200, username);
  }
});

// ---------------------------------------------------------------- Sitzung

serverTest('me ohne/mit Cookie, Logout macht Sitzung ungültig', async (srv) => {
  const anon = await srv.client().get('/api/auth/me');
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.json, { user: null });

  const bogus = srv.client();
  bogus.cookie = 'A'.repeat(43);
  const bogusMe = await bogus.get('/api/auth/me');
  assert.deepEqual(bogusMe.json, { user: null });
  assert.ok(bogusMe.setCookies.some((s) => /^tf_session=;.*Max-Age=0/.test(s)), 'ungültiges Cookie wird gelöscht');

  const c = await registered(srv, 'carol');
  const token = c.cookie;
  assert.equal((await c.get('/api/auth/me')).json.user.username, 'carol');

  const out = await c.post('/api/auth/logout');
  assert.equal(out.status, 200);
  assert.deepEqual(out.json, { ok: true });
  assert.ok(out.setCookies.some((s) => /^tf_session=;.*Max-Age=0/.test(s)), 'Cookie wird gelöscht');
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);

  // Altes Token gilt nicht mehr
  const replay = srv.client();
  replay.cookie = token;
  assert.deepEqual((await replay.get('/api/auth/me')).json, { user: null });
  assert.equal((await replay.get('/api/saves')).status, 401);

  // Logout ohne Anmeldung ist harmlos
  const anonOut = await srv.client().post('/api/auth/logout');
  assert.equal(anonOut.status, 200);
  assert.deepEqual(anonOut.json, { ok: true });
});

serverTest('Abgelaufene Sitzungen werden abgelehnt und gelöscht', async (srv) => {
  const c = await registered(srv, 'dave');
  srv.advance(29 * DAY);
  assert.equal((await c.get('/api/auth/me')).json.user.username, 'dave');
  srv.advance(1 * DAY);
  assert.deepEqual((await c.get('/api/auth/me')).json, { user: null });
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

serverTest('Sitzung: mehrere tf_session-Cookies verschiedener Konten gelten nicht', async (srv) => {
  const alice = await registered(srv, 'alice');
  const mallory = await registered(srv, 'mallory');
  // z. B. von einer Subdomain mit Path=/api/saves untergeschoben – Browser senden es zuerst
  const both = { headers: { cookie: `tf_session=${mallory.cookie}; tf_session=${alice.cookie}` } };
  assert.deepEqual((await srv.client().get('/api/auth/me', both)).json, { user: null });

  const put = await srv.client().put('/api/saves/auto', { meta: {}, data: { geheim: 1 } }, both);
  assert.equal(put.status, 401);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM saves').get().n, 0);
  // Cookies mit engerem Pfad werden gelöscht, das Haupt-Cookie (Path=/) nicht
  for (const p of ['/api', '/api/saves', '/api/saves/auto']) {
    assert.ok(
      put.setCookies.some((c) => c.startsWith('tf_session=;') && c.includes(`Path=${p};`) && /Max-Age=0/.test(c)),
      `Cookie für ${p} wird gelöscht`,
    );
  }
  assert.ok(!put.setCookies.some((c) => /Path=\/;/.test(c)));

  // ungültiges plus gültiges Cookie: das gültige zählt; dasselbe Token doppelt ist harmlos
  const mixed = { headers: { cookie: `tf_session=${'A'.repeat(43)}; tf_session=${alice.cookie}` } };
  assert.equal((await srv.client().get('/api/auth/me', mixed)).json.user.username, 'alice');
  const twice = { headers: { cookie: `tf_session=${alice.cookie}; tf_session=${alice.cookie}` } };
  assert.equal((await srv.client().get('/api/auth/me', twice)).json.user.username, 'alice');
  // einzelnes Cookie: keine zusätzlichen Set-Cookie-Zeilen
  assert.equal((await alice.get('/api/saves')).setCookies.length, 0);
});

// ---------------------------------------------------------------- Spielstände

serverTest('Spielstände: ohne Anmeldung 401', async (srv) => {
  const c = srv.client();
  const save = { meta: { week: 1 }, data: { x: 1 } };
  const results = [
    await c.get('/api/saves'),
    await c.get('/api/saves/auto'),
    await c.put('/api/saves/auto', save),
    await c.post('/api/saves/auto/beacon', undefined, { raw: JSON.stringify(save), headers: { 'content-type': 'text/plain' } }),
    await c.del('/api/saves/auto'),
    await c.post('/api/scores', validScore()),
    await c.get('/api/scores/me'),
  ];
  for (const res of results) {
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'Nicht angemeldet.');
  }
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM saves').get().n, 0);
});

serverTest('Spielstände: anlegen, lesen, auflisten, überschreiben, löschen', async (srv) => {
  const c = await registered(srv, 'erin');
  const meta1 = { week: 2, score: 40, area: 'Centro' };
  const data1 = { stations: [{ x: 1, y: 2 }], lines: [], nested: { deep: [1, 2, 3] } };

  const put1 = await c.put('/api/saves/auto', { meta: meta1, data: data1 });
  assert.equal(put1.status, 200);
  assert.deepEqual(put1.json, { slot: 'auto', updatedAt: srv.clock.t });

  srv.advance(1000);
  const put2 = await c.put('/api/saves/slot-2', { meta: { week: 5 }, data: { a: 1 } });
  assert.equal(put2.status, 200);

  let list = await c.get('/api/saves');
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.json.saves.map((s) => s.slot),
    ['slot-2', 'auto'],
  );
  assert.deepEqual(list.json.saves[1], { slot: 'auto', meta: meta1, updatedAt: put1.json.updatedAt });
  for (const s of list.json.saves) assert.equal('data' in s, false, 'Liste enthält keine Spieldaten');

  const got = await c.get('/api/saves/auto');
  assert.equal(got.status, 200);
  assert.deepEqual(got.json, { slot: 'auto', meta: meta1, data: data1, updatedAt: put1.json.updatedAt });

  // Überschreiben aktualisiert Inhalt und Reihenfolge
  srv.advance(1000);
  const put3 = await c.put('/api/saves/auto', { meta: { week: 3 }, data: { b: 2 } });
  assert.equal(put3.status, 200);
  list = await c.get('/api/saves');
  assert.deepEqual(
    list.json.saves.map((s) => s.slot),
    ['auto', 'slot-2'],
  );
  assert.deepEqual((await c.get('/api/saves/auto')).json.data, { b: 2 });

  // Andere Konten sehen nichts davon
  const other = await registered(srv, 'frank');
  assert.deepEqual((await other.get('/api/saves')).json, { saves: [] });
  assert.equal((await other.get('/api/saves/auto')).status, 404);
  assert.equal((await other.del('/api/saves/auto')).status, 404);

  const del = await c.del('/api/saves/auto');
  assert.equal(del.status, 200);
  assert.deepEqual(del.json, { ok: true });
  const gone = await c.get('/api/saves/auto');
  assert.equal(gone.status, 404);
  assert.equal(typeof gone.json.error, 'string');
  assert.equal((await c.del('/api/saves/auto')).status, 404);
  assert.deepEqual(
    (await c.get('/api/saves')).json.saves.map((s) => s.slot),
    ['slot-2'],
  );
});

serverTest('Spielstände: Validierung von Slot, meta und data', async (srv) => {
  const c = await registered(srv, 'gina');
  const ok = { meta: { w: 1 }, data: { v: 1 } };

  for (const slot of ['Auto', 'a_b', 'a.b', 'a..b', 'x'.repeat(41), 'a%20b', '%C3%BC', '%2F']) {
    const res = await c.put(`/api/saves/${slot}`, ok);
    assert.equal(res.status, 400, `Slot ${slot}`);
    assert.equal(typeof res.json.error, 'string');
    assert.equal((await c.get(`/api/saves/${slot}`)).status, 400, `GET Slot ${slot}`);
  }
  assert.equal((await c.put(`/api/saves/${'a'.repeat(40)}`, ok)).status, 200);
  assert.equal((await c.put('/api/saves/0-9-z', ok)).status, 200);

  const badBodies = [
    { meta: [1, 2], data: {} },
    { meta: 'x', data: {} },
    { meta: null, data: {} },
    { data: {} },
    { meta: {}, data: null },
    { meta: {}, data: [1] },
    { meta: {}, data: 'text' },
    { meta: {} },
    [],
  ];
  for (const body of badBodies) {
    const res = await c.put('/api/saves/test', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof res.json.error, 'string');
  }

  // meta höchstens 4000 Zeichen als JSON
  const metaOk = { s: 'x'.repeat(4000 - 8) };
  assert.equal(JSON.stringify(metaOk).length, 4000);
  assert.equal((await c.put('/api/saves/meta-ok', { meta: metaOk, data: {} })).status, 200);
  const metaBig = await c.put('/api/saves/meta-big', { meta: { s: 'x'.repeat(4000) }, data: {} });
  assert.equal(metaBig.status, 400);
  assert.equal(typeof metaBig.json.error, 'string');

  // Gesamtgröße über 2 MB → 413
  const huge = await c.put('/api/saves/huge', { meta: {}, data: { blob: 'x'.repeat(2.1 * 1024 * 1024) } });
  assert.equal(huge.status, 413);
  assert.equal(typeof huge.json.error, 'string');
  // knapp unter 2 MB geht
  const big = await c.put('/api/saves/big', { meta: {}, data: { blob: 'x'.repeat(1.9 * 1024 * 1024) } });
  assert.equal(big.status, 200);

  const malformed = await c.request('PUT', '/api/saves/test', {
    raw: '{"meta": {}, "data": ',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(malformed.status, 400);
  assert.equal(typeof malformed.json.error, 'string');

  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM saves WHERE slot IN ('test', 'meta-big', 'huge')").get().n, 0);
});

serverTest('Spielstände: höchstens 20 Slots pro Konto', async (srv) => {
  const c = await registered(srv, 'hank');
  for (let i = 1; i <= 20; i++) {
    const res = await c.put(`/api/saves/s${i}`, { meta: { i }, data: { i } });
    assert.equal(res.status, 200, `Slot ${i}`);
  }
  const extra = await c.put('/api/saves/s21', { meta: {}, data: {} });
  assert.equal(extra.status, 409);
  assert.equal(typeof extra.json.error, 'string');

  const beaconExtra = await c.post('/api/saves/s21/beacon', undefined, {
    raw: JSON.stringify({ meta: {}, data: {} }),
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(beaconExtra.status, 409);

  // Überschreiben bleibt erlaubt
  const over = await c.put('/api/saves/s5', { meta: { i: 'neu' }, data: { i: 'neu' } });
  assert.equal(over.status, 200);
  assert.equal((await c.get('/api/saves')).json.saves.length, 20);

  // Nach dem Löschen ist wieder Platz
  assert.equal((await c.del('/api/saves/s1')).status, 200);
  assert.equal((await c.put('/api/saves/s21', { meta: {}, data: {} })).status, 200);

  // Das Limit gilt pro Konto
  const other = await registered(srv, 'ivan');
  assert.equal((await other.put('/api/saves/s1', { meta: {}, data: {} })).status, 200);
});

serverTest('Spielstände: Beacon-Route mit text/plain und application/json', async (srv) => {
  const c = await registered(srv, 'jana');
  const save = { meta: { week: 7 }, data: { lines: [1, 2, 3] } };

  const plain = await c.post('/api/saves/exit/beacon', undefined, {
    raw: JSON.stringify(save),
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
  });
  assert.equal(plain.status, 204);
  assert.equal(plain.text, '');
  const got = await c.get('/api/saves/exit');
  assert.deepEqual({ meta: got.json.meta, data: got.json.data }, save);

  srv.advance(500);
  const asJson = await c.post('/api/saves/exit/beacon', { meta: { week: 8 }, data: { z: true } });
  assert.equal(asJson.status, 204);
  assert.deepEqual((await c.get('/api/saves/exit')).json.data, { z: true });

  // Ohne Content-Type (Blob ohne Typ)
  const untyped = await c.request('POST', '/api/saves/exit2/beacon', { raw: new Blob([JSON.stringify(save)]) });
  assert.equal(untyped.status, 204);

  const broken = await c.post('/api/saves/exit/beacon', undefined, {
    raw: '{kein json',
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(broken.status, 400);
  assert.equal(typeof broken.json.error, 'string');

  const badShape = await c.post('/api/saves/exit/beacon', undefined, {
    raw: JSON.stringify({ meta: [], data: {} }),
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(badShape.status, 400);

  const badSlot = await c.post('/api/saves/BAD/beacon', undefined, {
    raw: JSON.stringify(save),
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(badSlot.status, 400);
  assert.deepEqual((await c.get('/api/saves/exit')).json.data, { z: true });
});

serverTest('Spielstände: höchstens 30 Schreibvorgänge pro Minute und Konto', async (srv) => {
  const c = await registered(srv, 'eilig');
  for (let i = 0; i < 30; i++) {
    assert.equal((await c.put('/api/saves/auto', { meta: { i }, data: { i } })).status, 200, `PUT ${i + 1}`);
  }
  const blocked = await c.put('/api/saves/auto', { meta: {}, data: {} });
  assert.equal(blocked.status, 429);
  assert.equal(typeof blocked.json.error, 'string');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  const beacon = await c.post('/api/saves/auto/beacon', undefined, {
    raw: JSON.stringify({ meta: {}, data: {} }),
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(beacon.status, 429);
  // Lesen bleibt erlaubt, andere Konten sind nicht betroffen
  assert.deepEqual((await c.get('/api/saves/auto')).json.meta, { i: 29 });
  const other = await registered(srv, 'andere');
  assert.equal((await other.put('/api/saves/auto', { meta: {}, data: {} })).status, 200);

  srv.advance(MINUTE);
  assert.equal((await c.put('/api/saves/auto', { meta: {}, data: {} })).status, 200);
});

serverTest('Spielstände: Verschachtelungstiefe – was gespeichert wird, lässt sich auch laden', async (srv) => {
  const c = await registered(srv, 'tief');
  const nested = (depth) => '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);
  const putRaw = (slot, text) =>
    c.request('PUT', `/api/saves/${slot}`, { raw: text, headers: { 'content-type': 'application/json' } });

  const ok = await putRaw('ok', `{"meta":{"w":1},"data":${nested(100)}}`);
  assert.equal(ok.status, 200);
  const got = await c.get('/api/saves/ok');
  assert.equal(got.status, 200);
  assert.deepEqual(got.json.data, JSON.parse(nested(100)));

  const tooDeep = [
    `{"meta":{},"data":${nested(101)}}`,
    `{"meta":${nested(101)},"data":{}}`,
    `{"meta":{},"data":{"a":${'['.repeat(100)}1${']'.repeat(100)}}}`,
    `{"meta":{},"data":${nested(4091)}}`,
  ];
  for (const text of tooDeep) {
    const res = await putRaw('tief', text);
    assert.equal(res.status, 400);
    assert.equal(typeof res.json.error, 'string');
  }
  const beacon = await c.post('/api/saves/tief/beacon', undefined, {
    raw: `{"meta":{},"data":${nested(4091)}}`,
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(beacon.status, 400);
  assert.equal((await c.get('/api/saves/tief')).status, 404);

  // Bereits gespeicherte tiefe Daten (z. B. aus älteren Versionen) werden ohne Umweg ausgeliefert
  srv.db
    .prepare("INSERT INTO saves (user_id, slot, meta, data, updated_at) VALUES (?, 'alt', '{}', ?, 1)")
    .run(c.user.id, nested(5000));
  const old = await c.get('/api/saves/alt');
  assert.equal(old.status, 200);
  assert.ok(old.text.includes(nested(5000)));
  assert.equal((await c.get('/api/saves')).status, 200);
});

// ---------------------------------------------------------------- Punkte

serverTest('Punkte: einreichen, eigene Bestwerte und Bestenliste', async (srv) => {
  const alice = await registered(srv, 'alice');
  const bob = await registered(srv, 'bob');
  const carol = await registered(srv, 'carol');

  const r1 = await alice.post('/api/scores', validScore({ score: 120 }));
  assert.equal(r1.status, 201);
  assert.equal(typeof r1.json.id, 'number');
  assert.equal(r1.json.best, 120);
  srv.advance(1000);
  assert.equal((await alice.post('/api/scores', validScore({ score: 340, week: 6 }))).json.best, 340);
  srv.advance(1000);
  assert.equal((await alice.post('/api/scores', validScore({ score: 90 }))).json.best, 340);

  srv.advance(1000);
  await bob.post('/api/scores', validScore({ score: 500, area: 'Zona Sur', seed: 'abc' }));
  srv.advance(1000);
  await bob.post('/api/scores', validScore({ score: 20 }));
  srv.advance(1000);
  await carol.post('/api/scores', validScore({ score: 340 })); // Gleichstand mit alice, aber später

  // Eigene Top 10, absteigend (Abstand wegen Limit pro Konto)
  for (let i = 0; i < 12; i++) {
    srv.advance(10_000);
    assert.equal((await carol.post('/api/scores', validScore({ score: i }))).status, 201);
  }
  const mine = await carol.get('/api/scores/me');
  assert.equal(mine.status, 200);
  assert.equal(mine.json.scores.length, 10);
  assert.deepEqual(
    mine.json.scores.map((s) => s.score),
    [340, 11, 10, 9, 8, 7, 6, 5, 4, 3],
  );
  const aliceMine = await alice.get('/api/scores/me');
  assert.deepEqual(
    aliceMine.json.scores.map((s) => s.score),
    [340, 120, 90],
  );
  const top = aliceMine.json.scores[0];
  assert.deepEqual(Object.keys(top).sort(), ['area', 'createdAt', 'score', 'seed', 'time', 'week']);
  assert.equal(top.week, 6);
  assert.equal(top.time, 321.5);
  assert.equal(top.area, 'El Alto');

  // Öffentlich, ein Eintrag pro Spieler
  const lb = await srv.client().get('/api/leaderboard');
  assert.equal(lb.status, 200);
  assert.deepEqual(
    lb.json.scores.map((s) => [s.username, s.score]),
    [
      ['bob', 500],
      ['alice', 340],
      ['carol', 340],
    ],
  );
  assert.deepEqual(Object.keys(lb.json.scores[0]).sort(), ['area', 'createdAt', 'score', 'seed', 'username', 'week']);
  assert.equal(lb.json.scores[0].area, 'Zona Sur');
  assert.equal(lb.json.scores[0].seed, 'abc');
  assert.equal(lb.json.scores[1].week, 6);
  assert.doesNotMatch(lb.text, /pass_hash|user_id|\$2[aby]\$/);
});

serverTest('Punkte: Bestenliste zeigt höchstens 20 Spieler', async (srv) => {
  const insertUser = srv.db.prepare("INSERT INTO users (username, pass_hash, created_at) VALUES (?, 'x', 0)");
  const insertScore = srv.db.prepare(
    "INSERT INTO scores (user_id, score, week, seed, area, play_time, created_at) VALUES (?, ?, 1, 's', 'a', 1, 0)",
  );
  for (let i = 0; i < 25; i++) {
    const id = insertUser.run(`spieler${i}`).lastInsertRowid;
    insertScore.run(id, i * 10);
    insertScore.run(id, i * 10 + 1);
  }
  const lb = await srv.client().get('/api/leaderboard');
  assert.equal(lb.json.scores.length, 20);
  assert.equal(lb.json.scores[0].username, 'spieler24');
  assert.equal(lb.json.scores[0].score, 241);
  assert.equal(new Set(lb.json.scores.map((s) => s.username)).size, 20);
});

serverTest('Punkte: Validierung', async (srv) => {
  const c = await registered(srv, 'kim');
  const bad = [
    { score: -1 },
    { score: 1.5 },
    { score: '100' },
    { score: 10_000_001 },
    { score: null },
    { week: 0 },
    { week: 1000 },
    { week: 2.5 },
    { seed: 'x'.repeat(33) },
    { seed: 12345 },
    { area: 'x'.repeat(41) },
    { area: null },
    { time: -1 },
    { time: 1e7 + 1 },
    { time: '12' },
    { time: null },
  ];
  for (const over of bad) {
    srv.advance(MINUTE); // Limit pro Konto zählt jede Anfrage
    const res = await c.post('/api/scores', validScore(over));
    assert.equal(res.status, 400, JSON.stringify(over));
    assert.equal(typeof res.json.error, 'string');
  }
  srv.advance(MINUTE);
  const missing = await c.post('/api/scores', {});
  assert.equal(missing.status, 400);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 0);

  const edge = await c.post(
    '/api/scores',
    validScore({ score: 10_000_000, week: 999, seed: 'x'.repeat(32), area: 'y'.repeat(40), time: 1e7 }),
  );
  assert.equal(edge.status, 201);
  const zero = await c.post('/api/scores', validScore({ score: 0, week: 1, seed: '', area: '', time: 0 }));
  assert.equal(zero.status, 201);
  assert.equal(zero.json.best, 10_000_000);
});

serverTest('Punkte: Limit pro Konto, höchstens 50 gespeicherte Ergebnisse, Bestwert-Tabelle', async (srv) => {
  const c = await registered(srv, 'spammer');
  for (let i = 0; i < 10; i++) assert.equal((await c.post('/api/scores', validScore({ score: i }))).status, 201);
  const blocked = await c.post('/api/scores', validScore());
  assert.equal(blocked.status, 429);
  assert.equal(typeof blocked.json.error, 'string');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  srv.advance(MINUTE);

  // Viele Altdaten: beim nächsten Einreichen bleiben nur die besten 50
  const ins = srv.db.prepare(
    "INSERT INTO scores (user_id, score, week, seed, area, play_time, created_at) VALUES (?, ?, 1, 's', 'a', 1, 0)",
  );
  srv.db.transaction(() => {
    for (let i = 0; i < 200; i++) ins.run(c.user.id, 1000 + i);
  })();
  const res = await c.post('/api/scores', validScore({ score: 1100 }));
  assert.equal(res.status, 201);
  assert.equal(res.json.best, 1199);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM scores WHERE user_id = ?').get(c.user.id).n, 50);
  assert.equal(srv.db.prepare('SELECT MIN(score) AS m FROM scores WHERE user_id = ?').get(c.user.id).m, 1150);
  assert.deepEqual(
    (await c.get('/api/scores/me')).json.scores.map((s) => s.score),
    [1199, 1198, 1197, 1196, 1195, 1194, 1193, 1192, 1191, 1190],
  );

  // Bestenliste liest aus user_best (ein Eintrag je Spieler), Trigger halten sie aktuell
  const other = await registered(srv, 'andere');
  await other.post('/api/scores', validScore({ score: 1198 }));
  assert.deepEqual(srv.db.prepare('SELECT user_id, score FROM user_best ORDER BY user_id').all(), [
    { user_id: c.user.id, score: 1199 },
    { user_id: other.user.id, score: 1198 },
  ]);
  srv.db.prepare('DELETE FROM scores WHERE user_id = ? AND score = 1199').run(c.user.id);
  const lb = await srv.client().get('/api/leaderboard');
  assert.deepEqual(
    lb.json.scores.map((s) => [s.username, s.score]),
    [
      ['spammer', 1198], // gleicher Wert, aber früher erreicht
      ['andere', 1198],
    ],
  );
});

serverTest('Punkte: seed und area ohne HTML-Sonderzeichen', async (srv) => {
  const c = await registered(srv, 'xss');
  const payload = '<img src=x onerror=alert(1)>';
  for (const over of [{ seed: payload }, { area: payload }, { area: 'a"b' }, { seed: "a'b" }, { area: 'a&b' }, { area: 'x\ny' }]) {
    srv.advance(MINUTE);
    const res = await c.post('/api/scores', validScore(over));
    assert.equal(res.status, 400, JSON.stringify(over));
    assert.equal(typeof res.json.error, 'string');
  }
  for (const area of ['Ciudad Satélite', 'Valle de las Ánimas', 'Plaza España', '16 de Julio', '']) {
    srv.advance(MINUTE);
    const res = await c.post('/api/scores', validScore({ area, seed: 'X7K9Q2' }));
    assert.equal(res.status, 201, area);
  }
  for (const row of (await srv.client().get('/api/leaderboard')).json.scores) {
    assert.doesNotMatch(row.seed + row.area, /[<>&"']/);
  }
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM scores WHERE seed LIKE '%<%' OR area LIKE '%<%'").get().n, 0);
});

test('Migration: Bestwerte bestehender Datenbanken werden übernommen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleferico-migration-'));
  const dbPath = path.join(dir, 'alt.db');
  const old = new Database(dbPath);
  old.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  old.exec(MIGRATIONS[0].sql);
  old.prepare('INSERT INTO schema_version (version, applied_at) VALUES (1, 0)').run();
  old.exec(`
    INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'ana', 'x', 0), (2, 'ben', 'x', 0), (3, 'cy', 'x', 0);
    INSERT INTO scores (user_id, score, week, seed, area, play_time, created_at) VALUES
      (1, 50, 1, 's', 'a', 1, 10), (1, 90, 4, 's', 'Mallasa', 1, 20), (1, 90, 5, 's', 'b', 1, 30),
      (2, 70, 2, 's', 'a', 1, 5), (2, 10, 1, 's', 'a', 1, 6);
  `);
  old.close();
  const srv = await startServer({ dbPath });
  try {
    assert.equal(srv.db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v, MIGRATIONS.at(-1).version);
    const lb = await srv.client().get('/api/leaderboard');
    assert.deepEqual(
      lb.json.scores.map((s) => [s.username, s.score, s.week, s.area, s.createdAt]),
      [
        ['ana', 90, 4, 'Mallasa', 20],
        ['ben', 70, 2, 'a', 5],
      ],
    );
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- Rate-Limits

serverTest('Rate-Limit: 8 Fehlversuche pro Benutzername in 15 Minuten', async (srv) => {
  await registered(srv, 'lena', 'richtig123');
  const c = srv.client();
  for (let i = 1; i <= 8; i++) {
    const res = await c.post('/api/auth/login', { username: 'lena', password: `falsch${i}xx` });
    assert.equal(res.status, 401, `Versuch ${i}`);
  }
  const blocked = await c.post('/api/auth/login', { username: 'lena', password: 'falsch9xx' });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.json, { error: LOGIN_LIMITED });
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);

  // auch mit richtigem Passwort und anderer Schreibweise gesperrt
  assert.equal((await c.post('/api/auth/login', { username: 'lena', password: 'richtig123' })).status, 429);
  assert.equal((await c.post('/api/auth/login', { username: 'LENA', password: 'richtig123' })).status, 429);
  assert.equal(c.cookie, null);

  // andere Namen sind nicht betroffen
  assert.equal((await c.post('/api/auth/login', { username: 'jemand', password: 'falsch123' })).status, 401);

  srv.advance(15 * MINUTE);
  const again = await c.post('/api/auth/login', { username: 'lena', password: 'richtig123' });
  assert.equal(again.status, 200);

  // Erfolgreicher Login setzt den Zähler zurück
  for (let i = 0; i < 7; i++) await c.post('/api/auth/login', { username: 'lena', password: 'falsch123' });
  assert.equal((await c.post('/api/auth/login', { username: 'lena', password: 'richtig123' })).status, 200);
  for (let i = 0; i < 7; i++) {
    assert.equal((await c.post('/api/auth/login', { username: 'lena', password: 'falsch123' })).status, 401);
  }
});

serverTest('Rate-Limit: 30 Login-Versuche pro IP in 15 Minuten', async (srv) => {
  const c = srv.client();
  for (let i = 0; i < 30; i++) {
    const res = await c.post('/api/auth/login', { username: `user${i}`, password: 'falsch123' });
    assert.equal(res.status, 401, `Versuch ${i + 1}`);
  }
  const blocked = await c.post('/api/auth/login', { username: 'user99', password: 'falsch123' });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.json, { error: LOGIN_LIMITED });
  srv.advance(15 * MINUTE + 1);
  assert.equal((await c.post('/api/auth/login', { username: 'user99', password: 'falsch123' })).status, 401);
});

serverTest('Rate-Limit: 10 Registrierungen pro IP und Stunde', async (srv) => {
  for (let i = 0; i < 10; i++) await registered(srv, `neu${i}`);
  const blocked = await srv.client().post('/api/auth/register', { username: 'neu10', password: 'geheim123' });
  assert.equal(blocked.status, 429);
  assert.equal(typeof blocked.json.error, 'string');
  srv.advance(60 * MINUTE);
  await registered(srv, 'neu10');
});

test('RateLimiter: Speicher bleibt begrenzt', () => {
  let t = 0;
  const rl = new RateLimiter({ limit: 2, windowMs: 1000, now: () => t, maxKeys: 100 });
  for (let i = 0; i < 1000; i++) rl.hit(`k${i}`);
  assert.ok(rl.size <= 100);
  t = 5000;
  rl.hit('neu');
  assert.equal(rl.size, 1, 'abgelaufene Einträge werden entfernt');
  rl.hit('neu');
  assert.equal(rl.blocked('neu'), true);
  rl.reset('neu');
  assert.equal(rl.blocked('neu'), false);
});

test('RateLimiter: gleitendes Fenster – an der Grenze kein doppeltes Kontingent', () => {
  let t = 0;
  const rl = new RateLimiter({ limit: 8, windowMs: 15 * MINUTE, now: () => t });
  rl.hit('k');
  t = 15 * MINUTE - 1000;
  for (let i = 0; i < 7; i++) {
    assert.equal(rl.blocked('k'), false);
    rl.hit('k');
  }
  assert.equal(rl.blocked('k'), true);
  assert.equal(rl.retryAfter('k'), 1, 'erster Versuch fällt in 1 s heraus');
  t = 15 * MINUTE; // nur der erste Versuch ist abgelaufen
  assert.equal(rl.blocked('k'), false);
  rl.hit('k');
  assert.equal(rl.blocked('k'), true);
  assert.equal(rl.retryAfter('k'), 14 * 60 + 59);
  t = 30 * MINUTE - 1000;
  assert.equal(rl.blocked('k'), false);
});

serverTest('Rate-Limit: an der Fenstergrenze höchstens 8 Fehlversuche in 15 Minuten', async (srv) => {
  await registered(srv, 'victim', 'richtig123');
  const c = srv.client();
  const fail = async () => (await c.post('/api/auth/login', { username: 'victim', password: 'falsch123' })).status;
  assert.equal(await fail(), 401);
  srv.advance(15 * MINUTE - 1000);
  for (let i = 0; i < 7; i++) assert.equal(await fail(), 401);
  srv.advance(1000);
  const statuses = [];
  for (let i = 0; i < 8; i++) statuses.push(await fail());
  assert.deepEqual(statuses, [401, 429, 429, 429, 429, 429, 429, 429]);
});

test('RateLimiter: volle Tabelle verdrängt keine laufenden Zähler', () => {
  let t = 0;
  const rl = new RateLimiter({ limit: 2, windowMs: 1000, now: () => t, maxKeys: 3 });
  rl.hit('opfer');
  rl.hit('opfer');
  assert.equal(rl.blocked('opfer'), true);
  t = 10;
  for (let i = 0; i < 50; i++) if (!rl.blocked(`müll${i}`)) rl.hit(`müll${i}`);
  assert.equal(rl.size, 3);
  assert.equal(rl.blocked('opfer'), true, 'Sperre bleibt trotz Flut bestehen');
  assert.equal(rl.blocked('neu'), true, 'neue Schlüssel bei voller Tabelle gesperrt');
  assert.equal(rl.retryAfter('neu'), 1);
  t = 1000; // die Einträge von „opfer“ laufen ab und machen Platz
  assert.equal(rl.blocked('neu'), false);
  assert.equal(rl.blocked('opfer'), false);
});

test('ipKey: IPv4 je Adresse, IPv6 je /64-Netz', () => {
  assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('::FFFF:cb00:7107'), '203.0.113.7');
  assert.equal(ipKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:0DB8:0001:0002::5'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8::'), '2001:db8:0:0::/64');
  assert.equal(ipKey('64:ff9b::192.0.2.1'), '64:ff9b:0:0::/64');
  assert.notEqual(ipKey('2001:db8:1:3::1'), ipKey('2001:db8:1:2::1'));
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  assert.equal(ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey(undefined), 'unbekannt');
});

serverTest(
  'Rate-Limit: IPv6-Clients zählen je /64-Netz',
  async (srv) => {
    const c = srv.client();
    const from = (ip) => ({ headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < 30; i++) {
      const res = await c.post(
        '/api/auth/login',
        { username: `user${i}`, password: 'falsch123' },
        from(`2001:db8:1:2::${(i + 1).toString(16)}`),
      );
      assert.equal(res.status, 401, `Versuch ${i + 1}`);
    }
    const rotated = await c.post(
      '/api/auth/login',
      { username: 'user99', password: 'falsch123' },
      from('2001:db8:1:2:dead:beef:0:1'),
    );
    assert.equal(rotated.status, 429);
    const otherNet = await c.post('/api/auth/login', { username: 'user99', password: 'falsch123' }, from('2001:db8:1:3::1'));
    assert.equal(otherNet.status, 401);
  },
  { trustProxy: 1 },
);

test('TRUST_PROXY wird streng ausgewertet', () => {
  for (const v of [undefined, '', '0', 'false', 'FALSE', 'no', 'off']) assert.equal(parseTrustProxy(v), false, String(v));
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) assert.equal(parseTrustProxy(v), 1, v);
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('10.0.0.0/8, 192.168.1.1,::1,fd00::/8'), '10.0.0.0/8, 192.168.1.1, ::1, fd00::/8');
  for (const v of ['quatsch', 'yes please', '10.0.0.0/33', '1.2.3', '-1', '1.5', 'loopback,,10.0.0.1', '10.0.0.0/8/1']) {
    assert.throws(() => parseTrustProxy(v), /TRUST_PROXY/, v);
  }
});

/** Startet server/index.js als eigenen Prozess; stopAfterStart beendet ihn nach der Startmeldung. */
function runIndex(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleferico-index-'));
  const child = spawn(process.execPath, [path.join(ROOT_DIR, 'server', 'index.js')], {
    env: { ...process.env, PORT: '0', TELEFERICO_DB: path.join(dir, 'db', 't.db'), COOKIE_SECURE: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d;
    if (stdout.includes('läuft auf')) child.kill('SIGTERM');
  });
  child.stderr.on('data', (d) => (stderr += d));
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  return new Promise((resolve) => {
    child.on('exit', (code) => {
      clearTimeout(timer);
      const dbDirCreated = fs.existsSync(path.join(dir, 'db'));
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, stdout, stderr, dbDirCreated });
    });
  });
}

test('server/index.js: ungültiges TRUST_PROXY bricht mit Meldung ab, gültiges wird angezeigt', async () => {
  const bad = await runIndex({ TRUST_PROXY: 'quatsch' });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /Ungültiger Wert für TRUST_PROXY/);
  assert.equal(bad.dbDirCreated, false);

  const good = await runIndex({ TRUST_PROXY: 'true' });
  assert.equal(good.code, 0, good.stderr);
  assert.match(good.stdout, /läuft auf http:\/\/localhost:\d+ .*TRUST_PROXY: 1\)/);
});

// ---------------------------------------------------------------- CSRF

serverTest('CSRF: fremde Herkunft → 403', async (srv) => {
  const body = { username: 'mallory', password: 'geheim123' };
  const evil = await srv.client().post('/api/auth/register', body, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(typeof evil.json.error, 'string');

  const sameHostOtherPort = await srv.client().post('/api/auth/register', body, {
    headers: { origin: 'http://127.0.0.1:1' },
  });
  assert.equal(sameHostOtherPort.status, 403);

  const nullOrigin = await srv.client().post('/api/auth/register', body, { headers: { origin: 'null' } });
  assert.equal(nullOrigin.status, 403);

  const crossSite = await srv.client().post('/api/auth/register', body, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);

  // gleiche Herkunft ist erlaubt
  const same = await srv.client().post('/api/auth/register', body, {
    headers: { origin: srv.base, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(same.status, 201);

  // auch angemeldete Anfragen werden geprüft
  const c = srv.client();
  c.cookie = same.setCookies[0].match(/^tf_session=([^;]+)/)[1];
  const put = await c.put('/api/saves/x', { meta: {}, data: {} }, { headers: { origin: 'https://evil.example' } });
  assert.equal(put.status, 403);
  const beacon = await c.post('/api/saves/x/beacon', undefined, {
    raw: JSON.stringify({ meta: {}, data: {} }),
    headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(beacon.status, 403);
  const logout = await c.post('/api/auth/logout', undefined, { headers: { origin: 'https://evil.example' } });
  assert.equal(logout.status, 403);
  assert.equal((await c.get('/api/saves')).json.saves.length, 0);

  // Lesende Anfragen bleiben erlaubt
  const read = await c.get('/api/auth/me', { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  assert.equal(read.status, 200);
  assert.equal(read.json.user.username, 'mallory');
});

// ---------------------------------------------------------------- Frontend-Auslieferung

serverTest('Statische Dateien: Frontend wird ausgeliefert', async (srv) => {
  const c = srv.client();
  for (const url of ['/', '/index.html']) {
    const res = await c.get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('cache-control'), /no-cache/);
    assert.match(res.text, /<title>Teleférico<\/title>/);
  }
  const css = await c.get('/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  for (const url of ['/src/main.js', '/src/api.js']) {
    const res = await c.get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /javascript/);
  }
  assert.equal(
    (await c.get('/src/main.js')).text,
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.js'), 'utf8'),
  );
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff');

});

serverTest('Statische Dateien: nichts außerhalb des Frontends', async (srv) => {
  const c = srv.client();
  const forbidden = [
    '/server/app.js',
    '/server/index.js',
    '/server/data/teleferico.db',
    '/package.json',
    '/package-lock.json',
    '/node_modules/express/package.json',
    '/.git/HEAD',
    '/.gitignore',
    '/README.md',
    '/tools/simulate.mjs',
    '/tests/server.test.mjs',
    '/src',
    '/src/',
    '/src/.hidden',
    '/favicon.ico',
    '/reference/la-paz-topo.png',
  ];
  for (const url of forbidden) {
    const res = await c.get(url);
    assert.equal(res.status, 404, url);
    assert.match(res.headers.get('content-type'), /text\/plain/, url);
  }
  assert.equal((await c.post('/', {})).status, 404);

  const unknownApi = await c.get('/api/gibtsnicht');
  assert.equal(unknownApi.status, 404);
  assert.equal(typeof unknownApi.json.error, 'string');
});

serverTest('Statische Dateien: Path-Traversal ist unmöglich', async (srv) => {
  const attempts = [
    '/src/../server/app.js',
    '/src/../package.json',
    '/src/%2e%2e/server/app.js',
    '/src/%2E%2E/package.json',
    '/src/..%2fserver%2fapp.js',
    '/src/%2e%2e%2fserver%2fapp.js',
    '/src/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/src/..%5cserver%5capp.js',
    '/src//../server/app.js',
    '/src/./../server/app.js',
    '/src/....//server/app.js',
    '/src%2f..%2fserver%2fapp.js',
    '/reference/../package.json',
    '/reference/%2e%2e/server/app.js',
    '/%2e%2e/package.json',
    '/../package.json',
    '/src/%00../server/app.js',
  ];
  for (const p of attempts) {
    const res = await rawGet(srv.base, p);
    assert.notEqual(res.status, 200, p);
    assert.doesNotMatch(res.body, /createApp|"dependencies"|root:x:0/, p);
  }
});

// ---------------------------------------------------------------- Browser-Client

/** Ersetzt fetch für src/api.js: relative URLs auf den Testserver, Cookies wie im Browser. */
function shimFetch(base, seen) {
  const realFetch = globalThis.fetch;
  let cookie = null;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url, init });
    const headers = { ...(init.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const res = await realFetch(new URL(url, `${base}/`), { ...init, headers });
    for (const c of setCookiesOf(res.headers)) {
      if (!/;\s*Path=\/(;|$)/.test(c)) continue;
      const pair = c.split(';')[0];
      cookie = pair.endsWith('=') ? null : pair;
    }
    return res;
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

serverTest('Browser-Client src/api.js gegen den Server', async (srv) => {
  const { api, ApiError } = await import('../src/api.js');
  const seen = [];
  const restore = shimFetch(srv.base, seen);
  try {
    assert.equal(await api.probe(), true);
    assert.equal(api.available, true);
    assert.equal(await api.me(), null);
    assert.equal(api.user, null);

    await assert.rejects(
      api.login('niemand', 'falsch123'),
      (e) => e instanceof ApiError && e.status === 401 && e.message === LOGIN_FAILED,
    );
    const user = await api.register('client', 'geheim123');
    assert.equal(user.username, 'client');
    assert.deepEqual(api.user, user);
    await assert.rejects(api.register('CLIENT', 'geheim123'), (e) => e instanceof ApiError && e.status === 409);
    assert.deepEqual(await api.me(), user);

    assert.equal((await api.putSave('auto', { week: 1 }, { a: 1 })).slot, 'auto');
    assert.deepEqual(
      (await api.listSaves()).map((s) => s.slot),
      ['auto'],
    );
    assert.deepEqual((await api.getSave('auto')).data, { a: 1 });
    assert.equal(await api.getSave('fehlt'), null);
    await assert.rejects(api.putSave('BAD', {}, {}), (e) => e instanceof ApiError && e.status === 400 && !!e.message);
    assert.equal(await api.deleteSave('auto'), true);
    assert.equal(await api.deleteSave('auto'), false);

    const sc = await api.submitScore({ score: 42, week: 2, seed: 123456, area: 'Centro', time: 12.5 });
    assert.equal(sc.best, 42);
    assert.equal((await api.myScores())[0].seed, '123456');
    assert.deepEqual(
      (await api.leaderboard()).map((s) => [s.username, s.score]),
      [['client', 42]],
    );

    // Node hat kein navigator.sendBeacon → false statt Ausnahme
    assert.equal(api.beaconSave('auto', {}, {}), false);

    await api.logout();
    assert.equal(api.user, null);
    assert.equal(await api.me(), null);

    for (const { url, init } of seen) {
      assert.match(url, /^api\//, 'relative API-URL');
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.headers['X-Requested-With'], 'teleferico');
      if (init.body !== undefined) assert.equal(init.headers['Content-Type'], 'application/json');
    }
  } finally {
    restore();
  }
});

test('Browser-Client: ohne Backend wirft probe() nie', async () => {
  const { api, ApiError } = await import('../src/api.js');
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    assert.equal(await api.probe(), false);
    assert.equal(api.available, false);
    await assert.rejects(
      api.login('jemand', 'geheim123'),
      (e) => e instanceof ApiError && e.status === 0 && e.message === 'Server nicht erreichbar.',
    );

    // statischer Server ohne API (z. B. "npx serve .")
    globalThis.fetch = async () => new Response('Not Found', { status: 404 });
    assert.equal(await api.probe(), false);
    // SPA-Fallback liefert HTML mit Status 200
    globalThis.fetch = async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    assert.equal(await api.probe(), false);

    // hängender Server: Abbruch nach 2,5 s
    globalThis.fetch = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError')));
      });
    const t0 = Date.now();
    assert.equal(await api.probe(), false);
    const waited = Date.now() - t0;
    assert.ok(waited >= 2400 && waited < 4000, `Timeout nach ${waited} ms`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
