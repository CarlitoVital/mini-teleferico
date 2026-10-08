// Stilisierte Karte des Talkessels von La Paz: Höhenbänder, Schluchten, Illimani.
import { CONFIG } from './config.js';
import { TAU, smoothstep, pointSegDist, segIntersect, lerp } from './util.js';

/** Höhenstufen von oben (El Alto) nach unten (Zona Sur). */
export const BANDS = [
  { key: 'alto', name: 'El Alto', elev: 4050, fill: '#ECE3D3', line: '#DED2BE' },
  { key: 'ladera', name: 'Laderas', elev: 3840, fill: '#F2EADC', line: '#E4D8C4' },
  { key: 'centro', name: 'Centro', elev: 3620, fill: '#F7F3EA', line: '#E9E0CF' },
  { key: 'sur', name: 'Zona Sur', elev: 3280, fill: '#E8EFE1', line: '#D5DFCA' },
];

// Kontrollpunkte (normiert 0..1) der Schluchten. Der Orkojahuira mündet in den Choqueyapu.
const RIVER_DEFS = [
  {
    name: 'Río Choqueyapu',
    width: 30,
    water: 4.4,
    pts: [
      [0.37, 0.33], [0.4, 0.41], [0.44, 0.49], [0.5, 0.56], [0.49, 0.65],
      [0.55, 0.75], [0.6, 0.86], [0.63, 0.96], [0.67, 1.12],
    ],
  },
  {
    name: 'Río Orkojahuira',
    width: 22,
    water: 3.2,
    pts: [[0.85, 0.35], [0.8, 0.42], [0.72, 0.46], [0.63, 0.51]],
    joinRiver: 0,
    joinIndex: 3,
  },
];

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
      const f = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

export class CityMap {
  constructor(W, H, rng) {
    this.W = W;
    this.H = H;
    const ph = () => rng() * TAU;
    // Grenzkurven zwischen den Bändern: Grundlinie + überlagerte Sinuswellen.
    this.bounds = [
      { base: 0.285, waves: [[0.024, 1.2, ph()], [0.012, 2.9, ph()], [0.006, 6.7, ph()]] },
      { base: 0.43, waves: [[0.022, 1.0, ph()], [0.011, 2.4, ph()], [0.006, 5.9, ph()]] },
      { base: 0.695, waves: [[0.028, 0.8, ph()], [0.012, 2.2, ph()], [0.006, 5.3, ph()]] },
    ];
    this.rivers = [];
    const jittered = RIVER_DEFS.map((def) =>
      def.pts.map(([u, v], i) => ({
        x: (u + (i ? (rng() - 0.5) * 0.024 : 0)) * W,
        y: (v + (i ? (rng() - 0.5) * 0.02 : 0)) * H,
      })),
    );
    RIVER_DEFS.forEach((def, idx) => {
      const ctrl = jittered[idx].map((p) => ({ ...p }));
      // Quelle knapp unterhalb der Hangkante von El Alto
      ctrl[0].y = Math.max(ctrl[0].y, this.boundaryY(0, ctrl[0].x) + H * 0.035);
      if (def.joinRiver !== undefined) ctrl.push({ ...jittered[def.joinRiver][def.joinIndex] });
      const pts = catmullRom(ctrl, 14);
      let s = 0;
      pts[0].s = 0;
      for (let i = 1; i < pts.length; i++) {
        s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        pts[i].s = s;
      }
      this.rivers.push({ name: def.name, width: def.width, water: def.water, pts, length: s });
    });
    this.planCache = new Map();
  }

  boundaryY(k, x) {
    const b = this.bounds[k];
    const u = x / this.W;
    let v = b.base;
    for (const [a, f, p] of b.waves) v += a * Math.sin(u * f * TAU + p);
    return v * this.H;
  }

  bandAt(x, y) {
    let band = 0;
    for (let k = 0; k < this.bounds.length; k++) if (y > this.boundaryY(k, x)) band = k + 1;
    return band;
  }

  /** Halbe Schluchtbreite an Bogenlänge s (die Quelle läuft spitz zu). */
  riverHalfWidth(river, s) {
    return (river.width / 2) * (0.25 + 0.75 * smoothstep(0, 90, s));
  }

  distToRiver(x, y) {
    let best = Infinity;
    for (const r of this.rivers) {
      const p = r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const q = pointSegDist(x, y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
        const d = q.d - this.riverHalfWidth(r, lerp(p[i].s, p[i + 1].s, q.t));
        if (d < best) best = d;
      }
    }
    return best;
  }

