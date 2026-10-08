// Spielstände lokal (IndexedDB) und – wenn angemeldet – zusätzlich im Konto auf dem Server.
import { localSaves } from './storage.js';
import { api } from './api.js';
import { serializeGame, saveMeta } from './save.js';

export const SLOTS = [
  { id: 'auto', label: 'Automatisch gespeichert', kind: 'auto' },
  { id: 'slot-1', label: 'Speicherplatz 1', kind: 'slot' },
  { id: 'slot-2', label: 'Speicherplatz 2', kind: 'slot' },
  { id: 'slot-3', label: 'Speicherplatz 3', kind: 'slot' },
];

const labelFor = (id) => {
  const s = SLOTS.find((x) => x.id === id);
  if (s) return s.label;
  const m = /^import-(\d+)$/.exec(id);
  return m ? `Übernommen ${m[1]}` : id;
};

export class Persistence {
  get online() {
    return api.available && !!api.user;
  }

  snapshot(game, camera, runId) {
    // owner: null = als Gast gespeichert (kann später ins Konto übernommen werden)
    const owner = api.user ? api.user.username : null;
    return { meta: saveMeta(game, { runId, owner }), data: serializeGame(game, camera) };
  }

  /** Speichert lokal und (falls angemeldet) im Konto. Liefert { local, server, error }. */
  async save(slotId, game, camera, runId) {
    const { meta, data } = this.snapshot(game, camera, runId);
    const result = { local: false, server: null, error: null };
    try {
      result.local = await localSaves.put(slotId, meta, data);
    } catch {
      result.local = false;
    }
    if (this.online) {
      try {
        await api.putSave(slotId, meta, data);
        result.server = true;
      } catch (err) {
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
      localSaves.put('auto', meta, data);
      if (this.online) api.beaconSave('auto', meta, data);
    } catch {
      // beim Verlassen nichts mehr melden
    }
  }

  /** Einträge für die Liste (lokale Plätze immer, Konto-Plätze wenn angemeldet). */
  async entries() {
    const local = new Map();
    try {
      for (const row of await localSaves.list()) local.set(row.id, row);
    } catch {
      // ohne Speicher: leere Liste
    }
    const out = SLOTS.map((s) => ({ ...s, source: 'local', meta: local.get(s.id)?.meta || null }));
    if (this.online) {
      let server = [];
      try {
        server = await api.listSaves();
      } catch {
        server = [];
      }
      const byId = new Map(server.map((r) => [r.slot, r]));
      for (const s of SLOTS) out.push({ ...s, source: 'server', meta: byId.get(s.id)?.meta || null });
      for (const r of server) {
        if (!SLOTS.some((s) => s.id === r.slot)) out.push({ id: r.slot, label: labelFor(r.slot), kind: 'import', source: 'server', meta: r.meta });
      }
    }
    return out;
  }

  async loadData(entry) {
    if (entry.source === 'server') {
      const row = await api.getSave(entry.id);
      if (!row) throw new Error('Spielstand nicht gefunden.');
      return row.data;
    }
    const row = await localSaves.get(entry.id);
    if (!row) throw new Error('Spielstand nicht gefunden.');
    return row.data;
  }

  async remove(entry) {
    if (entry.source === 'server') await api.deleteSave(entry.id);
    else await localSaves.remove(entry.id);
  }

  /** Neuester automatischer Spielstand (lokal oder im Konto) für „Weiterspielen“. */
  async latestAuto() {
    const list = (await this.entries()).filter((e) => e.kind === 'auto' && e.meta);
    list.sort((a, b) => (b.meta.savedAt || 0) - (a.meta.savedAt || 0));
    return list[0] || null;
  }

  /** Automatischen Spielstand einer beendeten Runde entfernen. */
  async dropAuto(runId) {
    for (const e of await this.entries()) {
      if (e.kind === 'auto' && e.meta && e.meta.runId === runId) {
        try {
          await this.remove(e);
        } catch {
          // egal – wird beim nächsten Autosave überschrieben
        }
      }
    }
  }

  /** Lokale Stände, die als Gast (ohne Konto) gespeichert wurden. */
  async guestRows() {
    try {
      return (await localSaves.list()).filter((r) => SLOTS.some((s) => s.id === r.id) && r.meta && !r.meta.owner);
    } catch {
      return [];
    }
  }

  /** Gibt es lokale Gast-Spielstände, die ins Konto übernommen werden könnten? */
  async hasLocal() {
    return (await this.guestRows()).length > 0;
  }

  /**
   * Lokale Stände ins Konto übernehmen. Belegte Konto-Plätze werden nicht überschrieben –
   * dann landet der Stand unter „Übernommen N“. Liefert die Anzahl übernommener Stände.
   */
  async importLocal() {
    if (!this.online) return 0;
    const server = new Set((await api.listSaves()).map((r) => r.slot));
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
      const meta = { ...full.meta, importedFrom: row.id, owner: api.user.username };
      await api.putSave(target, meta, full.data);
      server.add(target);
      // lokal als übernommen markieren, damit er nicht erneut angeboten wird
      await localSaves.put(row.id, meta, full.data);
      n++;
    }
    return n;
  }
}
