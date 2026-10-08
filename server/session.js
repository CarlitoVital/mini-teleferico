// Sitzungs-Token und Cookie-Helfer (ohne cookie-parser).
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'tf_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 32 Zufallsbytes in base64url = 43 Zeichen
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** In der Datenbank liegt nur der SHA-256 des Tokens. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function isWellFormedToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** Zerlegt den Cookie-Header in [Name, Wert]-Paare (in Header-Reihenfolge, auch doppelte Namen). */
function cookiePairs(header) {
  const out = [];
  if (typeof header !== 'string' || !header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    let value = part.slice(i + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // Wert bleibt roh
    }
    out.push([name, value]);
  }
  return out;
}

/** Zerlegt den Cookie-Header; bei doppelten Namen gewinnt der erste. */
export function parseCookies(header) {
  const out = Object.create(null);
  for (const [name, value] of cookiePairs(header)) if (!(name in out)) out[name] = value;
  return out;
}

/** Alle Werte eines Cookies – gleichnamige Cookies mit anderem Path/Domain kommen mehrfach an. */
export function cookieValues(header, name) {
  return cookiePairs(header)
    .filter(([n]) => n === name)
    .map(([, v]) => v);
}

function cookieAttrs(maxAgeSec, secure, cookiePath = '/') {
  return `Max-Age=${maxAgeSec}; Path=${cookiePath}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function sessionCookie(token, secure) {
  return `${SESSION_COOKIE}=${token}; ${cookieAttrs(Math.floor(SESSION_TTL_MS / 1000), secure)}`;
}

/** Löscht das Cookie; mit cookiePath auch ein gleichnamiges Cookie mit engerem Pfad. */
export function clearedSessionCookie(secure, cookiePath = '/') {
  return `${SESSION_COOKIE}=; ${cookieAttrs(0, secure, cookiePath)}`;
}
