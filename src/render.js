// Kamera und Zusammensetzen eines Frames auf dem Canvas.
import { CONFIG, INK } from './config.js';
import { TAU, clamp, rgba, roundRectPath } from './util.js';
import { drawIllimani } from './map.js';
import { nightness } from './game.js';
import { drawStation, drawWaiting, drawOvercrowd, tracePath } from './station.js';
import { drawLine, drawHandles, drawLineMasts, drawMast, strokeLineStyle, tracePolyline } from './line.js';
import { CABIN } from './gondola.js';

const FONT = '"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.ts = 1;
    this.vp = { x: 0, y: 0, w: 1, h: 1 };
  }

  get cx() {
    return this.vp.x + this.vp.w / 2;
  }

  get cy() {
    return this.vp.y + this.vp.h / 2;
  }

  fitScale(rect) {
    return Math.min(this.vp.w / rect.w, this.vp.h / rect.h);
  }

  fit(rect, immediate = false) {
    this.ts = this.fitScale(rect);
    this.tx = rect.x + rect.w / 2;
    this.ty = rect.y + rect.h / 2;
    if (immediate) this.snap();
  }

  focus(x, y, s) {
    this.tx = x;
    this.ty = y;
    this.ts = s;
  }

  snap() {
    this.x = this.tx;
    this.y = this.ty;
    this.scale = this.ts;
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 2.6);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.scale = Math.exp(Math.log(this.scale) + (Math.log(this.ts) - Math.log(this.scale)) * k);
    if (Math.abs(this.tx - this.x) < 0.05 && Math.abs(this.ty - this.y) < 0.05 && Math.abs(this.ts / this.scale - 1) < 2e-4) {
      this.snap();
    }
  }

  toWorld(sx, sy) {
    return { x: (sx - this.cx) / this.scale + this.x, y: (sy - this.cy) / this.scale + this.y };
  }

  toScreen(wx, wy) {
    return { x: (wx - this.x) * this.scale + this.cx, y: (wy - this.y) * this.scale + this.cy };
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = new Camera();
    this.cssW = 1;
    this.cssH = 1;
    this.dpr = 1;
    // Statischer Hintergrund (Gelände, Schluchten, Illimani) wird zwischengespeichert
    this.bg = document.createElement('canvas');
    this.bgCtx = this.bg.getContext('2d');
    this.bgKey = '';
    this.bgMap = null;
    this.resize();
  }

  resize() {
    this.cssW = Math.max(1, window.innerWidth);
    this.cssH = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.camera.vp = this.mapViewport();
  }

  /** Bereich, in den die Karte eingepasst wird (ohne HUD oben und Leiste unten). */
  mapViewport() {
    const compact = this.cssH < 560 || this.cssW < 560;
    const top = compact ? 56 : 72;
    const bottom = compact ? 78 : 96;
    const side = compact ? 12 : 24;
    return { x: side, y: top, w: Math.max(50, this.cssW - side * 2), h: Math.max(50, this.cssH - top - bottom) };
  }

  /** Weltgröße passend zum Bildschirm: Seitenverhältnis wie der Viewport, Endzoom 0.7–1.0. */
  worldSize() {
    const vp = this.mapViewport();
    const sFinal = clamp(Math.min(vp.w, vp.h) / 760, 0.7, 1.0);
    const aspect = clamp(vp.w / vp.h, 0.55, 2.2);
    let w = vp.w / sFinal;
    let h = vp.h / sFinal;
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
    return { w: Math.round(w), h: Math.round(h) };
  }

  worldTransform() {
    const { ctx, camera: c, dpr } = this;
    const s = c.scale;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (c.cx - c.x * s), dpr * (c.cy - c.y * s));
  }

  screenTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  render(game, view, realTime) {
    const { ctx } = this;
    this.screenTransform();
    if (!game) {
      ctx.fillStyle = '#F4EFE6';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      return;
    }
    const time = game.time;
    this.drawBackground(game, view);
    this.worldTransform();

    // --- Netz
    const drag = view.drag;
    const editLine = drag && (drag.type === 'draw' || drag.type === 'segment') ? drag.line : null;
    const sel = view.selectedLine && game.lines.includes(view.selectedLine) ? view.selectedLine : null;
    const lineAlpha = (l) => (l === editLine ? 0.28 : sel && sel !== l ? 0.3 : 1);

    for (const l of game.lines) if (l.active) drawLineMasts(ctx, game, l, lineAlpha(l));
    const ordered = game.lines.slice().sort((p, q) => (p.active === q.active ? p.slot - q.slot : p.active ? 1 : -1));
    for (const l of ordered) drawLine(ctx, game, l, { alpha: l.active ? lineAlpha(l) : 0.4, glow: l === sel });
    for (const l of ordered) drawHandles(ctx, game, l, lineAlpha(l));

    if (drag) this.drawDragPreview(game, drag);

    for (const st of game.stations) drawOvercrowd(ctx, st, realTime);
    const dragGondola = drag && drag.type === 'item' && drag.source;
    for (const g of game.gondolas) {
      if (g === dragGondola && drag.lifted) continue;
      const hl = drag && drag.type === 'item' && drag.kind === 'cabin' && drag.target && drag.target.gondola === g;
      g.draw(ctx, { alpha: sel && sel !== g.line ? 0.35 : 1, highlight: hl });
    }
    const hoverSt = view.hoverStation;
    for (const st of game.stations) {
      const hl =
        st === hoverSt ||
        (drag && drag.type === 'item' && drag.kind === 'interchange' && drag.target && drag.target.station === st) ||
        (drag && drag.hoverStation === st);
      drawStation(ctx, st, time, { highlight: hl, invalid: drag && drag.invalidStation === st });
    }
    for (const st of game.stations) drawWaiting(ctx, st);
    this.drawEffects(game);

    // --- Bildschirm-Overlays
    this.screenTransform();
    this.drawNewStationLabels(game);
    if (hoverSt && !drag) this.drawStationTip(game, hoverSt);
    if (game.state === 'over' && game.overStation) this.drawGameOverMarker(game, realTime);
    if (drag && drag.type === 'item') this.drawItemGhost(game, drag);
  }

  /** Zeichnet Gelände, Kulisse, Schluchten und Nacht-Tönung – nur wenn sich die Ansicht ändert. */
  drawBackground(game, view) {
    const cam = this.camera;
    const night = Math.round(nightness(game.hour) * 40) / 40;
    const region = game.viewRegion();
    const key = [
      cam.x.toFixed(2), cam.y.toFixed(2), cam.scale.toFixed(5), this.cssW, this.cssH, this.dpr,
      night, region.f.toFixed(3), view.demo ? 1 : 0,
    ].join('|');
    if (key !== this.bgKey || this.bgMap !== game.map) {
      if (this.bg.width !== this.canvas.width || this.bg.height !== this.canvas.height) {
        this.bg.width = this.canvas.width;
        this.bg.height = this.canvas.height;
      }
      const main = this.ctx;
      this.ctx = this.bgCtx;
      const ctx = this.ctx;
      const s = cam.scale;
      const a = cam.toWorld(0, 0);
      const b = cam.toWorld(this.cssW, this.cssH);
      this.worldTransform();
      game.map.drawTerrain(ctx, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }, 1 / s);
      this.screenTransform();
      this.drawBackdrop(game, night);
      this.worldTransform();
      game.map.drawRivers(ctx, 1 / s);
      game.map.drawLabels(ctx, region, s, view.demo ? 0.6 : 1);
      if (night > 0) {
        this.screenTransform();
        ctx.fillStyle = `rgba(24,34,72,${0.12 * night})`;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
      }
      this.ctx = main;
      this.bgKey = key;
      this.bgMap = game.map;
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.bg, 0, 0);
  }

  drawBackdrop(game, night) {
    const vp = this.camera.vp;
    const w = clamp(this.cssW * 0.4, 220, 560);
    const h = w * 0.3;
    const par = (this.camera.x - game.map.W / 2) * this.camera.scale * 0.04;
    const x = this.cssW - w * 0.98 - par;
    const y = vp.y + vp.h - h + 6;
    drawIllimani(this.ctx, x, y, w, h, night, 0.72);
    if (this.cssW < 700) return;
    this.ctx.save();
    this.ctx.font = `600 ${10}px ${FONT}`;
    if ('letterSpacing' in this.ctx) this.ctx.letterSpacing = '1.5px';
    this.ctx.fillStyle = 'rgba(120,128,145,0.55)';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('ILLIMANI · 6438 m', x + w * 0.66, y + h * 0.04);
    this.ctx.restore();
  }

  drawEffects(game) {
    const ctx = this.ctx;
    for (const e of game.effects) {
      const t = (game.time - e.t0) / e.dur;
      if (t < 0 || t > 1) continue;
      if (e.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, CONFIG.stationRadius * (1.4 + 3.2 * t), 0, TAU);
        ctx.strokeStyle = rgba(INK, 0.35 * (1 - t));
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  drawDragPreview(game, drag) {
    const ctx = this.ctx;
    const color = drag.color;
    if (drag.type === 'draw' && drag.mode !== 'blocked') {
      const list = drag.list;
      if (list.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(list[0].x, list[0].y);
        for (let i = 1; i < list.length; i++) ctx.lineTo(list[i].x, list[i].y);
        strokeLineStyle(ctx, color, CONFIG.lineWidth, 0.95);
        for (let i = 0; i < list.length - 1; i++) this.drawPlanMasts(game, list[i], list[i + 1], false, 0.95);
      }
      const last = list[list.length - 1];
      if (last && drag.pointer && !drag.overLast) {
        const p = drag.pointer;
        const bad = !!drag.floatInvalid;
        ctx.save();
        ctx.setLineDash([9, 8]);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        strokeLineStyle(ctx, bad ? { hex: '#D8463C' } : color, CONFIG.lineWidth * 0.8, 0.7);
        ctx.restore();
        this.drawPlanMasts(game, last, p, bad, 0.6);
      }
    } else if (drag.type === 'segment') {
      const { a, b, chain, pointer, line, index } = drag;
      const pts = drag.bypass ? drag.previewList : [a, ...chain];
      if (!drag.bypass) {
        // unveränderte Teile der Linie kräftig zeigen
        for (const part of [line.stations.slice(0, index + 1), line.stations.slice(index + 1)]) {
          if (part.length < 2) continue;
          tracePolyline(ctx, game, line, part);
          strokeLineStyle(ctx, color, CONFIG.lineWidth, 0.95);
        }
      }
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (!drag.bypass && pointer) {
        ctx.lineTo(pointer.x, pointer.y);
        ctx.lineTo(b.x, b.y);
      }
      if (!drag.bypass) ctx.setLineDash([9, 8]);
      strokeLineStyle(ctx, drag.floatInvalid ? { hex: '#D8463C' } : color, CONFIG.lineWidth, 0.9);
      ctx.restore();
      for (let i = 0; i < pts.length - 1; i++) this.drawPlanMasts(game, pts[i], pts[i + 1], false, 0.9);
    }
  }

  drawPlanMasts(game, a, b, invalid, alpha) {
    const plan = game.map.mastPlan(a, b);
    for (const t of plan.ts) drawMast(this.ctx, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, { invalid, alpha });
  }

  drawNewStationLabels(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    for (const st of game.stations) {
      const age = game.time - st.born;
      if (age > 4 || game.time < 0.5) continue;
      const a = age < 0.4 ? age / 0.4 : age > 3 ? 1 - (age - 3) : 1;
      const p = this.camera.toScreen(st.x, st.y);
      ctx.globalAlpha = clamp(a, 0, 1) * 0.85;
      ctx.fillStyle = INK;
      ctx.fillText(st.name, p.x, p.y - st.radius * this.camera.scale - 12);
    }
    ctx.restore();
  }

  drawStationTip(game, st) {
    const ctx = this.ctx;
    const p = this.camera.toScreen(st.x, st.y);
    const title = st.name;
    const sub = `${st.elev} m · ${st.waiting.length}/${st.capacity} wartend${st.interchange ? ' · Umsteigestation' : ''}`;
    ctx.save();
    ctx.font = `700 12px ${FONT}`;
    const w1 = ctx.measureText(title).width;
    ctx.font = `500 11px ${FONT}`;
    const w2 = ctx.measureText(sub).width;
    const w = Math.max(w1, w2) + 20;
    const h = 40;
    let x = p.x - w / 2;
    let y = p.y - st.radius * this.camera.scale - h - 12;
    x = clamp(x, 6, this.cssW - w - 6);
    if (y < 60) y = p.y + st.radius * this.camera.scale + 18;
    roundRectPath(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(255,253,249,0.96)';
    ctx.shadowColor = 'rgba(40,30,20,0.18)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = INK;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText(title, x + 10, y + 17);
    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = '#7C7468';
    ctx.fillText(sub, x + 10, y + 32);
    ctx.restore();
  }

  drawGameOverMarker(game, realTime) {
    const ctx = this.ctx;
    const st = game.overStation;
    const p = this.camera.toScreen(st.x, st.y);
    const r = st.radius * this.camera.scale * (3 + 0.25 * Math.sin(realTime * 5));
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.strokeStyle = 'rgba(214,64,52,0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  drawItemGhost(game, drag) {
    if (!drag.screen || !drag.lifted) return;
    const ctx = this.ctx;
    const { x, y } = drag.screen;
    const s = clamp(this.camera.scale * 1.6, 1.2, 2.2);
    ctx.save();
    ctx.translate(x, y - 18);
    ctx.scale(s, s);
    ctx.globalAlpha = drag.target ? 1 : 0.75;
    if (drag.kind === 'interchange') {
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = INK;
      ctx.fillStyle = '#fff';
      tracePath(ctx, 'circle', 0, 0, 12);
      ctx.fill();
      ctx.stroke();
      tracePath(ctx, 'circle', 0, 0, 7);
      ctx.stroke();
    } else {
      const big = drag.kind === 'cabin' || (drag.source && drag.source.big);
      const color = drag.target && drag.target.line ? drag.target.line.color : drag.source ? drag.source.line.color : { hex: '#9AA0A8' };
      const w = big ? CABIN.wBig : CABIN.w;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 0);
      ctx.stroke();
      roundRectPath(ctx, -w / 2, 0, w, CABIN.h, 3);
      ctx.fillStyle = color.hex;
      ctx.fill();
      ctx.strokeStyle = color.casing || INK;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (drag.kind === 'cabin') {
        ctx.fillStyle = color.light ? INK : '#fff';
        ctx.font = `800 10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('+', 0, 9.5);
      }
    }
    ctx.restore();
  }
}

