// Heightmap von La Paz / El Alto, berechnet aus den Kontrolldaten in data/terrain.js.
// Das Gelände ist für alle Runden gleich und wird einmal pro Seitenaufruf erzeugt.
import {
  MAP, PLATEAU, CEJA, CEJA_WIDTH, UPLAND, RIVERS, EROSION, EAST_RIDGES, LAKES, GULLIES,
} from './data/terrain.js';
import { clamp, lerp, smoothstep, pointSegDist, segIntersect, makeRng } from './util.js';

const K = MAP.unitsPerKm;
const G = MAP.gridUnits;
export const WORLD_W = Math.round(MAP.widthKm * K);
export const WORLD_H = Math.round(MAP.heightKm * K);

/** Schluchten ab dieser Tiefe (m) brauchen beim Überqueren einen Mast. */
export const GORGE_MAST_DEPTH = 35;
/** Höhenstufen der Farbbänder und Haupt-Höhenlinien. */
export const BAND_LEVELS = [3300, 3500, 3700, 3850, 4000, 4200, 4350];
/** Höhenlinien alle 100 m (ohne Bandgrenzen) und Hilfslinien alle 50 m. */
export const MINOR_LEVELS = [];
export const AUX_LEVELS = [];
for (let h = 3100; h <= 4500; h += 50) {
  if (BAND_LEVELS.includes(h)) continue;
  (h % 100 === 0 ? MINOR_LEVELS : AUX_LEVELS).push(h);
}

// ------------------------------------------------------------------ Rauschen (fester Seed)
function hash2(ix, iy, s) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s);
  const b = hash2(ix + 1, iy, s);
  const c = hash2(ix, iy + 1, s);
  const d = hash2(ix + 1, iy + 1, s);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

/** Fraktales Rauschen, -1..1 */
function fbm(x, y, s, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (vnoise(x * f, y * f, s + i * 17) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Grat-Rauschen, 0..1 – scharfe Kämme, weiche Mulden. */
function ridged(x, y, s, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f, s + i * 31) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

// ------------------------------------------------------------------ Geometrie-Helfer
function catmullRom(points, samples) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let k = 0; k < samples; k++) {
      const t = k / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({
        x: f(p0.x, p1.x, p2.x, p3.x),
        y: f(p0.y, p1.y, p2.y, p3.y),
        // Attribute linear entlang des Original-Abschnitts
        floor: lerp(p1.floor, p2.floor, t),
        gorge: lerp(p1.gorge, p2.gorge, t),
        w: lerp(p1.w, p2.w, t),
        slope: lerp(p1.slope, p2.slope, t),
      });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Abbruchkante verfeinern: Zacken und Erosionsrinnen, die in das Plateau greifen. */
function buildCeja() {
  const base = CEJA.map(([x, y]) => ({ x: x * K, y: y * K }));
  const out = [];
  let along = 0;
  for (let i = 0; i < base.length - 1; i++) {
    const a = base[i];
    const b = base[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / 22));
    const ex = (b.y - a.y) / len; // Normale nach Osten
    const ey = -(b.x - a.x) / len;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const s = along + len * t;
      const jitter = 16 * fbm(s / 140, 0.5, 71, 3) + 7 * fbm(s / 38, 4.5, 73, 2);
      const notch = Math.pow(Math.max(0, Math.sin(s / 61 + 1.3) * Math.sin(s / 173 + 0.4)), 3) * 55;
      const off = jitter - notch;
      out.push({ x: lerp(a.x, b.x, t) + ex * off, y: lerp(a.y, b.y, t) + ey * off });
    }
    along += len;
  }
  out.push(base[base.length - 1]);
  return out;
}

function makeRiver(name, pts, opts = {}) {
  let s = 0;
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    pts[i].s = s;
  }
  return { name, main: !!opts.main, minor: !!opts.minor, pts, length: s };
}

