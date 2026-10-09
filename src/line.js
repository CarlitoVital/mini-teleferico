// Seilbahnlinien: gerade Seilstrecken zwischen Stationen, Masten und Endstücke.
import { CONFIG, LINE_COLORS } from './config.js';
import { TAU, rgba } from './util.js';

export const pairKey = (a, b) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);

/** Strecke a→b, um `off` senkrecht verschoben (richtungsunabhängige Normale). */
export function offsetSegment(a, b, off) {
  if (!off) return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  const lo = a.id < b.id ? a : b;
  const hi = lo === a ? b : a;
  const dx = hi.x - lo.x;
  const dy = hi.y - lo.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * off;
  const ny = (dx / l) * off;
  return { ax: a.x + nx, ay: a.y + ny, bx: b.x + nx, by: b.y + ny };
}

export class Line {
  constructor(id, slot) {
    this.id = id;
    this.slot = slot;
    this.color = LINE_COLORS[slot];
    this.stations = [];
    this.gondolas = [];
    this.state = 'active'; // 'active' | 'closing'
    this.segPlans = [];
    this.created = 0;
  }

  get active() {
    return this.state === 'active';
  }

  has(st) {
    return this.stations.includes(st);
  }

  indexOf(st) {
    return this.stations.indexOf(st);
  }

  hasSegment(a, b) {
    const i = this.stations.indexOf(a);
    if (i < 0) return false;
    return this.stations[i + 1] === b || this.stations[i - 1] === b;
  }

  get mastCount() {
    let n = 0;
    for (const p of this.segPlans) n += p.count;
    return n;
  }

  get tallCount() {
    let n = 0;
    for (const p of this.segPlans) n += p.tall;
    return n;
  }
}

/** Geometrie eines Linienendes (T-Stück zum Verlängern). atEnd=false → Anfang. */
export function handleGeometry(game, line, atEnd) {
  const st = line.stations;
  const n = st.length;
  if (n < 2) return null;
  const t = atEnd ? st[n - 1] : st[0];
  const p = atEnd ? st[n - 2] : st[1];
  const s = offsetSegment(p, t, game.segOffset(line, p, t));
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const len = CONFIG.handleLength;
  return { station: t, x0: s.bx, y0: s.by, x1: s.bx + ux * len, y1: s.by + uy * len, ux, uy };
}

/** Polylinie einer Stationsfolge mit den Versätzen der Linie. */
export function tracePolyline(ctx, game, line, stations) {
  ctx.beginPath();
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    const s = offsetSegment(a, b, line ? game.segOffset(line, a, b) : 0);
    if (i === 0) ctx.moveTo(s.ax, s.ay);
    else ctx.lineTo(s.ax, s.ay);
    ctx.lineTo(s.bx, s.by);
  }
}

export function strokeLineStyle(ctx, color, width, alpha = 1) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (color.casing) {
    ctx.strokeStyle = rgba(color.casing, alpha);
    ctx.lineWidth = width + 2.6;
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(color.hex, alpha);
  ctx.lineWidth = width;
  ctx.stroke();
}

export function drawLine(ctx, game, line, opts = {}) {
  const alpha = opts.alpha ?? 1;
  const w = CONFIG.lineWidth;
  ctx.save();
  if (!line.active) ctx.setLineDash([10, 9]);
  if (opts.glow) {
    tracePolyline(ctx, game, line, line.stations);
    ctx.strokeStyle = rgba(line.color.hex, 0.22);
    ctx.lineWidth = w + 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  tracePolyline(ctx, game, line, line.stations);
  strokeLineStyle(ctx, line.color, w, alpha);
  ctx.restore();
}

export function drawHandles(ctx, game, line, alpha = 1) {
  if (!line.active || line.stations.length < 2) return;
  for (const atEnd of [false, true]) {
    const h = handleGeometry(game, line, atEnd);
    const nx = -h.uy;
    const ny = h.ux;
    ctx.beginPath();
    ctx.moveTo(h.x0, h.y0);
    ctx.lineTo(h.x1, h.y1);
    ctx.moveTo(h.x1 + nx * 8, h.y1 + ny * 8);
    ctx.lineTo(h.x1 - nx * 8, h.y1 - ny * 8);
    strokeLineStyle(ctx, line.color, CONFIG.lineWidth, alpha);
  }
}

/** Ein Seilbahnmast: Gittermast, dessen Spitze das Seil trägt. */
export function drawMast(ctx, x, y, opts = {}) {
  const c = opts.invalid ? '#D8463C' : '#4F535B';
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha *= opts.alpha ?? 1;
  // Hoher Mast (über einem Gebäude): größer, mit rot-weißer Spitze wie eine Flughindernis-Markierung
  if (opts.tall) ctx.scale(1.3, 1.55);
  ctx.fillStyle = 'rgba(40,30,20,0.10)';
  ctx.beginPath();
  ctx.ellipse(0, 17, 8, 2.3, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6.2, 17);
  ctx.lineTo(-1.7, 1);
  ctx.lineTo(1.7, 1);
  ctx.lineTo(6.2, 17);
  ctx.closePath();
  ctx.fillStyle = c;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-4.6, 12.5);
  ctx.lineTo(3.2, 5.2);
  ctx.moveTo(4.6, 12.5);
  ctx.lineTo(-3.2, 5.2);
  ctx.moveTo(-5.2, 13.6);
  ctx.lineTo(5.2, 13.6);
  ctx.stroke();
  ctx.fillStyle = c;
  ctx.fillRect(-6.5, -1.8, 13, 2.8);
  if (opts.tall) {
    ctx.fillStyle = '#E03A3E';
    ctx.fillRect(-2.6, 1, 5.2, 2.2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-3, 3.2, 6, 1.6);
    ctx.fillStyle = '#E03A3E';
    ctx.fillRect(-3.4, 4.8, 6.8, 1.8);
  }
  ctx.restore();
}

/** Masten einer Strecke (normale und hohe) entlang a→b zeichnen. */
export function drawPlanSupports(ctx, plan, ax, ay, bx, by, opts = {}) {
  for (const t of plan.ts) drawMast(ctx, ax + (bx - ax) * t, ay + (by - ay) * t, opts);
  for (const t of plan.tallTs) drawMast(ctx, ax + (bx - ax) * t, ay + (by - ay) * t, { ...opts, tall: true });
}

export function drawLineMasts(ctx, game, line, alpha = 1) {
  const st = line.stations;
  for (let i = 0; i < st.length - 1; i++) {
    const plan = line.segPlans[i];
    if (!plan || (!plan.count && !plan.tall)) continue;
    const s = offsetSegment(st[i], st[i + 1], game.segOffset(line, st[i], st[i + 1]));
    drawPlanSupports(ctx, plan, s.ax, s.ay, s.bx, s.by, { alpha });
  }
}

