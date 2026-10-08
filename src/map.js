// Karte von La Paz / El Alto: Gelände, Bauplätze, Mastbedarf, Ortsnamen und Darstellung.
import { CONFIG } from './config.js';
import { PLACES, URBAN, EDGE_LABELS, MAP } from './data/terrain.js';
import { getTerrain, BAND_LEVELS, MINOR_LEVELS, AUX_LEVELS, GORGE_MAST_DEPTH } from './terrain.js';
import { clamp, lerp } from './util.js';
import { Buildings } from './buildings.js';

const K = MAP.unitsPerKm;
const FONT = '"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** Farben der Höhenstufen (von tief nach hoch), passend zu BAND_LEVELS. */
export const BAND_COLORS = ['#D9E6D2', '#E3EBD6', '#EEEEDB', '#F4EDDA', '#F2E5CF', '#ECDFC8', '#E5DACA', '#DED6CE'];
const CONTOUR = 'rgba(122,100,70,';

/** Höhe des Seils über der Station bzw. über einer Stütze (m). */
const STATION_TOWER = 18;
const MAST_HEIGHT = 30;
const CLEARANCE = 12;
/** Höhenunterschied, ab dem eine Kante als „sehr steil“ gilt (m auf 240 m Strecke). */
const STEEP_DROP = 70;

export class CityMap {
  /**
   * @param {object} opts
   * @param {number} opts.seed – Seed der Gebäudeschicht (null = ohne Gebäude)
   */
  constructor({ seed = null } = {}) {
    this.terrain = getTerrain();
    this.W = this.terrain.W;
    this.H = this.terrain.H;
    this.planCache = new Map();
    this.places = PLACES.map((p) => ({ ...p, x: p.x * K, y: p.y * K }));
    this.stationPlaces = this.places.filter((p) => p.label !== 1);
    this.urban = URBAN.map(([x, y, rx, ry, d, style]) => ({ x: x * K, y: y * K, rx: rx * K, ry: ry * K, d, style }));
    this.buildings = seed === null ? null : new Buildings(this, seed);
  }

  heightAt(x, y) {
    return this.terrain.heightAt(x, y);
  }

  isPlateau(x, y) {
    return this.terrain.isPlateau(x, y);
  }

  /** Siedlungsdichte 0..1 (für Bauplatzwahl und Gebäude). */
  urbanAt(x, y) {
    let best = 0;
    for (const u of this.urban) {
      const dx = (x - u.x) / u.rx;
      const dy = (y - u.y) / u.ry;
      const r2 = dx * dx + dy * dy;
      if (r2 >= 1) continue;
      const v = u.d * (1 - r2) ** 0.6;
      if (v > best) best = v;
    }
    return best;
  }

  /** Grobe Zone für das Stadtwachstum. */
  zoneAt(x, y) {
    if (this.isPlateau(x, y)) return 'alto';
    if (y > 9.8 * K && x > 12.8 * K) return 'sur';
    if (y > 12.4 * K && x < 11.5 * K) return 'achocalla';
    if (x > 19 * K) return 'este';
    return 'centro';
  }

  /** Darf hier eine Station stehen? Liefert {ok, reason}. */
  buildable(x, y) {
    const T = this.terrain;
    const r = CONFIG.stationRadius;
    if (!T.inBounds(x, y, 40)) return { ok: false, reason: 'rand' };
    if (T.maxSlopeAround(x, y, r + 4) > CONFIG.maxBuildSlope) return { ok: false, reason: 'steil' };
    if (T.inLake(x, y, r + 10)) return { ok: false, reason: 'see' };
    const ri = T.riverInfo(x, y);
    const clear = ri.river && !ri.river.minor ? r + 14 + ri.gorge * 0.15 : r + 4;
    if (ri.d < clear) return { ok: false, reason: 'fluss' };
    if (this.buildings && this.buildings.blockedNear(x, y, r + 12)) return { ok: false, reason: 'gebäude' };
    return { ok: true };
  }