  /** Schnittpunkte einer Seilstrecke mit Schluchten (nahe Treffer zusammengefasst). */
  riverCrossings(ax, ay, bx, by) {
    const hits = [];
    for (const r of this.rivers) {
      const p = r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const t = segIntersect(ax, ay, bx, by, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
        if (t >= 0) hits.push(t);
      }
    }
    hits.sort((a, b) => a - b);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const merged = [];
    for (const t of hits) {
      if (!merged.length || (t - merged[merged.length - 1]) * len > 34) merged.push(t);
    }
    return merged;
  }

  /**
   * Mastbedarf einer Strecke: Spannweiten über maxSpan und jede Schluchtquerung
   * brauchen einen Mast. Liefert Anzahl und Positionen (t entlang der Strecke).
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
    // Positionen sind für die Richtung lo→hi gespeichert
    return swap ? { ...plan, ts: plan.ts.map((t) => 1 - t) } : plan;
  }

  computeMastPlan(a, b) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const crossings = this.riverCrossings(a.x, a.y, b.x, b.y);
    const spanNeed = Math.max(0, Math.ceil(len / CONFIG.maxSpan) - 1);
    const count = Math.max(spanNeed, crossings.length);
    const ts =
      crossings.length && crossings.length >= spanNeed
        ? crossings.slice()
        : Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
    return { count, ts, crossings: crossings.length, length: len };
  }

  /**
   * Sucht einen Bauplatz für eine neue Station im aktuellen Stadtbereich.
   * bandWeights steuert, in welchen Höhenstufen die Stadt bevorzugt wächst.
   */
  findSpot(rng, stations, segments, region, bandWeights, opts = {}) {
    const minDist = opts.minDist ?? CONFIG.stationMinDist;
    const maxNear = opts.maxNear ?? 270;
    const margin = Math.min(60, region.w * 0.08);
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 90; i++) {
      const x = region.x + margin + rng() * (region.w - 2 * margin);
      const y = region.y + margin + rng() * (region.h - 2 * margin);
      if (this.distToRiver(x, y) < CONFIG.stationRadius + 16) continue;
      let dmin = Infinity;
      for (const s of stations) dmin = Math.min(dmin, Math.hypot(s.x - x, s.y - y));
      if (dmin < minDist) continue;
      let blocked = false;
      for (const sg of segments) {
        if (pointSegDist(x, y, sg.ax, sg.ay, sg.bx, sg.by).d < CONFIG.stationRadius + 16) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const band = this.bandAt(x, y);
      let score = bandWeights[band] * (0.35 + rng());
      if (stations.length && dmin > maxNear) score *= 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, band };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- Zeichnen

  drawTerrain(ctx, view, px) {
    const step = Math.max(6, (view.x1 - view.x0) / 110);
    const x0 = view.x0 - step * 2;
    const x1 = view.x1 + step * 2;
    const yBottom = view.y1 + 20;
    const yTop = view.y0 - 20;
    ctx.fillStyle = BANDS[0].fill;
    ctx.fillRect(view.x0 - 2, view.y0 - 2, view.x1 - view.x0 + 4, view.y1 - view.y0 + 4);

    for (let k = 0; k < this.bounds.length; k++) {
      ctx.beginPath();
      ctx.moveTo(x0, this.boundaryY(k, x0));
      for (let x = x0 + step; x <= x1; x += step) ctx.lineTo(x, this.boundaryY(k, x));
      ctx.lineTo(x1, yBottom);
      ctx.lineTo(x0, yBottom);
      ctx.closePath();
      ctx.fillStyle = BANDS[k + 1].fill;
      ctx.fill();
    }

    // Höhenlinien: feine Zwischenlinien in jedem Band, kräftigere an den Grenzen.
    const curve = (fn) => {
      ctx.beginPath();
      ctx.moveTo(x0, fn(x0));
      for (let x = x0 + step; x <= x1; x += step) ctx.lineTo(x, fn(x));
      ctx.stroke();
    };
    ctx.lineJoin = 'round';
    ctx.lineWidth = px;
    const H = this.H;
    for (let b = 0; b < BANDS.length; b++) {
      ctx.strokeStyle = BANDS[b].line;
      if (b === 0) {
        for (let j = 1; j <= 6; j++) {
          const off = H * 0.055 * j;
          if (this.boundaryY(0, 0) - off < yTop - 200) break;
          curve((x) => this.boundaryY(0, x) - off);
        }
      } else if (b === BANDS.length - 1) {
        for (let j = 1; j <= 6; j++) curve((x) => this.boundaryY(b - 1, x) + H * 0.065 * j);
      } else {
        for (const f of [0.35, 0.7]) curve((x) => lerp(this.boundaryY(b - 1, x), this.boundaryY(b, x), f));
      }
    }
    ctx.lineWidth = 1.6 * px;
    for (let k = 0; k < this.bounds.length; k++) {
      ctx.strokeStyle = BANDS[k].line;
      curve((x) => this.boundaryY(k, x));
    }
  }

  drawRivers(ctx, px) {
    for (const r of this.rivers) {
      const p = r.pts;
      const left = [];
      const right = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[Math.max(0, i - 1)];
        const b = p[Math.min(p.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        const hw = this.riverHalfWidth(r, p[i].s);
        const nx = -dy / l;
        const ny = dx / l;
        left.push({ x: p[i].x + nx * hw, y: p[i].y + ny * hw, nx, ny });
        right.push({ x: p[i].x - nx * hw, y: p[i].y - ny * hw, nx: -nx, ny: -ny });
      }
      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      for (const q of left) ctx.lineTo(q.x, q.y);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
      ctx.closePath();
      ctx.fillStyle = '#E2D3BC';
      ctx.fill();

      // Kartografische Böschungsstriche entlang der Kanten
      ctx.strokeStyle = '#CDBA9C';
      ctx.lineWidth = 1.1 * px;
      ctx.beginPath();
      for (const edge of [left, right]) {
        for (let i = 2; i < edge.length - 1; i += 2) {
          const q = edge[i];
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x + q.nx * 6, q.y + q.ny * 6);
        }
      }
      ctx.stroke();
      ctx.lineWidth = 1.4 * px;
      for (const edge of [left, right]) {
        ctx.beginPath();
        ctx.moveTo(edge[0].x, edge[0].y);
        for (const q of edge) ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }

      // Wasserlauf
      ctx.strokeStyle = '#7DB7D6';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const chunk = 8;
      for (let i = 0; i < p.length - 1; i += chunk) {
        ctx.beginPath();
        ctx.moveTo(p[i].x, p[i].y);
        for (let j = i + 1; j <= Math.min(p.length - 1, i + chunk); j++) ctx.lineTo(p[j].x, p[j].y);
        ctx.lineWidth = r.water * (0.35 + 0.65 * smoothstep(0, 110, p[i].s));
        ctx.stroke();
      }
    }
  }

  drawLabels(ctx, region, scale, alpha = 1) {
    const fs = 11 / scale;
    ctx.save();
    ctx.globalAlpha = 0.75 * alpha;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const x = region.x + 18 / scale + region.w * 0.012;
    for (let b = 0; b < BANDS.length; b++) {
      const top = b === 0 ? region.y : this.boundaryY(b - 1, x);
      const bottom = b === BANDS.length - 1 ? region.y + region.h : this.boundaryY(b, x);
      const yTop = Math.max(top, region.y);
      const yBot = Math.min(bottom, region.y + region.h);
      if (yBot - yTop < fs * 3) continue;
      const y = b === 0 ? Math.max(yTop + fs * 2.2, yBot - fs * 3.2) : yTop + fs * 2.2;
      ctx.font = `700 ${fs}px "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = '#A3967F';
      setSpacing(ctx, `${2 / scale}px`);
      ctx.fillText(BANDS[b].name.toUpperCase(), x, y);
      ctx.font = `500 ${fs * 0.92}px "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      setSpacing(ctx, `${1 / scale}px`);
      ctx.fillStyle = '#B9AE9B';
      ctx.fillText(`${BANDS[b].elev} m`, x, y + fs * 1.35);
    }
    setSpacing(ctx, '0px');

    // Flussnamen entlang des Laufs
    ctx.font = `italic 500 ${fs * 0.95}px "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = '#6FA3C0';
    for (const r of this.rivers) {
      const p = r.pts;
      for (const frac of [0.62, 0.3]) {
        const i = Math.floor(p.length * frac);
        const a = p[i];
        const b = p[Math.min(p.length - 1, i + 6)];
        if (a.x < region.x || a.x > region.x + region.w || a.y < region.y || a.y > region.y + region.h) continue;
        let ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(ang);
        ctx.textAlign = 'center';
        ctx.fillText(r.name, 0, -r.width / 2 - fs * 0.9);
        ctx.restore();
        break;
      }
    }
    ctx.restore();
  }
}

function setSpacing(ctx, v) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = v;
}

/**
 * Silhouette des Illimani (drei Gipfel, Schneefelder) – Kulisse im Bildschirmraum.
 * night: 0..1 dunkelt die Farben ab.
 */
export function drawIllimani(ctx, x, y, w, h, night = 0, alpha = 1) {
  const ridge = [
    [0, 1], [0.08, 0.84], [0.16, 0.7], [0.22, 0.62], [0.27, 0.48], [0.31, 0.4], [0.345, 0.27],
    [0.38, 0.33], [0.42, 0.29], [0.47, 0.16], [0.52, 0.24], [0.56, 0.2], [0.6, 0.06],
    [0.65, 0.14], [0.7, 0.26], [0.76, 0.38], [0.82, 0.5], [0.88, 0.66], [0.94, 0.82], [1, 1],
  ];
  const P = ([u, v]) => [x + u * w, y + v * h];
  ctx.save();
  ctx.globalAlpha = alpha;
  // Vorgelagerte Hügel
  ctx.beginPath();
  ctx.moveTo(x - w * 0.15, y + h);
  ctx.quadraticCurveTo(x + w * 0.1, y + h * 0.62, x + w * 0.35, y + h * 0.86);
  ctx.quadraticCurveTo(x + w * 0.62, y + h * 0.7, x + w * 0.9, y + h * 0.88);
  ctx.quadraticCurveTo(x + w * 1.05, y + h * 0.8, x + w * 1.15, y + h);
  ctx.closePath();
  const hills = ctx.createLinearGradient(0, y + h * 0.6, 0, y + h);
  hills.addColorStop(0, night > 0.5 ? 'rgba(182,185,196,0.5)' : 'rgba(217,211,196,0.5)');
  hills.addColorStop(1, night > 0.5 ? 'rgba(182,185,196,0)' : 'rgba(217,211,196,0)');
  ctx.fillStyle = hills;
  ctx.fill();

  // Bergkörper, nach unten in die Karte auslaufend
  ctx.beginPath();
  ctx.moveTo(...P(ridge[0]));
  for (const r of ridge) ctx.lineTo(...P(r));
  ctx.closePath();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  const body = night > 0.5 ? [169, 177, 198] : [198, 207, 219];
  g.addColorStop(0, `rgba(${body},1)`);
  g.addColorStop(0.55, `rgba(${body},0.85)`);
  g.addColorStop(1, `rgba(${body},0)`);
  ctx.fillStyle = g;
  ctx.fill();

  // Schneefelder: folgt dem Grat und endet in einer gezackten Schneegrenze
  const snowLine = [
    [0.86, 0.6], [0.8, 0.52], [0.76, 0.5], [0.72, 0.42], [0.68, 0.46], [0.64, 0.38], [0.6, 0.44],
    [0.56, 0.36], [0.52, 0.42], [0.48, 0.34], [0.44, 0.42], [0.4, 0.38], [0.36, 0.46], [0.32, 0.42],
    [0.28, 0.5], [0.24, 0.58],
  ];
  ctx.beginPath();
  const ridgeTop = ridge.filter(([u]) => u >= 0.22 && u <= 0.86);
  ctx.moveTo(...P(ridgeTop[0]));
  for (const r of ridgeTop) ctx.lineTo(...P(r));
  for (const r of snowLine) ctx.lineTo(...P(r));
  ctx.closePath();
  ctx.fillStyle = night > 0.5 ? '#E7EAF2' : '#FFFFFF';
  ctx.fill();

  // Schattenseite der Gipfel
  ctx.beginPath();
  ctx.moveTo(...P([0.6, 0.06]));
  ctx.lineTo(...P([0.65, 0.14]));
  ctx.lineTo(...P([0.7, 0.26]));
  ctx.lineTo(...P([0.66, 0.3]));
  ctx.lineTo(...P([0.62, 0.22]));
  ctx.closePath();
  ctx.moveTo(...P([0.47, 0.16]));
  ctx.lineTo(...P([0.52, 0.24]));
  ctx.lineTo(...P([0.5, 0.3]));
  ctx.closePath();
  ctx.fillStyle = 'rgba(150,165,190,0.25)';
  ctx.fill();
  ctx.restore();
}

