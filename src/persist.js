// Spielstände lokal (IndexedDB) und – wenn angemeldet – zusätzlich im Konto auf dem Server.
//
// Lokal hat jedes Konto seinen eigenen Bereich („u:<name>:<slot>“), Gast-Stände liegen unter dem
// reinen Slot-Namen. So sieht nach einem Abmelden oder Kontowechsel niemand die Stände eines
// anderen Kontos, und ein Gast schreibt nie in sie hinein.
import { localSaves } from './storage.js';
import { api, ApiError } from './api.js';
import { serializeGame, saveMeta } from './save.js';
import { storageGet, storageSet } from './util.js';

export const SLOTS = [
  { id: 'auto', label: 'Automatisch gespeichert', kind: 'auto' },
  { id: 'slot-1', label: 'Speicherplatz 1', kind: 'slot' },
  { id: 'slot-2', label: 'Speicherplatz 2', kind: 'slot' },
  { id: 'slot-3', label: 'Speicherplatz 3', kind: 'slot' },
];

const isSlot = (id) => SLOTS.some((s) => s.id === id);

const labelFor = (id) => {
  const s = SLOTS.find((x) => x.id === id);
  if (s) return s.label;
  const m = /^import-(\d+)$/.exec(id);
  return m ? `Übernommen ${m[1]}` : id;
};

const userName = () => (api.user ? String(api.user.username).toLowerCase() : null);
const prefixFor = (name) => (name ? `u:${name}:` : '');
/** Schlüssel in IndexedDB für einen Slot des aktuellen Kontos (bzw. des Gasts). */
const localKey = (slot) => prefixFor(userName()) + slot;

/** Gast-Zeile: ohne Kontobereich und nie einem Konto gehörend. */
const isGuestRow = (r) => !r.id.startsWith('u:') && isSlot(r.id) && r.meta && !r.meta.owner;

