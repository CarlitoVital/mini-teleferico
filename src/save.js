// Spielstände: kompletter Spielzustand als JSON-Objekt – versioniert, damit ältere Stände
// später migriert werden können. Gelände und Gebäude entstehen beim Laden neu aus dem Seed.
import { Game } from './game.js';
import { Station } from './station.js';
import { Line } from './line.js';
import { Gondola } from './gondola.js';
import { Passenger } from './passenger.js';
import { t } from './i18n.js';

export const SAVE_VERSION = 1;

const GONDOLA_FIELDS = [
  'id', 'state', 'dist', 'len', 'v', 'vmax', 'dir', 'dwell', 'actionTimer', 'big', 'retiring',
  'fade', 'sway', 'swayV', 'prevVx', 'x', 'y', 'snap',
];
const STATION_STATE = ['overcrowd', 'interchange', 'nextSpawn', 'bump'];

const passengerOut = (p) => ({ id: p.id, shape: p.shape, born: p.born, transfers: p.transfers });

function passengerIn(p) {
  const q = new Passenger(p.shape, p.born, p.id);
  q.transfers = p.transfers;
  return q;
}

/** Spielzustand → JSON-taugliches Objekt. camera: optionale Kamera {x, y, scale, manual}. */
export function serializeGame(game, camera = null) {
  if (game.state === 'over') throw new Error(t('err.saveOver'));
  return {
    version: SAVE_VERSION,
    seed: game.seed,
    aspect: game.aspect,
    area0: game.area0,
    startArea: { ...game.startArea },
    time: game.time,
    state: game.state,
    week: game.week,
    score: game.score,
    rewardOptions: game.rewardOptions ? [...game.rewardOptions] : null,
    res: { ...game.res },
    stats: { ...game.stats },
    nextStationIn: game.nextStationIn,
    nextLineId: game.nextLineId,
    nextGondolaId: game.nextGondolaId,
    nextPassengerId: game.nextPassengerId,
    maxStations: game.maxStations,
    maxOvercrowd: game.maxOvercrowd,
    usedNames: [...game.usedNames],
    rng: game.rng.getState(),
    stations: game.stations.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      shape: s.shape,
      name: s.name,
      elev: s.elev,
      born: s.born,
      ...Object.fromEntries(STATION_STATE.map((k) => [k, s[k]])),
      waiting: s.waiting.map(passengerOut),
    })),
    lines: game.lines.map((l) => ({
      id: l.id,
      slot: l.slot,
      state: l.state,
      created: l.created,
      stations: l.stations.map((s) => s.id),
    })),
    gondolas: game.gondolas.map((g) => ({
      ...Object.fromEntries(GONDOLA_FIELDS.map((k) => [k, g[k]])),
      line: g.line.id,
      at: g.at ? g.at.id : null,
      from: g.from ? g.from.id : null,
      to: g.to ? g.to.id : null,
      riders: g.riders.map(passengerOut),
    })),
    camera: camera ? { x: camera.x, y: camera.y, scale: camera.scale, manual: !!camera.manual } : null,
  };
}

/** Vorschau für die Spielstand-Liste. */
export function saveMeta(game, extra = {}) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    week: game.week,
    day: game.dayIndex + 1,
    score: game.score,
    area: game.startArea.name,
    seed: game.seed,
    time: Math.round(game.time),
    stations: game.stations.length,
    lines: game.lines.filter((l) => l.active).length,
    ...extra,
  };
}

/** Ältere Formate auf den aktuellen Stand bringen (Version 1 ist die erste). */
export function migrate(data) {
  if (!data || typeof data !== 'object' || !Number.isFinite(data.version)) {
    throw new Error(t('err.saveFormat'));
  }
  if (data.version > SAVE_VERSION) throw new Error(t('err.saveNewer'));
  // Künftige Migrationen: if (data.version === 1) { …; data.version = 2; }
  return data;
}

const REWARD_KINDS = ['line', 'gondola', 'masts', 'tall', 'cabin', 'interchange'];

/** JSON-Objekt → laufendes Spiel. Liefert { game, camera }. */
export function deserializeGame(raw) {
  const d = migrate(raw);
  try {
    return restoreGame(d);
  } catch (err) {
    // Unvollständige oder manipulierte Daten: verständliche Meldung statt einer Engine-Fehlermeldung
    console.warn('Spielstand beschädigt:', err);
    throw new Error(t('err.saveCorrupt'));
  }
}

function restoreGame(d) {
  if (d.rewardOptions != null && !(Array.isArray(d.rewardOptions) && d.rewardOptions.every((k) => REWARD_KINDS.includes(k)))) {
    throw new Error('rewardOptions');
  }
  const game = new Game({ seed: d.seed, aspect: d.aspect, area: d.area0, restore: true });
  Object.assign(game, {
    time: d.time,
    state: d.state === 'reward' ? 'reward' : 'playing',
    week: d.week,
    score: d.score,
    rewardOptions: d.rewardOptions ? [...d.rewardOptions] : null,
    nextStationIn: d.nextStationIn,
    nextLineId: d.nextLineId,
    nextGondolaId: d.nextGondolaId,
    nextPassengerId: d.nextPassengerId,
    maxStations: d.maxStations,
    maxOvercrowd: d.maxOvercrowd,
  });
  game.startArea = { ...d.startArea };
  game.res = { ...game.res, ...d.res };
  game.stats = { ...game.stats, ...d.stats };
  game.usedNames = new Set(d.usedNames);
  game.rng.setState(d.rng);

  game.stations = d.stations.map((s, i) => {
    if (s.id !== i) throw new Error(t('err.saveCorrupt'));
    const st = new Station({ id: s.id, x: s.x, y: s.y, shape: s.shape, name: s.name, elev: s.elev, born: s.born });
    for (const k of STATION_STATE) st[k] = s[k];
    st.waiting = s.waiting.map(passengerIn);
    return st;
  });
  const station = (id) => {
    if (id === null || id === undefined) return null;
    const st = game.stations[id];
    if (!st) throw new Error(t('err.saveCorrupt'));
    return st;
  };
  game.lines = d.lines.map((l) => {
    const line = new Line(l.id, l.slot);
    line.state = l.state;
    line.created = l.created;
    line.stations = l.stations.map(station);
    return line;
  });
  const lineById = new Map(game.lines.map((l) => [l.id, l]));
  game.gondolas = d.gondolas.map((g) => {
    const line = lineById.get(g.line);
    if (!line) throw new Error(t('err.saveCorrupt'));
    const go = Object.create(Gondola.prototype);
    for (const k of GONDOLA_FIELDS) go[k] = g[k];
    go.line = line;
    go.at = station(g.at);
    go.from = station(g.from);
    go.to = station(g.to);
    go.riders = g.riders.map(passengerIn);
    line.gondolas.push(go);
    return go;
  });
  game.router.dirty = true;
  game.networkChanged();
  // Mastbedarf wird beim Laden neu berechnet. Hat sich eine Regel geändert, darf der Vorrat
  // dadurch nicht ins Minus rutschen (sonst ließe sich nichts mehr bauen)
  game.res.masts = Math.max(game.res.masts, game.mastsUsed);
  game.res.tallMasts = Math.max(game.res.tallMasts, game.tallMastsUsed);
  return { game, camera: d.camera || null };
}
