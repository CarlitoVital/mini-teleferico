// Spielzustand und Regeln – ohne DOM, daher auch headless (Node) lauffähig.
import { CONFIG, COMMON_SHAPES, RARE_SHAPES, DAY_NAMES, DAY_NAMES_LONG, LINE_COLORS } from './config.js';
import { makeRng, clamp, pick, pickWeighted, shuffle } from './util.js';
import { CityMap, BANDS } from './map.js';
import { Station, STATION_NAMES } from './station.js';
import { Line, pairKey } from './line.js';
import { Gondola } from './gondola.js';
import { Passenger, Router } from './passenger.js';

/** 0 = Tag, 1 = tiefe Nacht. */
export function nightness(h) {
  if (h < 5) return 1;
  if (h < 7) return 1 - (h - 5) / 2;
  if (h < 18.5) return 0;
  if (h < 20.5) return (h - 18.5) / 2;
  return 1;
}

/** Fahrgastaufkommen über den Tag: Stoßzeiten morgens und abends, ruhige Nacht. */
export function rushFactor(h) {
  const g = (c, s) => Math.exp(-(((h - c) / s) ** 2));
  return 0.75 + 0.85 * g(7.75, 1.3) + 0.8 * g(18, 1.5) - 0.35 * nightness(h);
}

const RARE = new Set(RARE_SHAPES);

export const REWARDS = {
  line: { title: 'Neue Linie', text: 'Eine weitere Seilbahnlinie zum Bauen.' },
  gondola: { title: 'Gondel', text: 'Eine zusätzliche Gondel für eine beliebige Linie.' },
  masts: { title: '2 Masten', text: 'Für lange Spannweiten und Schluchtquerungen.' },
  cabin: { title: 'Große Kabine', text: `Eine Gondel fasst ${CONFIG.bigCabinCapacity} statt ${CONFIG.gondolaCapacity} Fahrgäste.` },
  interchange: {
    title: 'Umsteigestation',
    text: `Station fasst ${CONFIG.interchangeCapacity} Fahrgäste, Umsteigen geht doppelt so schnell.`,
  },
};

