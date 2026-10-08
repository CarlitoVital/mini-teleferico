// Gondeln: pendeln am Seil, schaukeln, lassen Fahrgäste ein-, aus- und umsteigen.
import { CONFIG, INK } from './config.js';
import { TAU, clamp, shade, roundRectPath, rgba } from './util.js';
import { offsetSegment } from './line.js';
import { tracePath } from './station.js';

let nextGondolaId = 1;

export const CABIN = { hang: 7, h: 12, w: 15, wBig: 22 };

export class Gondola {
  constructor(line, station) {
    this.id = nextGondolaId++;
    this.line = line;
    this.riders = [];
    this.big = false;
    this.retiring = false;
    this.fade = 0;
    this.sway = 0;
    this.swayV = 0;
    this.prevVx = 0;
    this.x = station.x;
    this.y = station.y;
    this.snap = true;
    this.placeAt(station);
  }

  get capacity() {
    return this.big ? CONFIG.bigCabinCapacity : CONFIG.gondolaCapacity;
  }

  placeAt(st) {
    this.state = 'dwell';
    this.at = st;
    this.from = st;
    this.to = null;
    this.dist = 0;
    this.len = 0;
    this.v = 0;
    this.vmax = CONFIG.gondolaSpeed;
    this.dwell = 0;
    this.actionTimer = 0.2;
    const i = this.line.indexOf(st);
    this.dir = i >= this.line.stations.length - 1 ? -1 : 1;
    this.snap = true;
  }

  /** Nächster Halt in Fahrtrichtung (an Endstationen wird gewendet). */
  nextStop() {
    const list = this.line.stations;
    const i = list.indexOf(this.at);
    if (i < 0 || list.length < 2) return null;
    let d = this.dir;
    if (i + d < 0 || i + d >= list.length) d = -d;
    return list[i + d];
  }

  update(dt, game) {
    if (this.state === 'dwell') this.updateDwell(dt, game);
    else if (this.state === 'move') this.updateMove(dt, game);
    else if (this.state === 'fadeout') {
      this.fade -= dt * 2.5;
      if (this.fade <= 0) {
        this.fade = 0;
        this.finishFade(game);
        return;
      }
    }
    if (this.state !== 'fadeout' && this.fade < 1) this.fade = Math.min(1, this.fade + dt * 2.5);
    this.updateSway(dt, game);
  }

  updateDwell(dt, game) {
    const st = this.at;
    const line = this.line;
    const serving = line.active && !this.retiring && line.has(st);
    this.dwell += dt;
    this.actionTimer -= dt;
    while (this.actionTimer <= 0) {
      const acted = serving ? this.serveStep(st, game) : this.evacuateStep(st, game);
      if (!acted) {
        this.actionTimer = 0;
        break;
      }
      this.actionTimer += st.interchange ? CONFIG.boardTimeInterchange : CONFIG.boardTime;
    }
    if (this.actionTimer > 0 || this.dwell < CONFIG.minDwell) return;
    if (serving) this.depart(game);
    else if (!this.riders.length) this.state = 'fadeout';
  }

  serveStep(st, game) {
    const next = this.nextStop();
    const riders = this.riders;
    for (let i = 0; i < riders.length; i++) {
      if (riders[i].shape === st.shape) {
        game.deliver(riders.splice(i, 1)[0], st, this);
        return true;
      }
    }
    for (let i = 0; i < riders.length; i++) {
      if (!game.router.shouldStay(riders[i], st, this.line, next)) {
        game.transfer(riders.splice(i, 1)[0], st, this);
        return true;
      }
    }
    if (next && riders.length < this.capacity) {
      const w = st.waiting;
      for (let i = 0; i < w.length; i++) {
        if (game.router.shouldBoard(w[i], st, this.line, next)) {
          const p = w.splice(i, 1)[0];
          riders.push(p);
          game.boarded(p, st, this);
          return true;
        }
      }
    }
    return false;
  }

  /** Linie gelöscht oder Station abgehängt: alle steigen aus. */
  evacuateStep(st, game) {
    if (!this.riders.length) return false;
    const p = this.riders.shift();
    if (p.shape === st.shape) game.deliver(p, st, this);
    else game.transfer(p, st, this);
    return true;
  }

  depart(game) {
    const next = this.nextStop();
    if (!next) return;
    const list = this.line.stations;
    this.dir = list.indexOf(next) > list.indexOf(this.at) ? 1 : -1;
    this.from = this.at;
    this.to = next;
    this.at = null;
    this.dist = 0;
    this.len = Math.hypot(next.x - this.from.x, next.y - this.from.y);
    this.v = 0;
    this.vmax = CONFIG.gondolaSpeed * game.altitudeFactor(this.from, next);
    this.state = 'move';
  }

