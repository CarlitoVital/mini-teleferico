// Kamera und Zusammensetzen eines Frames auf dem Canvas.
import { CONFIG, INK } from './config.js';
import { TAU, clamp, rgba, roundRectPath } from './util.js';
import { nightness } from './game.js';
import { drawStation, drawWaiting, drawOvercrowd, tracePath } from './station.js';
import { drawLine, drawHandles, drawLineMasts, drawMast, strokeLineStyle, tracePolyline } from './line.js';
import { CABIN } from './gondola.js';
import { KIND_NAMES } from './buildings.js';

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
    this.manual = false; // true, sobald der Spieler selbst schwenkt/zoomt
    this.bounds = null; // Kartengrenzen {w, h}
    this.minScale = 0.05;
    this.maxScale = 4;
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

  /** Kartengrenzen setzen: Herauszoomen bis knapp zur ganzen Karte, Hineinzoomen bis 4×. */
  setBounds(w, h) {
    this.bounds = { w, h };
    this.minScale = Math.min(this.vp.w / w, this.vp.h / h) * 0.92;
    this.maxScale = 4;
  }

  fit(rect, immediate = false) {
    this.ts = this.fitScale(rect);
    this.tx = rect.x + rect.w / 2;
    this.ty = rect.y + rect.h / 2;
    if (immediate) this.snap();
  }

  /** Automatische Kamera: folgt dem Stadtbereich, solange nicht manuell gesteuert wird. */
  follow(rect) {
    if (!this.manual) this.fit(rect);
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

  clampCenter() {
    if (!this.bounds) return;
    this.x = clamp(this.x, 0, this.bounds.w);
    this.y = clamp(this.y, 0, this.bounds.h);
    this.tx = this.x;
    this.ty = this.y;
    this.ts = this.scale;
  }

  /** Verschieben um Bildschirm-Pixel. */
  panBy(dx, dy) {
    this.manual = true;
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
    this.clampCenter();
  }

  /** Zoomen um Faktor, wobei der Punkt unter (sx, sy) stehen bleibt. */
  zoomAt(sx, sy, factor) {
    this.manual = true;
    const w = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    this.x = w.x - (sx - this.cx) / this.scale;
    this.y = w.y - (sy - this.cy) / this.scale;
    this.clampCenter();
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

const TILE_PX = 512;
const MAX_TILES = 96;

/**
 * Kachel-Cache für die unveränderliche Kartenschicht (Gelände, Höhenlinien, Wasser, Gebäude).
 * Kacheln werden je Zoomstufe passend aufgelöst, schrittweise mit Zeitbudget gerendert und
 * pixelgenau aneinandergesetzt. Bis eine Kachel fertig ist, dient eine grobe Übersicht als Ersatz.
 */
class TileLayer {
  constructor() {
    this.map = null;
    this.tiles = new Map();
    this.overview = null;
  }

  reset(map) {
    this.map = map;
    this.tiles.clear();
    this.overview = null;
  }

  /** Auflösung in Gerätepixeln pro Welt-Einheit: Zweierpotenz, höchstens ~1,6-fach vergrößert. */
  levelFor(scale, dpr) {
    const need = scale * dpr * 1.25;
    let L = 0.25;
    while (L * 2 <= need && L < 4) L *= 2;
    return L;
  }

  ensureOverview() {
    if (this.overview) return this.overview;
    const L = 0.25;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(this.map.W * L);
    cv.height = Math.ceil(this.map.H * L);
    const c = cv.getContext('2d');
    c.setTransform(L, 0, 0, L, 0, 0);
    this.map.drawStatic(c, { x0: 0, y0: 0, x1: this.map.W, y1: this.map.H }, L);
    this.overview = cv;
    return cv;
  }

  renderTile(L, tx, ty) {
    const u = TILE_PX / L;
    const cv = document.createElement('canvas');
    cv.width = TILE_PX;
    cv.height = TILE_PX;
    const c = cv.getContext('2d');
    c.setTransform(L, 0, 0, L, -tx * u * L, -ty * u * L);
    this.map.drawStatic(c, { x0: tx * u, y0: ty * u, x1: (tx + 1) * u, y1: (ty + 1) * u }, L);
    return cv;
  }

  /**
   * Zeichnet die sichtbaren Kacheln im Gerätepixel-Raum. Liefert true, wenn alles in voller
   * Auflösung vorlag (sonst muss im nächsten Frame weitergezeichnet werden).
   */
  draw(ctx, cam, dpr, budgetMs) {
    const map = this.map;
    const s = cam.scale;
    const L = this.levelFor(s, dpr);
    const u = TILE_PX / L;
    const a = cam.toWorld(0, 0);
    const b = cam.toWorld(cam.vpFullW, cam.vpFullH);
    const tx0 = Math.max(0, Math.floor(a.x / u));
    const ty0 = Math.max(0, Math.floor(a.y / u));
    const tx1 = Math.min(Math.ceil(map.W / u) - 1, Math.floor(b.x / u));
    const ty1 = Math.min(Math.ceil(map.H / u) - 1, Math.floor(b.y / u));
    const dev = (wx, wy) => ({ x: Math.round(((wx - cam.x) * s + cam.cx) * dpr), y: Math.round(((wy - cam.y) * s + cam.cy) * dpr) });
    const start = performance.now();
    let complete = true;
    let rendered = 0;
    // Kacheln nahe der Bildmitte zuerst
    const order = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) order.push([tx, ty]);
    const mx = (tx0 + tx1) / 2;
    const my = (ty0 + ty1) / 2;
    order.sort((p, q) => Math.hypot(p[0] - mx, p[1] - my) - Math.hypot(q[0] - mx, q[1] - my));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const [tx, ty] of order) {
      const key = `${L}:${tx}:${ty}`;
      let tile = this.tiles.get(key);
      if (tile) {
        this.tiles.delete(key);
        this.tiles.set(key, tile);
      } else if (rendered === 0 || performance.now() - start < budgetMs) {
        tile = this.renderTile(L, tx, ty);
        rendered++;
        this.tiles.set(key, tile);
        if (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value);
      }
      const p0 = dev(tx * u, ty * u);
      const p1 = dev((tx + 1) * u, (ty + 1) * u);
      if (tile) {
        ctx.drawImage(tile, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      } else {
        complete = false;
        const ov = this.ensureOverview();
        const k = ov.width / map.W;
        const sw = Math.min(u, map.W - tx * u);
        const sh = Math.min(u, map.H - ty * u);
        ctx.drawImage(ov, tx * u * k, ty * u * k, sw * k, sh * k, p0.x, p0.y, ((p1.x - p0.x) * sw) / u, ((p1.y - p0.y) * sh) / u);
      }
    }
    return complete;
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
    this.tilesLayer = new TileLayer();
    this.resize();
  }

  resize() {
    this.cssW = Math.max(1, window.innerWidth);
    this.cssH = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.camera.vp = this.mapViewport();
    this.camera.vpFullW = this.cssW;
    this.camera.vpFullH = this.cssH;
  }

  /** Bereich, in den die Karte eingepasst wird (ohne HUD oben und Leiste unten). */
  mapViewport() {
    const compact = this.cssH < 560 || this.cssW < 560;
    const top = compact ? 56 : 72;
    const bottom = compact ? 78 : 96;
    const side = compact ? 12 : 24;
    return { x: side, y: top, w: Math.max(50, this.cssW - side * 2), h: Math.max(50, this.cssH - top - bottom) };
  }

  /**
   * Form und Größe des Startbereichs passend zum Bildschirm: gleiches Seitenverhältnis,
   * Startzoom 1.1–1.65 Pixel pro Welt-Einheit.
   */
  startGeometry() {
    const vp = this.mapViewport();
    const s0 = clamp(Math.min(vp.w, vp.h) / 380, 1.1, 1.65);
    return { aspect: clamp(vp.w / vp.h, 0.45, 2.4), area: (vp.w * vp.h) / (s0 * s0) };
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
    if (!view.demo) this.drawOffscreenHints(game, realTime);
    if (hoverSt && !drag) this.drawStationTip(game, hoverSt);
    else if (view.hoverBuilding && !drag) this.drawBuildingTip(view.hoverBuilding);
    if (game.state === 'over' && game.overStation) this.drawGameOverMarker(game, realTime);
    if (drag && drag.type === 'item') this.drawItemGhost(game, drag);
    if (drag && drag.floatReason && drag.screen) this.drawReason(drag.floatReason, drag.screen);
  }

  /** Kurzer Grund am Zeiger, warum ein Seilstück nicht gebaut werden kann. */
  drawReason(text, at) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `600 12px ${FONT}`;
    const w = ctx.measureText(text).width + 18;
    const h = 26;
    const x = clamp(at.x + 16, 6, this.cssW - w - 6);
    const y = clamp(at.y - h - 14, 6, this.cssH - h - 6);
    roundRectPath(ctx, x, y, w, h, 13);
    ctx.fillStyle = 'rgba(216,70,60,0.94)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 9, y + h / 2 + 0.5);
    ctx.restore();
  }

  /** Zeichnet Gelände, Gebäude, Wasser und Nacht-Tönung – nur wenn sich die Ansicht ändert. */
  drawBackground(game, view) {
    const cam = this.camera;
    const night = Math.round(nightness(game.hour) * 40) / 40;
    const region = game.viewRegion();
    const key = [
      cam.x.toFixed(2), cam.y.toFixed(2), cam.scale.toFixed(5), this.cssW, this.cssH, this.dpr,
      night, region.x.toFixed(1), region.y.toFixed(1), region.w.toFixed(1), view.demo ? 1 : 0,
    ].join('|');
    const layer = this.tilesLayer;
    if (layer.map !== game.map) {
      layer.reset(game.map);
      this.bgKey = '';
    }
    if (key !== this.bgKey) {
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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#EAE5DC';
      ctx.fillRect(0, 0, this.bg.width, this.bg.height);
      const complete = layer.draw(ctx, cam, this.dpr, 7);
      this.worldTransform();
      game.map.drawLabels(ctx, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }, s, view.demo ? 0.6 : 1);
      // Schleier außerhalb des aktiven Stadtbereichs
      ctx.beginPath();
      ctx.rect(a.x - 10, a.y - 10, b.x - a.x + 20, b.y - a.y + 20);
      ctx.rect(region.x, region.y, region.w, region.h);
      ctx.fillStyle = 'rgba(244,239,230,0.42)';
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(120,100,70,0.18)';
      ctx.lineWidth = 1 / s;
      ctx.setLineDash([6 / s, 6 / s]);
      ctx.strokeRect(region.x, region.y, region.w, region.h);
      ctx.setLineDash([]);
      if (night > 0) {
        this.screenTransform();
        ctx.fillStyle = `rgba(24,34,72,${0.12 * night})`;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
      }
      this.ctx = main;
      // unvollständig: im nächsten Frame weitere Kacheln nachladen
      this.bgKey = complete ? key : '';
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.bg, 0, 0);
  }

  /** Pfeile am Bildschirmrand zu neuen oder überfüllten Stationen außerhalb der Ansicht. */
  drawOffscreenHints(game, realTime) {
    const ctx = this.ctx;
    const vp = this.camera.vp;
    for (const st of game.stations) {
      const fresh = game.time - st.born < 6;
      if (!fresh && st.overcrowd <= 0) continue;
      const p = this.camera.toScreen(st.x, st.y);
      if (p.x >= vp.x && p.x <= vp.x + vp.w && p.y >= vp.y && p.y <= vp.y + vp.h) continue;
      const cx = vp.x + vp.w / 2;
      const cy = vp.y + vp.h / 2;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const k = Math.min((vp.w / 2 - 18) / Math.abs(dx || 1e-6), (vp.h / 2 - 18) / Math.abs(dy || 1e-6));
      const x = cx + dx * k;
      const y = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const danger = st.overcrowd > 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.globalAlpha = danger ? 0.75 + 0.25 * Math.sin(realTime * 8) : 0.85;
      ctx.fillStyle = danger ? '#D6403A' : INK;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, -7);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-ang);
      tracePath(ctx, st.shape, -Math.cos(ang) * 16, -Math.sin(ang) * 16, 5);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = danger ? '#D6403A' : INK;
      ctx.stroke();
      ctx.restore();
    }
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

  drawBuildingTip(b) {
    const p = this.camera.toScreen(b.cx, b.minY);
    const name = b.kind === 'highrise' || b.kind === 'approach' ? KIND_NAMES[b.kind] : b.name;
    const sub = b.tallOk ? 'Blockiert Seile – mit hohem Mast überspannbar' : 'Sperrzone – hier führt kein Seil hinüber';
    this.drawTip(p.x, p.y - 10, name, sub);
  }

  drawTip(x, y, title, sub) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 12px ${FONT}`;
    const w1 = ctx.measureText(title).width;
    ctx.font = `500 11px ${FONT}`;
    const w2 = ctx.measureText(sub).width;
    const w = Math.max(w1, w2) + 20;
    const h = 40;
    const tx = clamp(x - w / 2, 6, this.cssW - w - 6);
    let ty = y - h;
    if (ty < 60) ty = y + 30;
    roundRectPath(ctx, tx, ty, w, h, 8);
    ctx.fillStyle = 'rgba(255,253,249,0.96)';
    ctx.shadowColor = 'rgba(40,30,20,0.18)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = INK;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText(title, tx + 10, ty + 17);
    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = '#7C7468';
    ctx.fillText(sub, tx + 10, ty + 32);
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