// Beendete Runden merken, damit ein liegen gebliebener Autosave sie nicht wieder aufleben lässt
const FINISHED_KEY = 'teleferico.finished';
const FINISHED_MAX = 60;
function finishedRuns() {
  try {
    const list = JSON.parse(storageGet(FINISHED_KEY, '[]'));
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function rememberFinished(runIds) {
  const set = finishedRuns();
  const before = set.size;
  for (const id of runIds) if (id) set.add(id);
  if (set.size !== before) storageSet(FINISHED_KEY, JSON.stringify([...set].slice(-FINISHED_MAX)));
}

/** Autosave-Eintrag einer Runde, die schon zu Ende ist (Markierung im Konto oder lokal bekannt)? */
const isFinishedAuto = (meta, finished) => !!meta && (meta.over === true || (meta.runId && finished.has(meta.runId)));

const newer = (a, b) => ((a?.savedAt || 0) >= (b?.savedAt || 0) ? a : b);

export class Persistence {
  constructor() {
    /** Wird aufgerufen, wenn der Server die Sitzung nicht mehr kennt (abgemeldet/abgelaufen). */
    this.onSessionLost = null;
  }

  get online() {
    return api.available && !!api.user;
  }

  /** 401 vom Server: lokal abmelden, damit nichts mehr unbemerkt am Konto vorbei gespeichert wird. */
  #check(err) {
    if (err instanceof ApiError && err.status === 401 && api.user) {
      api.user = null;
      if (this.onSessionLost) this.onSessionLost();
    }
    return err;
  }

  snapshot(game, camera, runId) {
    // owner: null = als Gast gespeichert (kann später ins Konto übernommen werden)
    const owner = api.user ? api.user.username : null;
    return { meta: saveMeta(game, { runId, owner }), data: serializeGame(game, camera) };
  }

  /** Speichert lokal und (falls angemeldet) im Konto. Liefert { local, server, error }. */
  async save(slotId, game, camera, runId) {
    const key = localKey(slotId);
    const online = this.online;
    const { meta, data } = this.snapshot(game, camera, runId);
    const result = { local: false, server: null, error: null };
    try {
      result.local = await localSaves.put(key, meta, data);
    } catch {
      result.local = false;
    }
    if (online) {
      try {
        await api.putSave(slotId, meta, data);
        result.server = true;
      } catch (err) {
        this.#check(err);
        result.server = false;
        result.error = err.message;
      }
    }
    return result;
  }

  /** Beim Verlassen der Seite: lokal schreiben und per Beacon ans Konto schicken. */
  saveOnExit(game, camera, runId) {
    try {
      const { meta, data } = this.snapshot(game, camera, runId);
      localSaves.put(localKey('auto'), meta, data);
      if (this.online) api.beaconSave('auto', meta, data);
    } catch {
      // beim Verlassen nichts mehr melden
    }
  }

  /** Lokale Zeilen des aktuellen Kontos (bzw. des Gasts) als Map slot → row. */
  async #localRows() {
    const out = new Map();
    let rows = [];
    try {
      rows = await localSaves.list();
    } catch {
      rows = [];
    }
    const name = userName();
    const prefix = prefixFor(name);
    for (const r of rows) {
      if (name) {
        if (r.id.startsWith(prefix)) out.set(r.id.slice(prefix.length), r);
      } else if (isGuestRow(r)) {
        out.set(r.id, r);
      }
    }
    return out;
  }

  async #serverRows() {
    try {
      return { rows: await api.listSaves(), error: null };
    } catch (err) {
      this.#check(err);
      return { rows: [], error: err.message };
    }
  }

  /**
   * Einträge für die Liste (lokale Plätze immer, Konto-Plätze wenn angemeldet).
   * Liefert { entries, error } – error, wenn die Konto-Liste nicht geladen werden konnte.
   */
  async list() {
    // Nur der automatische Stand einer beendeten Runde verschwindet – manuell gespeicherte Plätze bleiben
    const finished = finishedRuns();
    const visible = (slot, meta) => (slot.kind === 'auto' && isFinishedAuto(meta, finished) ? null : meta || null);
    const local = await this.#localRows();
    const entries = SLOTS.map((s) => ({ ...s, source: 'local', meta: visible(s, local.get(s.id)?.meta) }));
    let error = null;
    if (this.online) {
      const server = await this.#serverRows();
      error = server.error;
      if (!error) {
        const byId = new Map(server.rows.map((r) => [r.slot, r]));
        for (const s of SLOTS) entries.push({ ...s, source: 'server', meta: visible(s, byId.get(s.id)?.meta) });
        for (const r of server.rows) {
          if (!isSlot(r.slot)) entries.push({ id: r.slot, label: labelFor(r.slot), kind: 'import', source: 'server', meta: r.meta });
        }
      }
    }
    return { entries, error };
  }

  /**
   * Plätze für „Spiel speichern“: Angemeldet wird lokal und im Konto zugleich geschrieben,
   * deshalb zeigt jeder Platz den neueren der beiden Stände (sonst würde ein belegter
   * Konto-Platz als „leer“ erscheinen und unbemerkt überschrieben).
   */
  async saveSlots() {
    const local = await this.#localRows();
    let server = new Map();
    let error = null;
    if (this.online) {
      const res = await this.#serverRows();
      error = res.error;
      server = new Map(res.rows.map((r) => [r.slot, r]));
    }
    const online = this.online; // nach einem 401 nicht mehr angemeldet
    const entries = SLOTS.filter((s) => s.kind === 'slot').map((s) => {
      const l = local.get(s.id)?.meta || null;
      const r = server.get(s.id)?.meta || null;
      return { ...s, source: online ? 'both' : 'local', meta: online ? newer(l, r) : l, hasLocal: !!l, hasServer: !!r };
    });
    return { entries, error };
  }

  async loadData(entry) {
    if (entry.source === 'server') {
      let row;
      try {
        row = await api.getSave(entry.id);
      } catch (err) {
        throw this.#check(err);
      }
      if (!row) throw new Error('Spielstand nicht gefunden.');
      return row.data;
    }
    const row = await localSaves.get(entry.key || localKey(entry.id));
    if (!row) throw new Error('Spielstand nicht gefunden.');
    return row.data;
  }

  async remove(entry) {
    if (entry.source === 'server' || entry.source === 'both') {
      try {
        await api.deleteSave(entry.id);
      } catch (err) {
        throw this.#check(err);
      }
    }
    if (entry.source !== 'server') await localSaves.remove(localKey(entry.id));
  }

  /**
   * Neuester automatischer Spielstand für „Weiterspielen“: eigener lokaler, im Konto oder –
   * angemeldet – auch der des Gasts auf diesem Gerät (wird beim Weiterspielen zum Konto-Stand).
   * Stände beendeter Runden zählen nicht.
   */
  async latestAuto() {
    const candidates = [];
    const local = await this.#localRows();
    if (local.get('auto')?.meta) candidates.push({ ...SLOTS[0], source: 'local', meta: local.get('auto').meta });
    if (api.user) {
      try {
        const guest = (await localSaves.list()).find((r) => r.id === 'auto' && isGuestRow(r));
        if (guest) candidates.push({ ...SLOTS[0], source: 'local', key: 'auto', meta: guest.meta });
      } catch {
        // ohne Speicher keine Gast-Stände
      }
    }
    if (this.online) {
      const server = await this.#serverRows();
      const row = server.rows.find((r) => r.slot === 'auto');
      if (row?.meta) candidates.push({ ...SLOTS[0], source: 'server', meta: row.meta });
    }
    // Im Konto als beendet markierte Runden auch lokal merken (Runde auf einem anderen Gerät beendet)
    rememberFinished(candidates.filter((c) => c.meta.over === true).map((c) => c.meta.runId));
    const finished = finishedRuns();
    const live = candidates.filter((c) => !isFinishedAuto(c.meta, finished));
    live.sort((a, b) => (b.meta.savedAt || 0) - (a.meta.savedAt || 0));
    return live[0] || null;
  }

  /**
   * Eine Runde ist zu Ende: lokal merken, eigenen lokalen Autosave dieser Runde löschen und im
   * Konto durch eine Markierung ersetzen – so bietet auch ein anderes Gerät sie nicht mehr an.
   */
  async finishRun(runId) {
    if (!runId) return;
    rememberFinished([runId]);
    try {
      const local = await this.#localRows();
      if (local.get('auto')?.meta?.runId === runId) await localSaves.remove(localKey('auto'));
    } catch {
      // egal – die Runde ist als beendet gemerkt
    }
    if (!this.online) return;
    try {
      const server = await this.#serverRows();
      const row = server.rows.find((r) => r.slot === 'auto');
      if (row?.meta?.runId === runId && !row.meta.over) {
        await api.putSave('auto', { runId, over: true, savedAt: Date.now(), owner: api.user.username }, { over: true });
      }
    } catch (err) {
      this.#check(err);
    }
  }

  /** Lokale Stände, die als Gast gespeichert und noch nicht in dieses Konto übernommen wurden. */
  async guestRows() {
    const name = userName();
    const finished = finishedRuns();
    try {
      return (await localSaves.list()).filter(
        (r) =>
          isGuestRow(r) &&
          !(r.id === 'auto' && isFinishedAuto(r.meta, finished)) &&
          !(name && (r.meta.importedBy || []).includes(name)),
      );
    } catch {
      return [];
    }
  }

  /** Gibt es lokale Gast-Spielstände, die ins Konto übernommen werden könnten? */
  async hasLocal() {
    return (await this.guestRows()).length > 0;
  }

  /**
   * Lokale Gast-Stände ins Konto übernehmen. Belegte Konto-Plätze werden nicht überschrieben –
   * dann landet der Stand unter „Übernommen N“. Der Gast-Stand bleibt auf dem Gerät, wird diesem
   * Konto aber nicht noch einmal angeboten. Liefert die Anzahl übernommener Stände.
   */
  async importLocal() {
    if (!this.online) return 0;
    const name = userName();
    let server;
    try {
      server = new Set((await api.listSaves()).map((r) => r.slot));
    } catch (err) {
      throw this.#check(err);
    }
    let n = 0;
    let next = 1;
    for (const row of await this.guestRows()) {
      const full = await localSaves.get(row.id);
      if (!full) continue;
      let target = row.id;
      if (server.has(target)) {
        while (server.has(`import-${next}`)) next++;
        target = `import-${next}`;
      }
      const { importedBy, ...meta } = full.meta;
      try {
        await api.putSave(target, { ...meta, importedFrom: row.id, owner: api.user.username }, full.data);
      } catch (err) {
        throw this.#check(err);
      }
      server.add(target);
      // Gast-Stand als übernommen markieren (bleibt Gast-Stand, owner bleibt leer)
      await localSaves.put(row.id, { ...full.meta, importedBy: [...(importedBy || []), name] }, full.data);
      n++;
    }
    return n;
  }
}