  /**
   * Sucht einen Bauplatz für eine neue Station im Bereich `region`.
   * weightFn(zone) steuert, wo die Stadt bevorzugt wächst.
   */
  findSpot(rng, stations, segments, region, weightFn, opts = {}) {
    const minDist = opts.minDist ?? CONFIG.stationMinDist;
    const maxNear = opts.maxNear ?? 280;
    const tries = opts.tries ?? 160;
    const margin = Math.min(50, region.w * 0.06);
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < tries; i++) {
      const x = region.x + margin + rng() * (region.w - 2 * margin);
      const y = region.y + margin + rng() * (region.h - 2 * margin);
      if (opts.circle) {
        const c = opts.circle;
        if (Math.hypot(x - c.x, y - c.y) > c.r) continue;
      }
      let dmin = Infinity;
      for (const s of stations) dmin = Math.min(dmin, Math.hypot(s.x - x, s.y - y));
      if (dmin < minDist) continue;
      let blocked = false;
      for (const sg of segments) {
        const dx = sg.bx - sg.ax;
        const dy = sg.by - sg.ay;
        const l2 = dx * dx + dy * dy || 1;
        const t = clamp(((x - sg.ax) * dx + (y - sg.ay) * dy) / l2, 0, 1);
        if (Math.hypot(sg.ax + dx * t - x, sg.ay + dy * t - y) < CONFIG.stationRadius + 16) {
          blocked = true;
          break;
        }
      }
      if (blocked || !this.buildable(x, y).ok) continue;
      let score = weightFn(this.zoneAt(x, y)) * (0.12 + this.urbanAt(x, y)) * (0.35 + rng());
      if (stations.length && dmin > maxNear) score *= 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  /** Stationsname nach Lage: nächster freier Ort, sonst Ort mit Zusatz. */
  nameFor(x, y, used) {
    const byDist = this.stationPlaces
      .map((p) => ({ p, d: Math.hypot(p.x - x, p.y - y) }))
      .sort((a, b) => a.d - b.d);
    for (const { p, d } of byDist) {
      if (d > 2.4 * K) break;
      if (!used.has(p.name)) return p.name;
    }
    const near = byDist[0].p.name;
    for (const suffix of ['Alto', 'Bajo', 'Norte', 'Sur', 'II', 'III']) {
      const n = `${near} ${suffix}`;
      if (!used.has(n)) return n;
    }
    let i = 2;
    while (used.has(`Estación ${i}`)) i++;
    return `Estación ${i}`;
  }

  // ---------------------------------------------------------------- Mastbedarf
  /**
   * Prüft eine Seilstrecke a→b und plant ihre Stützen.
   * Rückgabe: { count, ts, kinds, tall, tallTs, blocked, reason, length }
   * – count: normale Masten (Spannweite, Schluchten, steile Kanten, Bodenfreiheit)
   * – tall: hohe Masten zum Überspannen einzelner blockierender Gebäude
   * – blocked: Strecke nicht baubar (reason erklärt warum)
   */
  mastPlan(a, b) {
    const cacheable = a.id !== undefined && b.id !== undefined;
    if (!cacheable) return this.computeMastPlan(a, b);
    const swap = b.id < a.id;
    const lo = swap ? b : a;
    const hi = swap ? a : b;
    const key = `${lo.id}-${hi.id}`;
    let plan = this.planCache.get(key);
    if (!plan) {
      plan = this.computeMastPlan(lo, hi);
      this.planCache.set(key, plan);
    }
    if (!swap) return plan;
    return { ...plan, ts: plan.ts.map((t) => 1 - t).reverse(), kinds: plan.kinds.slice().reverse(), tallTs: plan.tallTs.map((t) => 1 - t) };
  }

  computeMastPlan(a, b) {
    const T = this.terrain;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.ceil(len / 8));
    const prof = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) prof[i] = T.heightAt(lerp(a.x, b.x, i / n), lerp(a.y, b.y, i / n));
    const at = (t) => prof[Math.round(clamp(t, 0, 1) * n)];
    const supports = [];

