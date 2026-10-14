// Gebäudeschicht: überbaubare Häuser/Felder (dezent) und blockierende Bauwerke (dunkel, mit Symbol).
// Wird pro Seed erzeugt, ist aber an die Siedlungsgebiete und festen Landmarken gebunden.
import { LANDMARKS, HIGHRISE_ZONES, MAP } from './data/terrain.js';
import { makeRng, clamp, segIntersect, pointSegDist } from './util.js';

const K = MAP.unitsPerKm;
const DEG = Math.PI / 180;
/** Grundrichtung des Straßenrasters von El Alto. */
const GRID_ANGLE = -8 * DEG;

/** Diese Bauwerke dürfen mit einem hohen Mast einzeln überspannt werden. */
const TALL_OK = new Set(['highrise', 'stadium', 'hospital', 'barracks']);

function rectPoly(cx, cy, len, wid, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hl = len / 2;
  const hw = wid / 2;
  return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

function circlePoly(cx, cy, r, n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function bbox(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export class Buildings {
  /**
   * @param {import('./map.js').CityMap} map
   * @param {number} seed
   */
  constructor(map, seed) {
    this.map = map;
    this.terrain = map.terrain;
    this.rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
    this.blocking = [];
    this.light = []; // {x, y, w, h, a, kind: 'house'|'market'|'field'}
    this.buildLandmarks();
    this.buildHighrises();
    this.buildLight();
    this.indexLight();
  }

  addBlocking(kind, name, poly, extra = {}) {
    const b = { id: this.blocking.length, kind, name, poly, ...bbox(poly), tallOk: TALL_OK.has(kind), ...extra };
    b.cx = (b.minX + b.maxX) / 2;
    b.cy = (b.minY + b.maxY) / 2;
    this.blocking.push(b);
    return b;
  }

  buildLandmarks() {
    for (const lm of LANDMARKS) {
      if (lm.rect) {
        const [x, y, len, wid, ang] = lm.rect;
        this.addBlocking(lm.kind, lm.name, rectPoly(x * K, y * K, len * K, wid * K, ang * DEG), {
          angle: ang * DEG, len: len * K, wid: wid * K,
        });
      } else if (lm.circle) {
        const [x, y, r] = lm.circle;
        this.addBlocking(lm.kind, lm.name, circlePoly(x * K, y * K, r * K), { r: r * K });
      } else if (lm.approach) {
        // Einflugschneisen: Trapeze an beiden Pistenenden
        const ap = lm.approach;
        const ang = ap.angle * DEG;
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        for (const dir of [-1, 1]) {
          const sx = ap.x * K + ux * dir * ap.halfRunway * K;
          const sy = ap.y * K + uy * dir * ap.halfRunway * K;
          const ex = sx + ux * dir * ap.length * K;
          const ey = sy + uy * dir * ap.length * K;
          const w0 = (ap.w0 * K) / 2;
          const w1 = (ap.w1 * K) / 2;
          const poly = [
            { x: sx - uy * w0, y: sy + ux * w0 }, { x: ex - uy * w1, y: ey + ux * w1 },
            { x: ex + uy * w1, y: ey - ux * w1 }, { x: sx + uy * w0, y: sy - ux * w0 },
          ];
          this.addBlocking('approach', lm.name, poly, { angle: ang, dir });
        }
      }
    }
  }

  isFree(x, y, pad) {
    const T = this.terrain;
    if (!T.inBounds(x, y, 10) || T.inLake(x, y, pad)) return false;
    return !T.waterWithin(x, y, pad + 6, pad + 1);
  }

  buildHighrises() {
    const rng = this.rng;
    for (const [zx, zy, zr, nMin, nMax] of HIGHRISE_ZONES) {
      const n = nMin + Math.floor(rng() * (nMax - nMin + 1));
      const placed = [];
      for (let tries = 0; tries < n * 30 && placed.length < n; tries++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * zr * K;
        const x = zx * K + Math.cos(a) * r;
        const y = zy * K + Math.sin(a) * r;
        const size = 5 + rng() * 3.5;
        if (!this.isFree(x, y, size + 3)) continue;
        if (this.terrain.slopeAt(x, y) > 1.8) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < 15)) continue;
        if (this.blocking.some((b) => x > b.minX - 12 && x < b.maxX + 12 && y > b.minY - 12 && y < b.maxY + 12)) continue;
        const ang = (rng() - 0.5) * 30 * DEG + this.streetAngle(x, y);
        placed.push({ x, y });
        this.addBlocking('highrise', 'Hochhaus', rectPoly(x, y, size, size * (0.7 + rng() * 0.4), ang), { angle: ang, size });
      }
    }
  }

  /** Straßenrichtung: Raster in El Alto, sonst entlang der Höhenlinien. */
  streetAngle(x, y) {
    if (this.terrain.isPlateau(x, y)) return GRID_ANGLE;
    const T = this.terrain;
    const gx = T.heightAt(x + 6, y) - T.heightAt(x - 6, y);
    const gy = T.heightAt(x, y + 6) - T.heightAt(x, y - 6);
    if (Math.abs(gx) + Math.abs(gy) < 0.5) return GRID_ANGLE;
    return Math.atan2(gy, gx) + Math.PI / 2;
  }

  blockedNear(x, y, r) {
    for (const b of this.blocking) {
      if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) continue;
      if (pointInPoly(x, y, b.poly)) return b;
      const p = b.poly;
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        if (pointSegDist(x, y, p[i].x, p[i].y, q.x, q.y).d < r) return b;
      }
    }
    return null;
  }

  buildLight() {
    const rng = this.rng;
    const map = this.map;
    const T = this.terrain;
    const W = T.W;
    const H = T.H;
    const add = (x, y, w, h, a, kind) => {
      if (this.blockedNear(x, y, Math.max(w, h) * 0.6 + 2)) return;
      this.light.push({ x, y, w, h, a, kind });
    };
    // El Alto: Schachbrett
    const pitch = 12;
    const ca = Math.cos(GRID_ANGLE);
    const sa = Math.sin(GRID_ANGLE);
    for (let v = -300; v < H + 300; v += pitch) {
      for (let u = -300; u < W + 300; u += pitch) {
        const x = u * ca - v * sa;
        const y = u * sa + v * ca;
        if (x < 0 || y < 0 || x > W || y > H) continue;
        if (!T.isPlateau(x, y)) continue;
        const d = map.urbanAt(x, y);
        if (d <= 0.02 || rng() > d * 1.15) continue;
        if (!this.isFree(x, y, 5)) continue;
        const r = rng();
        if (r < 0.015) add(x, y, 20, 14, GRID_ANGLE, 'market');
        else if (r < 0.03) continue; // Platz
        else add(x, y, 8.5 + rng() * 1.5, 8 + rng() * 1.5, GRID_ANGLE, 'house');
      }
    }
    // Talkessel und Süden: Blöcke entlang der Höhenlinien, Felder in lockeren Gebieten
    for (const u of map.urban) {
      if (u.style === 'grid') continue;
      const step = u.style === 'garden' ? 13 : 10;
      for (let y = u.y - u.ry; y <= u.y + u.ry; y += step) {
        for (let x = u.x - u.rx; x <= u.x + u.rx; x += step) {
          const jx = x + (rng() - 0.5) * step * 0.5;
          const jy = y + (rng() - 0.5) * step * 0.5;
          if (T.isPlateau(jx, jy)) continue;
          const d = map.urbanAt(jx, jy);
          if (d <= 0.02 || rng() > d * (u.style === 'garden' ? 0.75 : 1.1)) continue;
          const slope = T.slopeAt(jx, jy);
          if (slope > 2.2 || !this.isFree(jx, jy, 4)) continue;
          const a = this.streetAngle(jx, jy);
          if (u.style === 'garden' && slope < 0.9 && rng() < 0.35) {
            add(jx, jy, 16 + rng() * 14, 10 + rng() * 8, a, 'field');
          } else {
            add(jx, jy, 6 + rng() * 3, 4.5 + rng() * 2.5, a, rng() < 0.01 ? 'market' : 'house');
          }
        }
      }
    }
  }

  /** Raster-Index für schnelles Ausblenden außerhalb der Ansicht. */
  indexLight() {
    this.cell = 160;
    this.cols = Math.ceil(this.terrain.W / this.cell) + 1;
    this.rows = Math.ceil(this.terrain.H / this.cell) + 1;
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
    this.light.forEach((b, i) => {
      const c = clamp(Math.floor(b.x / this.cell), 0, this.cols - 1);
      const r = clamp(Math.floor(b.y / this.cell), 0, this.rows - 1);
      this.buckets[r * this.cols + c].push(i);
    });
  }

  // ---------------------------------------------------------------- Regeln
  /** Blockierende Bauwerke, die eine Strecke kreuzt (mit Seil-Abstand). */
  segmentHits(ax, ay, bx, by, pad = 2) {
    const hits = [];
    const minX = Math.min(ax, bx) - pad;
    const maxX = Math.max(ax, bx) + pad;
    const minY = Math.min(ay, by) - pad;
    const maxY = Math.max(ay, by) + pad;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (const b of this.blocking) {
      if (b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY) continue;
      let t = Infinity;
      const p = b.poly;
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        const hit = segIntersect(ax, ay, bx, by, p[i].x, p[i].y, q.x, q.y);
        if (hit >= 0) t = Math.min(t, hit);
      }
      if (t === Infinity) {
        // knapp vorbei? Ecken nahe am Seil zählen auch
        for (const c of p) {
          const q = pointSegDist(c.x, c.y, ax, ay, bx, by);
          if (q.d < pad) t = Math.min(t, q.t);
        }
      }
      if (t === Infinity && pointInPoly((ax + bx) / 2, (ay + by) / 2, p)) t = 0.5;
      if (t !== Infinity) hits.push({ b, t, at: t * len });
    }
    return hits.sort((p, q) => p.t - q.t);
  }

  /** Ergänzt einen Mastplan um Gebäuderegeln (siehe CityMap.computeMastPlan). */
  applyToPlan(plan, a, b) {
    const hits = this.segmentHits(a.x, a.y, b.x, b.y);
    for (const h of hits) {
      if (!h.b.tallOk) {
        plan.blocked = true;
        // Grund als Code, den die Oberfläche übersetzt: 'airport' | 'building' (blockedBy) | 'mastSpace'
        plan.reason = h.b.kind === 'approach' || h.b.kind === 'airport' ? 'airport' : 'building';
        plan.blockedBy = h.b;
        return;
      }
      plan.tall++;
      plan.tallTs.push(h.t);
    }
    // Masten dürfen nicht auf blockierenden Gebäuden stehen: ggf. entlang der Strecke verschieben
    const len = plan.length || 1;
    for (let i = 0; i < plan.ts.length; i++) {
      let t = plan.ts[i];
      const at = (tt) => ({ x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt });
      let p = at(t);
      if (!this.blockedNear(p.x, p.y, 4)) continue;
      let moved = false;
      for (let d = 6; d <= 60 && !moved; d += 6) {
        for (const sgn of [1, -1]) {
          const tt = t + (sgn * d) / len;
          if (tt <= 0.05 || tt >= 0.95) continue;
          p = at(tt);
          if (!this.blockedNear(p.x, p.y, 4)) {
            t = tt;
            moved = true;
            break;
          }
        }
      }
      if (!moved) {
        plan.blocked = true;
        plan.reason = 'mastSpace';
        return;
      }
      plan.ts[i] = t;
    }
  }

  buildingAt(x, y) {
    for (const b of this.blocking) {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (pointInPoly(x, y, b.poly)) return b;
    }
    return null;
  }

  // ---------------------------------------------------------------- Zeichnen
  draw(ctx, view, scale) {
    this.drawLight(ctx, view, scale);
    this.drawBlocking(ctx, view, scale);
  }

  drawLight(ctx, view) {
    const c0 = clamp(Math.floor(view.x0 / this.cell) - 1, 0, this.cols - 1);
    const c1 = clamp(Math.floor(view.x1 / this.cell) + 1, 0, this.cols - 1);
    const r0 = clamp(Math.floor(view.y0 / this.cell) - 1, 0, this.rows - 1);
    const r1 = clamp(Math.floor(view.y1 / this.cell) + 1, 0, this.rows - 1);
    const paths = { house: [], market: [], field: [] };
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const i of this.buckets[r * this.cols + c]) {
          const b = this.light[i];
          const m = Math.max(b.w, b.h);
          if (b.x + m < view.x0 || b.x - m > view.x1 || b.y + m < view.y0 || b.y - m > view.y1) continue;
          paths[b.kind].push(b);
        }
      }
    }
    this.fillRects(ctx, paths.field, 'rgba(118,138,92,0.12)');
    this.fillRects(ctx, paths.house, 'rgba(96,84,70,0.09)');
    this.fillRects(ctx, paths.market, 'rgba(96,84,70,0.17)');
  }

  fillRects(ctx, list, color) {
    if (!list.length) return;
    ctx.beginPath();
    for (const b of list) {
      const c = Math.cos(b.a);
      const s = Math.sin(b.a);
      const hw = b.w / 2;
      const hh = b.h / 2;
      ctx.moveTo(b.x - hw * c + hh * s, b.y - hw * s - hh * c);
      ctx.lineTo(b.x + hw * c + hh * s, b.y + hw * s - hh * c);
      ctx.lineTo(b.x + hw * c - hh * s, b.y + hw * s + hh * c);
      ctx.lineTo(b.x - hw * c - hh * s, b.y - hw * s + hh * c);
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
  }

  drawBlocking(ctx, view, scale) {
    const px = 1 / scale;
    const DARK = '#4A4753';
    for (const b of this.blocking) {
      if (b.maxX < view.x0 - 20 || b.minX > view.x1 + 20 || b.maxY < view.y0 - 20 || b.minY > view.y1 + 20) continue;
      const poly = b.poly;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (const p of poly) ctx.lineTo(p.x, p.y);
        ctx.closePath();
      };
      if (b.kind === 'approach') {
        path();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(74,71,83,0.16)';
        ctx.lineWidth = 2.5 * px;
        ctx.beginPath();
        const step = Math.max(10, 9 * px);
        for (let d = b.minX - (b.maxY - b.minY); d < b.maxX; d += step) {
          ctx.moveTo(d, b.minY);
          ctx.lineTo(d + (b.maxY - b.minY), b.maxY);
        }
        ctx.stroke();
        ctx.restore();
        path();
        ctx.setLineDash([6 * px, 5 * px]);
        ctx.strokeStyle = 'rgba(74,71,83,0.45)';
        ctx.lineWidth = 1.2 * px;
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      if (b.kind === 'airport') {
        path();
        ctx.fillStyle = 'rgba(74,71,83,0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(74,71,83,0.55)';
        ctx.lineWidth = 1.2 * px;
        ctx.stroke();
        // Piste
        const c = Math.cos(b.angle);
        const s = Math.sin(b.angle);
        ctx.save();
        ctx.translate(b.cx, b.cy);
        ctx.rotate(b.angle);
        ctx.fillStyle = DARK;
        ctx.fillRect(-b.len * 0.42, -4, b.len * 0.84, 8);
        ctx.fillRect(-b.len * 0.05, 14, b.len * 0.16, 12);
        ctx.restore();
        drawPlane(ctx, b.cx - s * 26, b.cy + c * 26 - 34, Math.max(9, 11 * px), b.angle);
        continue;
      }
      path();
      ctx.fillStyle = DARK;
      ctx.fill();
      const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
      if (size * scale < 7) continue; // Symbol nur, wenn groß genug
      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.strokeStyle = '#FFFFFF';
      ctx.fillStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(0.8, size * 0.09);
      if (b.kind === 'hospital') {
        const r = size * 0.32;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        const h = r * 0.55;
        ctx.beginPath();
        ctx.moveTo(-h * 0.6, -h);
        ctx.lineTo(-h * 0.6, h);
        ctx.moveTo(h * 0.6, -h);
        ctx.lineTo(h * 0.6, h);
        ctx.moveTo(-h * 0.6, 0);
        ctx.lineTo(h * 0.6, 0);
        ctx.stroke();
      } else if (b.kind === 'stadium') {
        ctx.fillStyle = '#7FA36B';
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.3, size * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.2);
        ctx.lineTo(0, size * 0.2);
        ctx.stroke();
      } else if (b.kind === 'barracks') {
        star(ctx, 0, 0, size * 0.22);
        ctx.fill();
      } else if (b.kind === 'highrise') {
        ctx.rotate(b.angle);
        const w = b.size * 0.14;
        ctx.fillRect(-b.size * 0.22 - w / 2, -b.size * 0.24, w, b.size * 0.48);
        ctx.fillRect(b.size * 0.22 - w / 2, -b.size * 0.24, w, b.size * 0.48);
      }
      ctx.restore();
    }
  }
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function drawPlane(ctx, x, y, s, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#4A4753';
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.7, -s * 0.12);
  ctx.lineTo(-s * 0.7, s * 0.12);
  ctx.closePath();
  ctx.moveTo(s * 0.1, 0);
  ctx.lineTo(-s * 0.3, -s * 0.75);
  ctx.lineTo(-s * 0.15, 0);
  ctx.lineTo(-s * 0.3, s * 0.75);
  ctx.closePath();
  ctx.moveTo(-s * 0.55, 0);
  ctx.lineTo(-s * 0.8, -s * 0.35);
  ctx.lineTo(-s * 0.8, s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