/** Punkt und Attribute bei Bogenlänge s eines Flusses. */
function riverAt(r, s) {
  const p = r.pts;
  for (let i = 0; i < p.length - 1; i++) {
    if (s <= p[i + 1].s || i === p.length - 2) {
      const t = clamp((s - p[i].s) / Math.max(1e-9, p[i + 1].s - p[i].s), 0, 1);
      const a = p[i];
      const b = p[i + 1];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), floor: lerp(a.floor, b.floor, t),
        gorge: lerp(a.gorge, b.gorge, t), w: lerp(a.w, b.w, t), dx: (b.x - a.x) / l, dy: (b.y - a.y) / l,
      };
    }
  }
  return null;
}

// ------------------------------------------------------------------ Terrain
export class Terrain {
  constructor() {
    this.W = WORLD_W;
    this.H = WORLD_H;
    this.cell = G;
    this.nx = Math.floor(WORLD_W / G) + 1;
    this.ny = Math.floor(WORLD_H / G) + 1;
    this.ceja = buildCeja();
    // Plateau-Polygon: Ceja + Westrand
    const last = this.ceja[this.ceja.length - 1];
    const first = this.ceja[0];
    this.plateauPoly = [...this.ceja, { x: -200, y: last.y + 200 }, { x: -200, y: first.y - 200 }];
    this.upland = UPLAND.map(([x, y, h]) => ({ x: x * K, y: y * K, h }));
    this.rivers = RIVERS.map((r) => {
      const ctrl = r.pts.map(([x, y, floor, gorge, w, slope]) => ({
        x: x * K, y: y * K, floor, gorge, w: w * K, slope: slope ?? r.slope,
      }));
      return makeRiver(r.name, catmullRom(ctrl, 5), { main: !!r.main });
    });
    this.addGullies();
    this.lakes = LAKES.map(([x, y, rx, ry, name]) => ({ x: x * K, y: y * K, rx: rx * K, ry: ry * K, name }));
    this.erosion = EROSION.map(([x, y, r, amp]) => ({ x: x * K, y: y * K, r: r * K, amp }));
    this.cejaMinX = Math.min(...this.ceja.map((p) => p.x));
    this.cejaMaxX = Math.max(...this.ceja.map((p) => p.x));
    this.prepareCarve();
    this.buildGrid();
    this.contours = null; // wird beim ersten Zeichnen berechnet
  }