    // 1) Tiefe Schluchten
    for (const c of T.riverCrossings(a.x, a.y, b.x, b.y)) {
      if (c.gorge >= GORGE_MAST_DEPTH) supports.push({ t: c.t, kind: 'schlucht' });
    }
    // 2) Sehr steile Kanten (z. B. die Ceja)
    const win = Math.max(1, Math.round(24 / (len / n)));
    let inEdge = false;
    for (let i = 0; i + win <= n; i++) {
      const steep = Math.abs(prof[i + win] - prof[i]) > STEEP_DROP;
      if (steep && !inEdge) supports.push({ t: (i + win / 2) / n, kind: 'kante' });
      inEdge = steep;
    }
    supports.sort((p, q) => p.t - q.t);
    // 3) Bodenfreiheit: das Seil darf das Gelände nicht berühren
    const top = (s) => (s.t <= 0 ? prof[0] + STATION_TOWER : s.t >= 1 ? prof[n] + STATION_TOWER : at(s.t) + MAST_HEIGHT);
    const clearSpan = (p, q, depth) => {
      if (depth > 6) return;
      const i0 = Math.round(p.t * n);
      const i1 = Math.round(q.t * n);
      const h0 = top(p);
      const h1 = top(q);
      let worst = 0;
      let wi = -1;
      for (let i = i0 + 1; i < i1; i++) {
        const cable = lerp(h0, h1, (i - i0) / (i1 - i0));
        const over = prof[i] + CLEARANCE - cable;
        if (over > worst) {
          worst = over;
          wi = i;
        }
      }
      if (wi < 0) return;
      const s = { t: wi / n, kind: 'gelände' };
      supports.push(s);
      clearSpan(p, s, depth + 1);
      clearSpan(s, q, depth + 1);
    };
    const chain = [{ t: 0 }, ...supports.slice(), { t: 1 }];
    for (let i = 0; i < chain.length - 1; i++) clearSpan(chain[i], chain[i + 1], 0);
    supports.sort((p, q) => p.t - q.t);
    // nahe Stützen zusammenfassen
    const merged = [];
    for (const s of supports) {
      if (s.t * len < 30 || (1 - s.t) * len < 30) continue;
      const last = merged[merged.length - 1];
      if (last && (s.t - last.t) * len < 45) continue;
      merged.push(s);
    }
    // 4) Maximale Spannweite
    const final = [];
    let prev = 0;
    for (const s of [...merged, { t: 1, end: true }]) {
      const span = (s.t - prev) * len;
      const extra = Math.max(0, Math.ceil(span / CONFIG.maxSpan) - 1);
      for (let k = 1; k <= extra; k++) final.push({ t: prev + ((s.t - prev) * k) / (extra + 1), kind: 'spannweite' });
      if (!s.end) final.push(s);
      prev = s.t;
    }
    const plan = {
      count: final.length,
      ts: final.map((s) => s.t),
      kinds: final.map((s) => s.kind),
      tall: 0,
      tallTs: [],
      blocked: false,
      reason: null,
      length: len,
    };
    if (this.buildings) this.buildings.applyToPlan(plan, a, b);
    return plan;
  }

  // ---------------------------------------------------------------- Zeichnen
  /**
   * Zeichnet den Kartenhintergrund im Welt-Koordinatensystem (Transformation ist gesetzt).
   * view: sichtbares Rechteck {x0,y0,x1,y1}, scale: Pixel pro Welt-Einheit.
   */
  drawBackground(ctx, view, scale, opts = {}) {
    this.drawStatic(ctx, view, scale);
    if (opts.labels !== false) this.drawLabels(ctx, view, scale, opts.labelAlpha ?? 1);
  }

  /** Unveränderliche Kartenschicht (für Kacheln): Bänder, Höhenlinien, Kante, Wasser, Gebäude. */
  drawStatic(ctx, view, scale) {
    const px = 1 / scale;
    const T = this.terrain;
    const contours = T.ensureContours();
    const vis = (r) => r.maxX >= view.x0 && r.minX <= view.x1 && r.maxY >= view.y0 && r.minY <= view.y1;
    const trace = (rings) => {
      ctx.beginPath();
      for (const r of rings) {
        if (!vis(r)) continue;
        const p = r.pts;
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.closePath();
      }
    };
    // Außerhalb der Karte
    ctx.fillStyle = '#EAE5DC';
    ctx.fillRect(view.x0 - 10, view.y0 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
    ctx.fillStyle = BAND_COLORS[0];
    ctx.fillRect(0, 0, this.W, this.H);
    // Farbbänder: jede Stufe deckt alles darüber ab
    BAND_LEVELS.forEach((L, i) => {
      trace(contours.get(L));
      ctx.fillStyle = BAND_COLORS[i + 1];
      ctx.fill('evenodd');
    });
    // Höhenlinien: Hilfslinien (50 m) nur beim Hineinzoomen
    ctx.lineJoin = 'round';
    if (scale > 0.7) {
      ctx.lineWidth = 0.7 * px;
      ctx.strokeStyle = `${CONTOUR}${Math.min(0.1, (scale - 0.7) * 0.25).toFixed(3)})`;
      for (const L of AUX_LEVELS) {
        trace(contours.get(L));
        ctx.stroke();
      }
    }
    ctx.lineWidth = 0.8 * px;
    ctx.strokeStyle = `${CONTOUR}0.17)`;
    for (const L of MINOR_LEVELS) {
      trace(contours.get(L));
      ctx.stroke();
    }
    ctx.lineWidth = 1.15 * px;
    ctx.strokeStyle = `${CONTOUR}0.3)`;
    for (const L of BAND_LEVELS) {
      trace(contours.get(L));
      ctx.stroke();
    }
    this.drawCeja(ctx, view, px);
    this.drawWater(ctx, view, px, scale);
    if (this.buildings) this.buildings.draw(ctx, view, scale);
    // Kartenrand
    ctx.strokeStyle = 'rgba(90,80,65,0.25)';
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(0, 0, this.W, this.H);
  }

  /** Böschungsschraffur der Abbruchkante (Striche zeigen hangabwärts). */
  drawCeja(ctx, view, px) {
    const c = this.terrain.ceja;
    const step = Math.max(7, 5 * px);
    ctx.strokeStyle = 'rgba(150,125,95,0.55)';
    ctx.lineWidth = 1.1 * px;
    ctx.beginPath();
    let carry = 0;
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i];
      const b = c[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (Math.max(a.x, b.x) < view.x0 - 30 || Math.min(a.x, b.x) > view.x1 + 30) {
        carry = 0;
        continue;
      }
      if (Math.max(a.y, b.y) < view.y0 - 30 || Math.min(a.y, b.y) > view.y1 + 30) {
        carry = 0;
        continue;
      }
      const ex = (b.y - a.y) / len;
      const ey = -(b.x - a.x) / len;
      for (let d = carry; d < len; d += step) {
        const x = a.x + ((b.x - a.x) * d) / len;
        const y = a.y + ((b.y - a.y) * d) / len;
        const l = (Math.floor((d + i * 13) / step) % 2 ? 9 : 14) * Math.max(1, px * 0.6);
        ctx.moveTo(x, y);
        ctx.lineTo(x + ex * l, y + ey * l);
      }
      carry = (carry - len) % step;
      if (carry < 0) carry += step;
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140,115,85,0.5)';
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (const p of c) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  drawWater(ctx, view, px, scale) {
    const T = this.terrain;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of T.rivers) {
      if (r.minor) continue;
      const p = r.pts;
      // Schluchtschraffur an tiefen Stellen (dort braucht ein Seil einen Mast)
      ctx.strokeStyle = 'rgba(150,120,85,0.45)';
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i];
        const b = p[i + 1];
        if (Math.min(a.gorge, b.gorge) < GORGE_MAST_DEPTH) continue;
        if (Math.max(a.x, b.x) < view.x0 - 20 || Math.min(a.x, b.x) > view.x1 + 20) continue;
        if (Math.max(a.y, b.y) < view.y0 - 20 || Math.min(a.y, b.y) > view.y1 + 20) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len;
        const ny = (b.x - a.x) / len;
        const step = Math.max(6, 5 * px);
        for (let d = 0; d < len; d += step) {
          const x = a.x + ((b.x - a.x) * d) / len;
          const y = a.y + ((b.y - a.y) * d) / len;
          for (const sgn of [1, -1]) {
            ctx.moveTo(x + nx * sgn * 5, y + ny * sgn * 5);
            ctx.lineTo(x + nx * sgn * 11, y + ny * sgn * 11);
          }
        }
      }
      ctx.stroke();
      ctx.strokeStyle = '#78B2D6';
      ctx.lineWidth = (r.main ? 2.2 : 1.4) * Math.max(px, 0.55);
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (const q of p) ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#A9D2E8';
    ctx.strokeStyle = '#78B2D6';
    ctx.lineWidth = 1 * px;
    for (const l of T.lakes) {
      ctx.beginPath();
      ctx.ellipse(l.x, l.y, l.rx, l.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    void scale;
  }

  drawLabels(ctx, view, scale, alpha = 1) {
    const px = 1 / scale;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const big = clamp(13, 11, 16) * px;
    const small = 10.5 * px;
    for (const p of this.places) {
      if (!p.label) continue;
      if (p.x < view.x0 - 200 || p.x > view.x1 + 200 || p.y < view.y0 - 50 || p.y > view.y1 + 50) continue;
      if (p.label === 2 && scale < 0.75) continue;
      ctx.globalAlpha = (p.label === 1 ? 0.55 : 0.6) * alpha;
      ctx.font = p.label === 1 ? `700 ${big}px ${FONT}` : `600 ${small}px ${FONT}`;
      ctx.fillStyle = p.label === 1 ? '#8C7E68' : '#9A8D78';
      setSpacing(ctx, `${(p.label === 1 ? 3 : 1) * px}px`);
      ctx.fillText(p.label === 1 ? p.name.toUpperCase() : p.name, p.x, p.y);
    }
    setSpacing(ctx, '0px');
    // Flussnamen entlang des Laufs
    ctx.font = `italic 500 ${10 * px}px ${FONT}`;
    ctx.fillStyle = '#5E9BC0';
    ctx.globalAlpha = 0.8 * alpha;
    for (const r of this.terrain.rivers) {
      if (!r.main) continue;
      const p = r.pts;
      const i = Math.floor(p.length * 0.45);
      const a = p[i];
      const b = p[Math.min(p.length - 1, i + 3)];
      if (a.x < view.x0 || a.x > view.x1 || a.y < view.y0 || a.y > view.y1) continue;
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      ctx.fillText(r.name, 0, -9 * px);
      ctx.restore();
    }
    ctx.font = `600 ${10.5 * px}px ${FONT}`;
    ctx.fillStyle = '#8C7E68';
    ctx.globalAlpha = 0.6 * alpha;
    for (const e of EDGE_LABELS) {
      ctx.textAlign = e.align;
      ctx.fillText(e.text, e.x * K, e.y * K);
    }
    ctx.restore();
  }
}

function setSpacing(ctx, v) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = v;
}
