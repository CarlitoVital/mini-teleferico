// Stationen: Daten, Formen und Darstellung.
import { CONFIG, INK } from './config.js';
import { TAU, clamp, easeOutBack } from './util.js';

export class Station {
  constructor({ id, x, y, shape, name, elev, born }) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.shape = shape;
    this.name = name;
    this.elev = elev;
    this.born = born;
    this.waiting = [];
    this.overcrowd = 0; // 0..1, bei 1 ist das Spiel vorbei
    this.interchange = false;
    this.nextSpawn = 0;
    this.bump = -10; // Zeitpunkt der letzten Ankunft (für kleinen Puls)
  }

  get capacity() {
    return this.interchange ? CONFIG.interchangeCapacity : CONFIG.stationCapacity;
  }

  get radius() {
    return this.interchange ? CONFIG.stationRadius * 1.45 : CONFIG.stationRadius;
  }
}

/** Legt den Pfad einer Form an (Kreis, Dreieck, …) – optisch etwa gleich groß. */
export function tracePath(ctx, shape, x, y, r) {
  ctx.beginPath();
  switch (shape) {
    case 'square': {
      const s = r * 0.88;
      ctx.rect(x - s, y - s, s * 2, s * 2);
      break;
    }
    case 'triangle': {
      const R = r * 1.3;
      const cy = y + r * 0.14;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 3;
        const px = x + Math.cos(a) * R;
        const py = cy + Math.sin(a) * R;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      break;
    }
    case 'diamond': {
      const R = r * 1.28;
      ctx.moveTo(x, y - R);
      ctx.lineTo(x + R * 0.84, y);
      ctx.lineTo(x, y + R);
      ctx.lineTo(x - R * 0.84, y);
      break;
    }
    case 'star': {
      const R = r * 1.4;
      const ri = R * 0.48;
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? ri : R;
        const px = x + Math.cos(a) * rr;
        const py = y + 0.08 * r + Math.sin(a) * rr;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      break;
    }
    case 'cross': {
      const a = r * 0.42;
      const b = r * 1.1;
      const pts = [
        [-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a],
        [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a],
      ];
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
      break;
    }
    default:
      ctx.arc(x, y, r, 0, TAU);
  }
  ctx.closePath();
}

export function drawOvercrowd(ctx, st, time) {
  if (st.overcrowd <= 0) return;
  const danger = st.overcrowd > 0.66;
  const R = st.radius * 2.7 * (danger ? 1 + 0.04 * Math.sin(time * 9) : 1);
  ctx.beginPath();
  ctx.arc(st.x, st.y, R, 0, TAU);
  ctx.fillStyle = danger ? 'rgba(214,64,52,0.08)' : 'rgba(42,42,46,0.05)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(st.x, st.y);
  ctx.arc(st.x, st.y, R, -Math.PI / 2, -Math.PI / 2 + TAU * st.overcrowd);
  ctx.closePath();
  ctx.fillStyle = danger ? 'rgba(214,64,52,0.30)' : 'rgba(42,42,46,0.17)';
  ctx.fill();
}

export function drawStation(ctx, st, time, opts = {}) {
  const r = CONFIG.stationRadius;
  const age = time - st.born;
  let k = age < 0.6 ? easeOutBack(clamp(age / 0.6, 0, 1)) : 1;
  const sinceBump = time - st.bump;
  if (sinceBump < 0.35) k *= 1 + 0.12 * Math.sin((sinceBump / 0.35) * Math.PI);
  if (k <= 0.01) return;
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.scale(k, k);
  if (opts.highlight) {
    tracePath(ctx, st.shape, 0, 0, st.radius + 6);
    ctx.fillStyle = 'rgba(42,42,46,0.10)';
    ctx.fill();
  }
  ctx.lineJoin = 'round';
  if (st.interchange) {
    tracePath(ctx, st.shape, 0, 0, r * 1.45);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  tracePath(ctx, st.shape, 0, 0, r);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = opts.invalid ? '#D8463C' : INK;
  ctx.stroke();
  ctx.restore();
}

/** Wartende Fahrgäste als kleine Formen rechts neben der Station. */
export function drawWaiting(ctx, st) {
  const n = st.waiting.length;
  if (!n) return;
  const x0 = st.x + st.radius + 8;
  const y0 = st.y - 4.7;
  ctx.fillStyle = INK;
  for (let i = 0; i < n; i++) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    tracePath(ctx, st.waiting[i].shape, x0 + col * 9, y0 + row * 9.4, 3.3);
    ctx.fill();
  }
}