export class Game {
  constructor({ width, height, seed = 1, demo = false }) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.map = new CityMap(width, height, this.rng);
    this.demo = demo;
    this.time = 0;
    this.state = 'playing'; // 'playing' | 'reward' | 'over'
    this.stations = [];
    this.lines = [];
    this.gondolas = [];
    this.score = 0;
    this.res = { ...CONFIG.start };
    this.router = new Router(this);
    this.offsets = new Map();
    this.week = 1;
    this.nextStationIn = CONFIG.firstStationDelay;
    this.usedNames = new Set();
    this.effects = [];
    this.handlers = new Map();
    this.overStation = null;
    this.nextLineId = 1;
    this.rewardOptions = null;
    this.maxOvercrowd = 0;
    this.stats = { delivered: 0, transfers: 0, spawned: 0, linesBuilt: 0, maxWaiting: 0 };
    this.maxStations = clamp(Math.round((width * height) / 36000), 20, 40);
    this.spawnInitialStations();
  }

  // ------------------------------------------------------------ Ereignisse
  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, []);
    this.handlers.get(evt).push(fn);
  }

  emit(evt, data) {
    const list = this.handlers.get(evt);
    if (list) for (const fn of list) fn(data);
  }

  // ------------------------------------------------------------ Zeit
  get totalHours() {
    return CONFIG.startHour + (this.time / CONFIG.dayLength) * 24;
  }

  get hour() {
    return this.totalHours % 24;
  }

  get dayIndex() {
    return Math.floor(this.totalHours / 24);
  }

  get dayName() {
    return DAY_NAMES[this.dayIndex % 7];
  }

  get weeksElapsed() {
    return this.time / (CONFIG.dayLength * 7);
  }

  clockText() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${this.dayName} ${String(h).padStart(2, '0')}:${String(m - (m % 10)).padStart(2, '0')}`;
  }

  /** Aktuell bebauter Stadtbereich (wächst mit der Zeit). */
  region() {
    const f = clamp(
      CONFIG.regionStart + (1 - CONFIG.regionStart) * (this.weeksElapsed / CONFIG.regionFullWeeks),
      CONFIG.regionStart,
      1,
    );
    return this.regionRect(f);
  }

  /** Kamerabereich: wie region(), aber in kleinen Stufen (ruhige Kamera, Hintergrund-Cache). */
  viewRegion() {
    const f = Math.min(1, Math.ceil(this.region().f / 0.025 - 1e-9) * 0.025);
    return this.regionRect(f);
  }

  regionRect(f) {
    const { W, H } = this.map;
    return { x: W * (1 - f) * 0.5, y: H * (1 - f) * 0.5, w: W * f, h: H * f, f };
  }

  // ------------------------------------------------------------ Spawning
  bandWeights() {
    // Anfangs wächst das Zentrum, später vor allem El Alto und die Zona Sur.
    const w = this.weeksElapsed;
    return [0.55 + 0.35 * w, 0.8, Math.max(0.5, 1.2 - 0.12 * w), 0.55 + 0.32 * w];
  }

  stationInterval() {
    return Math.max(CONFIG.stationMinInterval, CONFIG.stationBaseInterval - CONFIG.stationRamp * this.weeksElapsed);
  }

  passengerInterval() {
    return Math.max(
      CONFIG.passengerMinInterval,
      CONFIG.passengerBaseInterval - CONFIG.passengerRamp * this.weeksElapsed,
    );
  }

  spawnInitialStations() {
    const shapes = shuffle(this.rng, COMMON_SHAPES);
    for (const shape of shapes) {
      let spot = this.map.findSpot(this.rng, this.stations, [], this.regionRect(0.36), [0.7, 1, 1.1, 0.8], {
        minDist: 115,
        maxNear: 240,
      });
      if (!spot) spot = this.map.findSpot(this.rng, this.stations, [], this.regionRect(0.6), [1, 1, 1, 1]);
      if (!spot) {
        const r = this.regionRect(0.4);
        spot = { x: r.x + r.w * (0.2 + 0.3 * this.stations.length), y: r.y + r.h * 0.4 };
      }
      this.addStation(spot, shape);
    }
  }

  spawnStation() {
    const segs = this.activeSegments();
    const spot = this.map.findSpot(this.rng, this.stations, segs, this.region(), this.bandWeights());
    if (!spot) return null;
    const shape = this.pickNewShape();
    const st = this.addStation(spot, shape);
    if (RARE.has(shape)) this.emit('rare', st);
    return st;
  }

  addStation(spot, shape) {
    const band = this.map.bandAt(spot.x, spot.y);
    const elev = BANDS[band].elev + Math.round((this.rng() - 0.5) * 8) * 10;
    const st = new Station({
      id: this.stations.length,
      x: spot.x,
      y: spot.y,
      shape,
      band,
      elev,
      name: this.pickName(band),
      born: this.time,
    });
    st.nextSpawn = this.passengerInterval() * (0.5 + this.rng() * 0.8);
    this.stations.push(st);
    this.router.dirty = true;
    this.effects.push({ kind: 'ring', x: st.x, y: st.y, t0: this.time, dur: 1.6 });
    this.emit('station', st);
    return st;
  }

  pickName(band) {
    const free = STATION_NAMES[band].filter((n) => !this.usedNames.has(n));
    const all = STATION_NAMES.flat().filter((n) => !this.usedNames.has(n));
    const name = free.length ? pick(this.rng, free) : all.length ? pick(this.rng, all) : `Estación ${this.stations.length + 1}`;
    this.usedNames.add(name);
    return name;
  }

  shapeCounts() {
    const c = {};
    for (const s of this.stations) c[s.shape] = (c[s.shape] || 0) + 1;
    return c;
  }

  pickNewShape() {
    const counts = this.shapeCounts();
    if (this.stations.length >= CONFIG.rareFromStations && this.rng() < CONFIG.rareShapeChance) {
      const rare = RARE_SHAPES.filter((s) => (counts[s] || 0) < (s === 'diamond' ? 2 : 1));
      if (rare.length) return pick(this.rng, rare);
    }
    const base = { circle: 0.5, triangle: 0.3, square: 0.2 };
    const n = this.stations.length + 1;
    // Ausgleich, falls eine Grundform deutlich unterrepräsentiert ist
    const weights = COMMON_SHAPES.map((s) => base[s] * (1 + Math.max(0, base[s] * n - (counts[s] || 0))));
    return pickWeighted(this.rng, COMMON_SHAPES, weights);
  }

  pickTargetShape(exclude) {
    const counts = this.shapeCounts();
    const shapes = Object.keys(counts).filter((s) => s !== exclude);
    if (!shapes.length) return null;
    return pickWeighted(
      this.rng,
      shapes,
      shapes.map((s) => (RARE.has(s) ? 0.55 : 1)),
    );
  }

  spawnPassenger(st) {
    const shape = this.pickTargetShape(st.shape);
    if (!shape) return;
    if (this.demo && st.waiting.length >= st.capacity) return;
    st.waiting.push(new Passenger(shape, this.time));
    this.stats.spawned++;
  }

  // ------------------------------------------------------------ Hauptschleife
  update(dt) {
    if (this.state !== 'playing') return;
    this.time += dt;

    if (!this.demo) {
      const w = Math.floor(this.dayIndex / 7) + 1;
      if (w > this.week) {
        this.week = w;
        this.startWeek();
        return;
      }
    }

    this.nextStationIn -= dt;
    if (this.nextStationIn <= 0) {
      this.nextStationIn = this.stationInterval() * (0.75 + this.rng() * 0.5);
      if (this.stations.length < this.maxStations) this.spawnStation();
    }

    const rush = rushFactor(this.hour);
    const interval = this.passengerInterval();
    for (const st of this.stations) {
      if (this.time - st.born < 1.5) continue;
      st.nextSpawn -= dt * rush;
      if (st.nextSpawn <= 0) {
        st.nextSpawn += interval * (0.55 + this.rng() * 0.9);
        this.spawnPassenger(st);
      }
    }

    for (const g of this.gondolas.slice()) g.update(dt, this);

    let maxOver = 0;
    for (const st of this.stations) {
      const n = st.waiting.length;
      if (n > this.stats.maxWaiting) this.stats.maxWaiting = n;
      if (n > st.capacity) {
        const before = st.overcrowd;
        st.overcrowd = Math.min(1, st.overcrowd + dt / CONFIG.overcrowdTime);
        if (before === 0) this.emit('warn', st);
        if (before < 0.66 && st.overcrowd >= 0.66) this.emit('danger', st);
      } else if (st.overcrowd > 0) {
        st.overcrowd = Math.max(0, st.overcrowd - dt / CONFIG.overcrowdRecover);
      }
      if (this.demo) st.overcrowd = Math.min(st.overcrowd, 0.5);
      if (st.overcrowd > maxOver) maxOver = st.overcrowd;
      if (st.overcrowd >= 1) {
        this.gameOver(st);
        return;
      }
    }
    this.maxOvercrowd = maxOver;

    for (const l of this.lines.slice()) if (!l.active && !l.gondolas.length) this.removeLine(l);
    if (this.effects.length) this.effects = this.effects.filter((e) => this.time - e.t0 < e.dur);
  }

  gameOver(st) {
    this.state = 'over';
    this.overStation = st;
    this.emit('gameover', this.summary());
  }

  summary() {
    const active = this.lines.filter((l) => l.active);
    return {
      score: this.score,
      week: this.week,
      day: this.dayIndex + 1,
      dayName: this.dayName,
      dayLong: DAY_NAMES_LONG[this.dayIndex % 7],
      time: this.time,
      stations: this.stations.length,
      lines: active.length,
      gondolas: this.gondolas.length,
      transfers: this.stats.transfers,
      masts: this.mastsUsed,
      longest: active.reduce((m, l) => Math.max(m, l.stations.length), 0),
      station: this.overStation ? this.overStation.name : null,
    };
  }

  // ------------------------------------------------------------ Wochen-Belohnungen
  startWeek() {
    this.res.gondolas += 1; // jede Woche eine neue Gondel
    const pool = ['gondola', 'masts', 'cabin', 'interchange'];
    if (this.res.lines < CONFIG.maxLines) pool.push('line', 'line');
    const opts = [];
    while (opts.length < 2) {
      const k = pick(this.rng, pool);
      if (!opts.includes(k)) opts.push(k);
    }
    this.rewardOptions = opts;
    this.state = 'reward';
    this.emit('week', { week: this.week, options: opts });
  }

  chooseReward(kind) {
    if (this.state !== 'reward') return;
    if (kind === 'line') this.res.lines = Math.min(CONFIG.maxLines, this.res.lines + 1);
    else if (kind === 'gondola') this.res.gondolas += 1;
    else if (kind === 'masts') this.res.masts += 2;
    else if (kind === 'cabin') this.res.cabins += 1;
    else if (kind === 'interchange') this.res.interchanges += 1;
    this.rewardOptions = null;
    this.state = 'playing';
    this.emit('resources');
  }

  /** Farbe, die eine neue Linie bekäme (für die Belohnungskarte). */
  nextLineColor() {
    return LINE_COLORS[Math.min(this.res.lines, CONFIG.maxLines - 1)];
  }

  // ------------------------------------------------------------ Ressourcen
  freeSlots() {
    const used = new Set(this.lines.map((l) => l.slot));
    const out = [];
    for (let i = 0; i < this.res.lines; i++) if (!used.has(i)) out.push(i);
    return out;
  }

  get gondolasFree() {
    return this.res.gondolas - this.gondolas.length;
  }

  get mastsUsed() {
    let n = 0;
    for (const l of this.lines) if (l.active) n += l.mastCount;
    return n;
  }

  get mastsFree() {
    return this.res.masts - this.mastsUsed;
  }

  get cabinsFree() {
    let used = 0;
    for (const g of this.gondolas) if (g.big) used++;
    return this.res.cabins - used;
  }

  get interchangesFree() {
    let used = 0;
    for (const s of this.stations) if (s.interchange) used++;
    return this.res.interchanges - used;
  }

  // ------------------------------------------------------------ Netz
  activeSegments() {
    const out = [];
    for (const l of this.lines) {
      if (!l.active) continue;
      for (let i = 0; i < l.stations.length - 1; i++) {
        const a = l.stations[i];
        const b = l.stations[i + 1];
        out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    }
    return out;
  }

  segOffset(line, a, b) {
    return this.offsets.get(`${line.id}|${pairKey(a, b)}`) || 0;
  }

  mastsFor(list) {
    let n = 0;
    for (let i = 0; i < list.length - 1; i++) n += this.map.mastPlan(list[i], list[i + 1]).count;
    return n;
  }

  /** Prüft eine Stationsfolge (für neue oder geänderte Linie) auf Gültigkeit. */
  validate(list, line = null) {
    if (new Set(list).size !== list.length) return { ok: false, reason: 'dup' };
    const masts = this.mastsFor(list);
    const free = this.mastsFree + (line && line.active ? line.mastCount : 0);
    if (masts > free) return { ok: false, reason: 'masts', masts, free };
    return { ok: true, masts, free };
  }

  networkChanged() {
    for (const l of this.lines) {
      l.segPlans = [];
      if (!l.active) continue;
      for (let i = 0; i < l.stations.length - 1; i++) l.segPlans.push(this.map.mastPlan(l.stations[i], l.stations[i + 1]));
    }
    // Parallele Linien auf derselben Strecke nebeneinander legen
    this.offsets.clear();
    const groups = new Map();
    for (const l of this.lines) {
      if (!l.active) continue;
      for (let i = 0; i < l.stations.length - 1; i++) {
        const k = pairKey(l.stations[i], l.stations[i + 1]);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(l);
      }
    }
    for (const [k, ls] of groups) {
      ls.sort((a, b) => a.slot - b.slot);
      ls.forEach((l, i) => this.offsets.set(`${l.id}|${k}`, (i - (ls.length - 1) / 2) * CONFIG.lineSpacing));
    }
    this.router.dirty = true;
    this.emit('network');
  }

  createLine(slot, list) {
    if (list.length < 2 || !this.freeSlots().includes(slot)) return null;
    if (!this.validate(list).ok) return null;
    const line = new Line(this.nextLineId++, slot);
    line.stations = list.slice();
    line.created = this.time;
    this.lines.push(line);
    this.stats.linesBuilt++;
    this.networkChanged();
    if (this.gondolasFree > 0) this.addGondola(line, list[0]);
    this.emit('line', line);
    return line;
  }

  /** Setzt die Stationsfolge einer Linie (verlängern, kürzen, umleiten). */
  setLineStations(line, list) {
    if (!line.active) return false;
    if (list.length < 2) {
      this.closeLine(line);
      return true;
    }
    if (!this.validate(list, line).ok) return false;
    line.stations = list.slice();
    this.networkChanged();
    this.emit('lineChanged', line);
    return true;
  }

  closeLine(line) {
    if (!line.active) return;
    line.state = 'closing';
    for (const g of line.gondolas) g.retiring = true;
    this.networkChanged();
    if (!line.gondolas.length) this.removeLine(line);
    this.emit('lineClosed', line);
  }

  removeLine(line) {
    const i = this.lines.indexOf(line);
    if (i >= 0) this.lines.splice(i, 1);
    this.emit('network');
  }

  nearestOnLine(line, p) {
    let best = line.stations[0];
    let bd = Infinity;
    for (const s of line.stations) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  addGondola(line, near, opts = {}) {
    if (this.gondolasFree <= 0 || !line.active || line.stations.length < 2) return null;
    const st = near ? this.nearestOnLine(line, near) : line.stations[0];
    const g = new Gondola(line, st);
    if (opts.big && this.cabinsFree > 0) g.big = true;
    this.gondolas.push(g);
    line.gondolas.push(g);
    this.emit('gondola', g);
    return g;
  }

  /** Spieler nimmt eine Gondel vom Netz: Fahrgäste steigen an der nächsten Station aus. */
  liftGondola(g) {
    const st = g.at || (g.dist < g.len / 2 ? g.from : g.to);
    for (const p of g.riders) {
      if (p.shape === st.shape) this.deliver(p, st, g);
      else this.transfer(p, st, g);
    }
    g.riders = [];
    this.removeGondolaNow(g);
  }

  removeGondolaNow(g) {
    let i = this.gondolas.indexOf(g);
    if (i >= 0) this.gondolas.splice(i, 1);
    const line = g.line;
    i = line.gondolas.indexOf(g);
    if (i >= 0) line.gondolas.splice(i, 1);
    if (!line.active && !line.gondolas.length) this.removeLine(line);
    this.emit('resources');
  }

  applyCabin(g) {
    if (!g || g.big || this.cabinsFree <= 0) return false;
    g.big = true;
    this.emit('resources');
    return true;
  }

  applyInterchange(st) {
    if (!st || st.interchange || this.interchangesFree <= 0) return false;
    st.interchange = true;
    this.router.dirty = true;
    this.effects.push({ kind: 'ring', x: st.x, y: st.y, t0: this.time, dur: 1.2 });
    this.emit('resources');
    return true;
  }

  altitudeFactor(a, b) {
    const k = clamp((b.elev - a.elev) / CONFIG.elevRef, -1, 1);
    return k > 0 ? 1 - CONFIG.uphillSlow * k : 1 - CONFIG.downhillFast * k;
  }

  // ------------------------------------------------------------ Fahrgast-Ereignisse
  deliver(p, st, g) {
    this.score++;
    this.stats.delivered++;
    st.bump = this.time;
    this.emit('deliver', { station: st, line: g.line });
  }

  transfer(p, st) {
    p.transfers++;
    this.stats.transfers++;
    st.waiting.push(p);
  }

  boarded(p, st, g) {
    this.emit('board', { station: st, line: g.line });
  }

  arrived(g, st) {
    st.bump = Math.max(st.bump, this.time - 0.2);
  }

  /** Alle Fahrgäste im Spiel (für Tests und Statistik). */
  countPassengers() {
    let waiting = 0;
    let riding = 0;
    for (const s of this.stations) waiting += s.waiting.length;
    for (const g of this.gondolas) riding += g.riders.length;
    return { waiting, riding };
  }
}

