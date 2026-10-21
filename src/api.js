// Browser-Client für das optionale Teleférico-Backend (Konto, Spielstände, Bestenliste).
// Läuft die Seite ohne Backend (z. B. "npx serve ."), liefert probe() einfach false.
import { t, has, getLang } from './i18n.js';

// Relativ zur Seite, damit es auch unter einem Unterpfad hinter einem Proxy funktioniert
const BASE = 'api/';
const PROBE_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 15000;
/**
 * Fehler der Server-API. Die Meldung wird erst beim Lesen erzeugt – so erscheint sie nach einem
 * Sprachwechsel in der neuen Sprache (z. B. in einem noch offenen Dialog).
 */
export class ApiError extends Error {
  constructor(status, code = null, { key = null, payload = null } = {}) {
    super();
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.key = key;
    this.payload = payload;
  }

  get message() {
    return this.key ? t(this.key) : errorMessage(this.payload, this.status);
  }

  toString() {
    return this.message;
  }
}

function fallbackMessage(status) {
  if (status === 401) return t('err.status401');
  if (status === 404) return t('err.status404');
  if (status === 413) return t('err.status413');
  if (status === 429) return t('err.status429');
  if (status >= 500) return t('err.status5xx');
  return t('err.generic');
}

/** Fehlertext in der aktuellen Sprache: über den Fehlercode des Servers, sonst nach Status. */
function errorMessage(payload, status) {
  const code = payload && typeof payload.code === 'string' ? payload.code : null;
  if (code && has(`err.${code}`)) return t(`err.${code}`, payload.params || {});
  // Server-Texte sind deutsch – in anderen Sprachen lieber die allgemeine Meldung
  if (payload && typeof payload.error === 'string' && getLang() === 'de') return payload.error;
  return fallbackMessage(status);
}

async function request(method, path, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const headers = { 'X-Requested-With': 'teleferico' };
  const init = { method, credentials: 'same-origin', headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let ctrl = null;
  let timer = 0;
  if (typeof AbortController === 'function') {
    ctrl = new AbortController();
    init.signal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  }
  let res;
  let payload = null;
  try {
    res = await fetch(BASE + path, init);
    if (res.status !== 204) {
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
    }
  } catch {
    throw new ApiError(0, 'offline', { key: 'err.offline' });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new ApiError(res.status, payload && typeof payload.code === 'string' ? payload.code : null, { payload });
  }
  if (res.status !== 204 && (payload === null || typeof payload !== 'object')) {
    throw new ApiError(res.status, null, { key: 'err.badResponse' });
  }
  return payload;
}

const slotPath = (slot) => `saves/${encodeURIComponent(String(slot))}`;

export const api = {
  available: false,
  user: null,

  /** Prüft, ob das Backend erreichbar ist. Wirft nie. */
  async probe() {
    try {
      const data = await request('GET', 'health', undefined, PROBE_TIMEOUT_MS);
      api.available = data.ok === true;
    } catch {
      api.available = false;
    }
    return api.available;
  },

  /** Aktuell angemeldeter Benutzer oder null. */
  async me() {
    const data = await request('GET', 'auth/me');
    api.user = data.user || null;
    return api.user;
  },

  async register(username, password) {
    const data = await request('POST', 'auth/register', { username, password });
    api.user = data.user;
    return api.user;
  },

  async login(username, password) {
    const data = await request('POST', 'auth/login', { username, password });
    api.user = data.user;
    return api.user;
  },

  async logout() {
    await request('POST', 'auth/logout');
    api.user = null;
  },

  /** Liste [{slot, meta, updatedAt}], neueste zuerst (ohne Spieldaten). */
  async listSaves() {
    return (await request('GET', 'saves')).saves;
  },

  /** {slot, meta, data, updatedAt} oder null, wenn es den Spielstand nicht gibt. */
  async getSave(slot) {
    try {
      return await request('GET', slotPath(slot));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },

  /** Liefert {slot, updatedAt}. */
  async putSave(slot, meta, data) {
    return request('PUT', slotPath(slot), { meta, data });
  },

  /** true, wenn gelöscht; false, wenn es den Spielstand nicht (mehr) gab. */
  async deleteSave(slot) {
    try {
      await request('DELETE', slotPath(slot));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return false;
      throw err;
    }
  },

  /** Liefert {id, best}. */
  async submitScore({ score, week, seed, area, time }) {
    return request('POST', 'scores', { score, week, seed: String(seed ?? ''), area: String(area ?? ''), time });
  },

  /** Eigene Top 10: [{score, week, seed, area, time, createdAt}]. */
  async myScores() {
    return (await request('GET', 'scores/me')).scores;
  },

  /** Öffentliche Top 20, ein Eintrag pro Spieler. */
  async leaderboard() {
    return (await request('GET', 'leaderboard')).scores;
  },

  /** Speichern beim Verlassen der Seite. Liefert true, wenn der Browser die Anfrage angenommen hat. Wirft nie. */
  beaconSave(slot, meta, data) {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
      // text/plain ist CORS-unbedenklich; manche Browser lehnen Beacons mit application/json ab
      const blob = new Blob([JSON.stringify({ meta, data })], { type: 'text/plain;charset=UTF-8' });
      return navigator.sendBeacon(`${BASE}${slotPath(slot)}/beacon`, blob);
    } catch {
      return false;
    }
  },
};