  updateMove(dt, game) {
    const a = CONFIG.gondolaAccel;
    const remain = this.len - this.dist;
    if (remain <= (this.v * this.v) / (2 * a) + 0.5) this.v = Math.max(10, this.v - a * dt);
    else this.v = Math.min(this.vmax, this.v + a * dt);
    this.dist += this.v * dt;
    if (this.dist >= this.len) {
      this.dist = this.len;
      const st = this.to;
      this.state = 'dwell';
      this.at = st;
      this.from = st;
      this.to = null;
      this.v = 0;
      this.dwell = 0;
      this.actionTimer = 0.12;
      game.arrived(this, st);
    }
  }

  finishFade(game) {
    if (this.retiring || !this.line.active) {
      game.removeGondolaNow(this);
      return;
    }
    // Station wurde von der Linie entfernt: an der nächstgelegenen Linienstation neu einsetzen
    const ref = this.at || this.from;
    let best = this.line.stations[0];
    let bd = Infinity;
    for (const s of this.line.stations) {
      const d = Math.hypot(s.x - ref.x, s.y - ref.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    this.placeAt(best);
    this.fade = 0;
  }

  /** Aufhängepunkt am Seil (inkl. Versatz paralleler Linien). */
  attachPoint(game) {
    if (this.state === 'move' || (this.state === 'fadeout' && this.to)) {
      const s = offsetSegment(this.from, this.to, game.segOffset(this.line, this.from, this.to));
      const t = this.len > 0 ? this.dist / this.len : 0;
      return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t };
    }
    const st = this.at || this.from;
    if (this.line.active && this.line.has(st)) {
      const next = this.nextStop();
      if (next) {
        const s = offsetSegment(st, next, game.segOffset(this.line, st, next));
        return { x: s.ax, y: s.ay };
      }
    }
    return { x: st.x, y: st.y };
  }

  /** Pendelbewegung: gedämpfter Oszillator, angeregt durch Beschleunigung und Wind. */
  updateSway(dt, game) {
    const p = this.attachPoint(game);
    if (this.snap || dt <= 0) {
      this.x = p.x;
      this.y = p.y;
      this.prevVx = 0;
      this.snap = false;
      return;
    }
    const vx = (p.x - this.x) / dt;
    const ax = clamp((vx - this.prevVx) / dt, -320, 320);
    this.prevVx = vx;
    this.x = p.x;
    this.y = p.y;
    const w = 3.3;
    const zeta = 0.11;
    const wind = 0.035 * Math.sin(game.time * 1.25 + this.id * 1.9) + 0.015 * Math.sin(game.time * 3.1 + this.id);
    const acc = -w * w * (this.sway - wind) - 2 * zeta * w * this.swayV - ax / 75;
    this.swayV += acc * dt;
    this.sway = clamp(this.sway + this.swayV * dt, -0.6, 0.6);
  }

  /** Mittelpunkt der Kabine (für Treffertests). */
  cabinCenter() {
    const off = CABIN.hang + 1.2 + CABIN.h / 2;
    return { x: this.x - Math.sin(this.sway) * off, y: this.y + Math.cos(this.sway) * off };
  }

  isStale() {
    return this.state === 'move' && (!this.line.active || !this.line.hasSegment(this.from, this.to));
  }

  draw(ctx, opts = {}) {
    const color = this.line.color;
    const alpha = this.fade * (opts.alpha ?? 1);
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (this.isStale()) {
      // Seilabschnitt existiert nicht mehr: Kabine fährt auf einem „Geisterseil“ zu Ende
      ctx.save();
      ctx.globalAlpha = alpha * 0.45;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = color.casing || color.hex;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(this.from.x, this.from.y);
      ctx.lineTo(this.to.x, this.to.y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.translate(this.x, this.y);
    ctx.rotate(this.sway);
    const { hang, h } = CABIN;
    const w = this.big ? CABIN.wBig : CABIN.w;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, hang + 1);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(0, 0, 2.4, 0, TAU);
    ctx.fill();
    roundRectPath(ctx, -w * 0.3, hang - 1.2, w * 0.6, 2.8, 1.2);
    ctx.fill();
    if (opts.highlight) {
      roundRectPath(ctx, -w / 2 - 3, hang - 1.8, w + 6, h + 6, 5);
      ctx.fillStyle = rgba('#2A2A2E', 0.14);
      ctx.fill();
    }
    roundRectPath(ctx, -w / 2, hang + 1.2, w, h, 3.2);
    ctx.fillStyle = color.hex;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = color.casing || shade(color.hex, -0.28);
    ctx.stroke();
    // Fahrgäste als Formen im Fenster
    const cols = this.big ? 5 : 3;
    const sx = (w - 3) / cols;
    ctx.fillStyle = color.light ? INK : '#FFFFFF';
    for (let i = 0; i < this.riders.length; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      tracePath(ctx, this.riders[i].shape, -w / 2 + 1.5 + sx * (c + 0.5), hang + 1.2 + 3.4 + r * 5.3, 1.9);
      ctx.fill();
    }
    ctx.restore();
  }
}