  /** Quebradas: Rinnen von der Ceja zum nächsten Hauptfluss und kurze Seitenrinnen entlang der Täler. */
  addGullies() {
    const rng = makeRng(20240613);
    const R = (a, b) => a + rng() * (b - a);
    const named = this.rivers.slice();
    const mains = named.filter((r) => r.main);
    const gullies = [];
    const gullyPt = (x, y, floor, gorge) => ({ x, y, floor, gorge, w: 1.5, slope: GULLIES.slope });
    // 1) Von der Ceja hinunter
    let along = R(...GULLIES.cejaSpacing) * 0.5;
    const c = this.ceja;
    let acc = 0;
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i];
      const b = c[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      while (along <= acc + len) {
        const t = (along - acc) / len;
        const ex = (b.y - a.y) / len;
        const ey = -(b.x - a.x) / len;
        const sx = lerp(a.x, b.x, t) + ex * 40;
        const sy = lerp(a.y, b.y, t) + ey * 40;
        // Mündung: nächster Punkt eines Hauptflusses
        let best = null;
        for (const r of mains) {
          for (const p of r.pts) {
            const d = Math.hypot(p.x - sx, p.y - sy);
            if (!best || d < best.d) best = { d, p };
          }
        }
        if (best && best.d < 520 && best.p.floor < GULLIES.cejaStartFloor - 60) {
          const m = best.p;
          const mx = lerp(sx, m.x, 0.5) + R(-1, 1) * best.d * 0.12;
          const my = lerp(sy, m.y, 0.5) + R(-1, 1) * best.d * 0.12;
          const g = R(...GULLIES.gorge);
          const f0 = GULLIES.cejaStartFloor + R(-30, 20);
          const pts = catmullRom(
            [gullyPt(sx, sy, f0, g * 0.6), gullyPt(mx, my, lerp(f0, m.floor, 0.62), g), gullyPt(m.x, m.y, m.floor, g)],
            4,
          );
          gullies.push(makeRiver('Quebrada', pts, { minor: true }));
        }
        along += R(...GULLIES.cejaSpacing);
      }
      acc += len;
    }
    // 2) Seitenrinnen entlang der benannten Täler
    for (const r of named) {
      if (r.length < 700) continue;
      let s = R(...GULLIES.sideSpacing);
      let side = rng() < 0.5 ? 1 : -1;
      while (s < r.length - 60) {
        const q = riverAt(r, s);
        const len = R(...GULLIES.sideLength);
        const ang = side * R(1.0, 1.9); // 57°–110° zur Fließrichtung
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const dx = q.dx * cos - q.dy * sin;
        const dy = q.dx * sin + q.dy * cos;
        const hx = q.x + dx * len;
        const hy = q.y + dy * len;
        if (this.inBounds(hx, hy, -50) && !pointInPolygon(hx, hy, this.plateauPoly)) {
          const g = R(...GULLIES.gorge) * 0.8;
          const bend = R(-0.25, 0.25) * len;
          const mx = q.x + dx * len * 0.5 - dy * bend;
          const my = q.y + dy * len * 0.5 + dx * bend;
          const pts = catmullRom(
            [gullyPt(hx, hy, q.floor + len * 0.45, g * 0.5), gullyPt(mx, my, q.floor + len * 0.2, g), gullyPt(q.x, q.y, q.floor + 2, g)],
            3,
          );
          gullies.push(makeRiver('Quebrada', pts, { minor: true }));
        }
        side = -side;
        s += R(...GULLIES.sideSpacing);
      }
    }
    this.rivers.push(...gullies);
  }

  /** Hochland östlich der Ceja (ohne Täler). */
  uplandAt(x, y) {
    let sw = 0;
    let sh = 0;
    for (const p of this.upland) {
      const d2 = ((p.x - x) ** 2 + (p.y - y) ** 2) / (K * K) + 0.09;
      const w = 1 / (d2 * Math.sqrt(d2));
      sw += w;
      sh += w * p.h;
    }
    let h = sh / sw;
    h += 30 * fbm(x / 140, y / 140, 11, 3) + 10 * fbm(x / 45, y / 45, 13, 2);
    // Zerfurchte Bergrücken im Osten (von NW nach SO gestreckt)
    const er = EAST_RIDGES;
    const m = smoothstep(er.fromX * K, er.fullX * K, x);
    if (m > 0) {
      const ang = (er.angleDeg * Math.PI) / 180;
      const lam = er.wavelengthKm * K;
      const along = (x * Math.cos(ang) + y * Math.sin(ang)) / (lam * 3.2);
      const across = (-x * Math.sin(ang) + y * Math.cos(ang)) / lam;
      h += m * er.amplitude * (ridged(across, along, 23, 3) - 0.5) * 2;
    }
    return h;
  }

  /** Tiefster Taleinschnitt an einer Stelle (Talsohle + Schlucht + Hang), höchstens `best`. */
  carveAt(x, y, best = Infinity) {
    const L = this.carveList;
    for (let k = 0; k < L.length; k++) {
      const c = L[k];
      if (c.fmin >= best) break; // nach Sohle sortiert: tiefer kann es nicht mehr werden
      // Untergrenze über die Bounding-Box: Abschnitte, die nicht tiefer schneiden können, überspringen
      const bx = c.minX > x ? c.minX - x : x > c.maxX ? x - c.maxX : 0;
      const by = c.minY > y ? c.minY - y : y > c.maxY ? y - c.maxY : 0;
      const reach = (best - c.fmin) / c.slope + c.wmax + 12;
      if (bx * bx + by * by >= reach * reach) continue;
      // Abstand Punkt–Strecke (ohne Objekt-Allokation)
      let t = ((x - c.ax) * c.dx + (y - c.ay) * c.dy) * c.inv;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = c.ax + c.dx * t - x;
      const py = c.ay + c.dy * t - y;
      const d = Math.sqrt(px * px + py * py);
      const floor = c.fa + (c.fb - c.fa) * t;
      if (floor >= best) continue;
      const dd = d - (c.wa + (c.wb - c.wa) * t);
      if (dd <= 0) {
        best = floor;
        continue;
      }
      const g = c.ga + (c.gb - c.ga) * t;
      const h = dd < 12 ? floor + (dd * g) / 12 : floor + g + (dd - 12) * (c.sa + (c.sb - c.sa) * t);
      if (h < best) best = h;
    }
    return best;
  }

  /** Abschnitte der Wasserläufe mit Bounding-Box für die schnelle Heightmap-Berechnung. */
  prepareCarve() {
    this.carveList = [];
    for (const r of this.rivers) {
      const p = r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i];
        const b = p[i + 1];
        this.carveList.push({
          ax: a.x, ay: a.y, bx: b.x, by: b.y,
          fa: a.floor, fb: b.floor, ga: a.gorge, gb: b.gorge, wa: a.w, wb: b.w,
          slope: Math.min(a.slope, b.slope), sa: a.slope, sb: b.slope,
          fmin: Math.min(a.floor, b.floor), wmax: Math.max(a.w, b.w),
          dx: b.x - a.x, dy: b.y - a.y, inv: 1 / Math.max(1e-9, (b.x - a.x) ** 2 + (b.y - a.y) ** 2),
          minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y),
          minor: r.minor,
        });
      }
    }
    // tiefe Abschnitte zuerst: senkt `best` früh und macht die Schranke wirksam
    this.carveList.sort((a, b) => a.fmin - b.fmin);
  }

  plateauAt(x, y) {
    return PLATEAU.base + PLATEAU.northRise * (1 - y / this.H) + PLATEAU.noise * fbm(x / 90, y / 90, 41, 2);
  }

  /** Abstand zur Abbruchkante; jenseits von `limit` genügt „weit weg“. */
  distToCeja(x, y, limit = Infinity) {
    if (x > this.cejaMaxX + limit || x < this.cejaMinX - limit) return Infinity;
    let best = Infinity;
    const c = this.ceja;
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i];
      const b = c[i + 1];
      if (Math.abs(a.y - y) > limit + 30 && Math.abs(b.y - y) > limit + 30 && (a.y - y) * (b.y - y) > 0) continue;
      const d = pointSegDist(x, y, a.x, a.y, b.x, b.y).d;
      if (d < best) best = d;
    }
    return best;
  }

  isPlateau(x, y) {
    if (x > this.cejaMaxX) return false;
    return pointInPolygon(x, y, this.plateauPoly);
  }

  rawHeight(x, y) {
    const hp = this.plateauAt(x, y);
    if (this.isPlateau(x, y)) return hp;
    let hv = this.carveAt(x, y, this.uplandAt(x, y));
    for (const e of this.erosion) {
      const d2 = ((x - e.x) ** 2 + (y - e.y) ** 2) / (e.r * e.r);
      if (d2 >= 1) continue;
      const m = (1 - d2) * (1 - d2);
      hv += m * e.amp * (ridged(x / 32, y / 32, 57, 2) - 0.5) * 2;
    }
    const width = CEJA_WIDTH * K * (0.75 + 0.5 * vnoise(x / 120, y / 120, 61));
    const t = smoothstep(0, width, this.distToCeja(x, y, width));
    return hv < hp ? lerp(hp, hv, t) : hv;
  }

  buildGrid() {
    const { nx, ny } = this;
    this.h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) this.h[j * nx + i] = this.rawHeight(i * G, j * G);
    }
    // Steilheit in m pro Welt-Einheit (zentrale Differenzen)
    this.slope = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const l = this.h[j * nx + Math.max(0, i - 1)];
        const r = this.h[j * nx + Math.min(nx - 1, i + 1)];
        const u = this.h[Math.max(0, j - 1) * nx + i];
        const d = this.h[Math.min(ny - 1, j + 1) * nx + i];
        const gx = (r - l) / (2 * G);
        const gy = (d - u) / (2 * G);
        this.slope[j * nx + i] = Math.hypot(gx, gy);
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of this.h) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    this.minH = lo;
    this.maxH = hi;
  }

  sample(arr, x, y) {
    const fx = clamp(x / G, 0, this.nx - 1.001);
    const fy = clamp(y / G, 0, this.ny - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const k = j * this.nx + i;
    return lerp(lerp(arr[k], arr[k + 1], tx), lerp(arr[k + this.nx], arr[k + this.nx + 1], tx), ty);
  }

  heightAt(x, y) {
    return this.sample(this.h, x, y);
  }

  slopeAt(x, y) {
    return this.sample(this.slope, x, y);
  }

  /** Größte Steilheit im Umkreis (für Bauplätze). */
  maxSlopeAround(x, y, r) {
    let m = this.slopeAt(x, y);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      m = Math.max(m, this.slopeAt(x + Math.cos(a) * r, y + Math.sin(a) * r));
    }
    return m;
  }

  inBounds(x, y, margin = 0) {
    return x >= margin && y >= margin && x <= this.W - margin && y <= this.H - margin;
  }

  inLake(x, y, pad = 0) {
    for (const l of this.lakes) {
      const dx = (x - l.x) / (l.rx + pad);
      const dy = (y - l.y) / (l.ry + pad);
      if (dx * dx + dy * dy <= 1) return true;
    }
    return false;
  }

  /** Liegt ein Wasserlauf näher als rMain (benannte Flüsse) bzw. rMinor (Quebradas)? */
  waterWithin(x, y, rMain, rMinor) {
    for (const c of this.carveList) {
      const r = c.minor ? rMinor : rMain;
      if (x < c.minX - r || x > c.maxX + r || y < c.minY - r || y > c.maxY + r) continue;
      let t = ((x - c.ax) * c.dx + (y - c.ay) * c.dy) * c.inv;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = c.ax + c.dx * t - x;
      const py = c.ay + c.dy * t - y;
      if (px * px + py * py < r * r) return true;
    }
    return false;
  }

  /**
   * Zu nah an einem Wasserlauf für eine Station mit Radius r? Benannte Flüsse brauchen je nach
   * Schluchttiefe mehr Abstand, Seitenquebradas nur wenig. Geprüft wird jeder Wasserlauf, nicht nur
   * der nächste – sonst verdeckt eine nahe Quebrada eine tiefe Schlucht dahinter.
   */
  nearWater(x, y, r) {
    for (const rv of this.rivers) {
      const p = rv.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const q = pointSegDist(x, y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
        const clear = rv.minor ? r + 4 : r + 14 + lerp(p[i].gorge, p[i + 1].gorge, q.t) * 0.15;
        if (q.d < clear) return true;
      }
    }
    return false;
  }

  /** Abstand zum nächsten Wasserlauf und dessen Schluchttiefe. */
  riverInfo(x, y) {
    let best = { d: Infinity, gorge: 0, river: null };
    for (const r of this.rivers) {
      const p = r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const q = pointSegDist(x, y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
        if (q.d < best.d) best = { d: q.d, gorge: lerp(p[i].gorge, p[i + 1].gorge, q.t), river: r };
      }
    }
    return best;
  }

  /** Querungen von Wasserläufen entlang einer Strecke: [{t, gorge, name}] (nahe Treffer zusammengefasst). */
  riverCrossings(ax, ay, bx, by) {
    const hits = [];
    for (const r of this.rivers) {
      const p = r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const t = segIntersect(ax, ay, bx, by, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
        if (t < 0) continue;
        // Schluchttiefe am Schnittpunkt
        const ix = ax + (bx - ax) * t;
        const iy = ay + (by - ay) * t;
        const q = pointSegDist(ix, iy, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
        hits.push({ t, gorge: lerp(p[i].gorge, p[i + 1].gorge, q.t), name: r.name });
      }
    }
    hits.sort((a, b) => a.t - b.t);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const merged = [];
    for (const h of hits) {
      const last = merged[merged.length - 1];
      if (last && (h.t - last.t) * len < 30) {
        if (h.gorge > last.gorge) Object.assign(last, h);
      } else merged.push({ ...h });
    }
    return merged;
  }

  // ---------------------------------------------------------------- Höhenlinien
  /** Geschlossene Höhenlinien-Ringe pro Stufe (Marching Squares, Rand mit „unendlich tief“ aufgefüllt). */
  ensureContours() {
    if (this.contours) return this.contours;
    const levels = [...new Set([...BAND_LEVELS, ...MINOR_LEVELS, ...AUX_LEVELS])].sort((a, b) => a - b);
    this.contours = new Map();
    for (const L of levels) this.contours.set(L, this.ringsFor(L));
    return this.contours;
  }

  ringsFor(L) {
    const { nx, ny, h } = this;
    const PX = nx + 2;
    const PY = ny + 2;
    const val = (pi, pj) => (pi <= 0 || pj <= 0 || pi >= PX - 1 || pj >= PY - 1 ? -1e9 : h[(pj - 1) * nx + (pi - 1)]);
    const pos = (pi) => (pi - 1) * G;
    const edgeCount = PX * PY * 2;
    const link1 = new Int32Array(edgeCount).fill(-1);
    const link2 = new Int32Array(edgeCount).fill(-1);
    const link = (a, b) => {
      if (link1[a] < 0) link1[a] = b;
      else link2[a] = b;
    };
    const seg = (a, b) => {
      link(a, b);
      link(b, a);
    };
    for (let pj = 0; pj < PY - 1; pj++) {
      for (let pi = 0; pi < PX - 1; pi++) {
        const tl = val(pi, pj) >= L;
        const tr = val(pi + 1, pj) >= L;
        const br = val(pi + 1, pj + 1) >= L;
        const bl = val(pi, pj + 1) >= L;
        const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const top = (pj * PX + pi) * 2;
        const bottom = ((pj + 1) * PX + pi) * 2;
        const left = (pj * PX + pi) * 2 + 1;
        const right = (pj * PX + pi + 1) * 2 + 1;
        switch (c) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 5: case 10: {
            const center = (val(pi, pj) + val(pi + 1, pj) + val(pi + 1, pj + 1) + val(pi, pj + 1)) / 4 >= L;
            if ((c === 5) === center) {
              seg(left, top);
              seg(bottom, right);
            } else {
              seg(top, right);
              seg(left, bottom);
            }
            break;
          }
          default:
        }
      }
    }
    // Eckpunkt einer Kante: lineare Interpolation
    const vertex = (e) => {
      const base = e >> 1;
      const pj = Math.floor(base / PX);
      const pi = base - pj * PX;
      const v0 = val(pi, pj);
      if (e & 1) {
        const v1 = val(pi, pj + 1);
        const t = clamp((L - v0) / (v1 - v0), 0, 1);
        return [pos(pi), pos(pj) + t * G];
      }
      const v1 = val(pi + 1, pj);
      const t = clamp((L - v0) / (v1 - v0), 0, 1);
      return [pos(pi) + t * G, pos(pj)];
    };
    const visited = new Uint8Array(edgeCount);
    const rings = [];
    for (let e = 0; e < edgeCount; e++) {
      if (link1[e] < 0 || visited[e]) continue;
      const pts = [];
      let prev = -1;
      let cur = e;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      while (cur >= 0 && !visited[cur]) {
        visited[cur] = 1;
        const [x, y] = vertex(cur);
        pts.push(x, y);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        const next = link1[cur] !== prev ? link1[cur] : link2[cur];
        prev = cur;
        cur = next;
      }
      if (pts.length >= 6) rings.push({ pts: new Float32Array(pts), minX, minY, maxX, maxY });
    }
    return rings;
  }
}

let shared = null;
/** Das (für alle Runden gleiche) Gelände – wird beim ersten Zugriff berechnet. */
export function getTerrain() {
  if (!shared) shared = new Terrain();
  return shared;
}
