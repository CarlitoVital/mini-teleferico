// Dezente, prozedural erzeugte Klänge über die Web Audio API.
import { storageGet, storageSet } from './util.js';

// Pentatonik: jede Linie hat ihren eigenen Ton
const PENTA = [392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

export class SoundBoard {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = storageGet('teleferico.muted', '0') === '1';
    this.last = {};
    this.alarmAcc = 0;
  }

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (Autoplay-Regeln). */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 4;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    storageSet('teleferico.muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03);
  }

  get ready() {
    return !!this.ctx && !this.muted && this.ctx.state === 'running';
  }

  throttle(key, ms) {
    const now = performance.now();
    if (now - (this.last[key] || 0) < ms) return false;
    this.last[key] = now;
    return true;
  }

  tone(freq, { type = 'sine', dur = 0.15, vol = 0.1, at = 0, attack = 0.006, slide = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.05, freq = 900, q = 0.8, at = 0, sweep = 1 } = {}) {
    if (!this.ready || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(freq * sweep, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ---------------------------------------------------------------- Ereignisse
  board(slot = 0) {
    if (!this.throttle('board', 80)) return;
    this.tone(PENTA[slot % PENTA.length], { dur: 0.09, vol: 0.035 });
  }

  deliver(slot = 0) {
    if (!this.throttle('deliver', 70)) return;
    const f = PENTA[slot % PENTA.length] * 2;
    this.tone(f, { type: 'triangle', dur: 0.22, vol: 0.06 });
    this.tone(f * 1.5, { dur: 0.14, vol: 0.02, at: 0.01 });
  }

  station() {
    this.tone(659.25, { type: 'triangle', dur: 0.28, vol: 0.08 });
    this.tone(987.77, { type: 'triangle', dur: 0.4, vol: 0.07, at: 0.1 });
  }

  rare() {
    [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.35, vol: 0.05, at: i * 0.07 }));
  }

  line() {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.3, vol: 0.06, at: i * 0.06 }));
  }

  snap(n = 1, back = false) {
    if (!this.throttle('snap', 30)) return;
    const f = back ? 520 : 700 + Math.min(n, 12) * 40;
    this.tone(f, { dur: 0.05, vol: 0.04 });
  }

  remove() {
    this.tone(440, { type: 'triangle', dur: 0.18, vol: 0.05, slide: 0.6 });
  }

  invalid() {
    if (!this.throttle('invalid', 250)) return;
    this.tone(150, { type: 'square', dur: 0.12, vol: 0.025 });
  }

  gondola() {
    this.noise({ dur: 0.35, vol: 0.05, freq: 600, sweep: 2.4 });
    this.tone(880, { dur: 0.12, vol: 0.03, at: 0.18 });
  }

  whoosh() {
    this.noise({ dur: 0.28, vol: 0.045, freq: 1400, sweep: 0.5 });
  }

  warn() {
    if (!this.throttle('warn', 1500)) return;
    this.tone(392, { type: 'triangle', dur: 0.25, vol: 0.09 });
    this.tone(311.13, { type: 'triangle', dur: 0.35, vol: 0.09, at: 0.2 });
  }

  week() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.45, vol: 0.06, at: i * 0.09 }));
  }

  gameOver() {
    [523.25, 466.16, 392, 311.13].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.6, vol: 0.08, at: i * 0.22 }));
  }

  click() {
    if (!this.throttle('click', 40)) return;
    this.tone(1200, { dur: 0.035, vol: 0.025 });
  }

  /** Leises, schneller werdendes Ticken, solange eine Station überfüllt ist. */
  alarm(level, dt) {
    if (level <= 0) {
      this.alarmAcc = 0;
      return;
    }
    this.alarmAcc += dt;
    const interval = 1.3 - 0.85 * level;
    if (this.alarmAcc >= interval) {
      this.alarmAcc = 0;
      this.tone(330 + 330 * level, { dur: 0.07, vol: 0.02 + 0.05 * level });
    }
  }
}
