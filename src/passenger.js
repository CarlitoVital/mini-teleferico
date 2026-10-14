// Fahrgäste und Routenwahl über das Seilbahnnetz.
import { CONFIG } from './config.js';

export class Passenger {
  constructor(shape, born, id) {
    this.id = id;
    this.shape = shape;
    this.born = born;
    this.transfers = 0;
  }
}

/** Binärer Min-Heap für Dijkstra. */
class MinHeap {
  constructor() {
    this.keys = [];
    this.vals = [];
  }

  get size() {
    return this.keys.length;
  }

  push(key, val) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  pop() {
    const k = this.keys;
    const v = this.vals;
    const topK = k[0];
    const topV = v[0];
    const lastK = k.pop();
    const lastV = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    this.lastKey = topK;
    return topV;
  }
}

const SLOTS = 16; // Knoten-Index = station.id * SLOTS + Linienindex

/**
 * Router: Für jede Zielform berechnet Dijkstra die Restkosten von jedem
 * Zustand (Station, Linie) bis zur nächsten Station dieser Form.
 * Fahrt = Hop-Kosten, Umstieg = Umsteigekosten. Fahrgäste entscheiden an jeder
 * Station lokal: einsteigen, sitzen bleiben oder umsteigen.
 */
export class Router {
  constructor(game) {
    this.game = game;
    this.dirty = true;
    this.dist = new Map();
    this.bestCache = new Map();
    this.lines = [];
    this.lineIdx = new Map();
    this.stationLines = [];
  }

  ensure() {
    if (this.dirty) this.rebuild();
  }

  rebuild() {
    const g = this.game;
    this.dirty = false;
    this.lines = g.lines.filter((l) => l.active && l.stations.length >= 2);
    this.lineIdx = new Map(this.lines.map((l, i) => [l, i]));
    this.stationLines = g.stations.map(() => []);
    for (const l of this.lines) for (const s of l.stations) this.stationLines[s.id].push(l);
    this.dist.clear();
    this.bestCache.clear();
    const shapes = new Set(g.stations.map((s) => s.shape));
    for (const shape of shapes) this.dist.set(shape, this.dijkstra(shape));
  }

  hopCost(a, b) {
    return CONFIG.hopCost + Math.hypot(a.x - b.x, a.y - b.y) * CONFIG.hopCostPerUnit;
  }

  transferCost(st) {
    return st.interchange ? CONFIG.transferCostInterchange : CONFIG.transferCost;
  }

  dijkstra(shape) {
    const stations = this.game.stations;
    const d = new Float64Array(stations.length * SLOTS).fill(Infinity);
    const heap = new MinHeap();
    this.lines.forEach((l, li) => {
      for (const s of l.stations) {
        if (s.shape !== shape) continue;
        const u = s.id * SLOTS + li;
        d[u] = 0;
        heap.push(0, u);
      }
    });
    while (heap.size) {
      const u = heap.pop();
      const du = heap.lastKey;
      if (du > d[u]) continue;
      const sid = Math.floor(u / SLOTS);
      const li = u % SLOTS;
      const s = stations[sid];
      const line = this.lines[li];
      const i = line.stations.indexOf(s);
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= line.stations.length) continue;
        const n = line.stations[j];
        const v = n.id * SLOTS + li;
        const nd = du + this.hopCost(s, n);
        if (nd < d[v]) {
          d[v] = nd;
          heap.push(nd, v);
        }
      }
      const tc = this.transferCost(s);
      for (const l2 of this.stationLines[sid]) {
        if (l2 === line) continue;
        const v = sid * SLOTS + this.lineIdx.get(l2);
        const nd = du + tc;
        if (nd < d[v]) {
          d[v] = nd;
          heap.push(nd, v);
        }
      }
    }
    return d;
  }

  /** Kosten, wenn man in st mit Linie `line` Richtung `next` fährt. */
  option(shape, st, line, next) {
    const li = this.lineIdx.get(line);
    if (li === undefined || !next) return Infinity;
    const d = this.dist.get(shape);
    if (!d) return Infinity;
    return this.hopCost(st, next) + d[next.id * SLOTS + li];
  }

  /** Beste Weiterfahrt ab st (optional ohne eine bestimmte Linie/Richtung). */
  bestOption(shape, st, exLine = null, exNext = null) {
    let best = Infinity;
    for (const l of this.stationLines[st.id] || []) {
      const list = l.stations;
      const i = list.indexOf(st);
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= list.length) continue;
        const n = list[j];
        if (l === exLine && n === exNext) continue;
        const o = this.option(shape, st, l, n);
        if (o < best) best = o;
      }
    }
    return best;
  }

  /** Wartender Fahrgast: steigt ein, wenn diese Gondel auf einem besten Weg fährt. */
  shouldBoard(p, st, line, next) {
    this.ensure();
    const o = this.option(p.shape, st, line, next);
    if (!Number.isFinite(o)) return false;
    const key = `${p.shape}|${st.id}`;
    let best = this.bestCache.get(key);
    if (best === undefined) {
      best = this.bestOption(p.shape, st);
      this.bestCache.set(key, best);
    }
    return o <= best + 1e-6;
  }

  /** Fahrgast in der Gondel: bleibt sitzen, wenn Umsteigen nicht günstiger ist. */
  shouldStay(p, st, line, next) {
    this.ensure();
    const o = this.option(p.shape, st, line, next);
    if (!Number.isFinite(o)) return false;
    const alt = this.bestOption(p.shape, st, line, next);
    return o <= alt + this.transferCost(st) + 1e-6;
  }

  /** Ist irgendeine Station dieser Form von st aus erreichbar? */
  reachable(shape, st) {
    this.ensure();
    return Number.isFinite(this.bestOption(shape, st));
  }
}
