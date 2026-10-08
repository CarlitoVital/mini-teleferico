// Browser-Client für das optionale Teleférico-Backend (Konto, Spielstände, Bestenliste).
// Läuft die Seite ohne Backend (z. B. "npx serve ."), liefert probe() einfach false.

// Relativ zur Seite, damit es auch unter einem Unterpfad hinter einem Proxy funktioniert
const BASE = 'api/';
const PROBE_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 15000;
const OFFLINE = 'Server nicht erreichbar.';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function fallbackMessage(status) {
  if (status === 401) return 'Nicht angemeldet.';
  if (status === 404) return 'Nicht gefunden.';
  if (status === 413) return 'Daten zu groß.';
  if (status === 429) return 'Zu viele Anfragen. Bitte später erneut versuchen.';
  if (status >= 500) return 'Serverfehler. Bitte später erneut versuchen.';
  return 'Anfrage fehlgeschlagen.';
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
    throw new ApiError(OFFLINE, 0);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = payload && typeof payload.error === 'string' ? payload.error : fallbackMessage(res.status);
    throw new ApiError(msg, res.status);
  }
  if (res.status !== 204 && (payload === null || typeof payload !== 'object')) {
    throw new ApiError('Ungültige Antwort vom Server.', res.status);
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
