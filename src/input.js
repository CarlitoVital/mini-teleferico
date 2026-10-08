// Maus- und Touch-Steuerung: Linien zeichnen, verlängern, umleiten, Objekte ziehen.
import { CONFIG, LINE_COLORS } from './config.js';
import { pointSegDist } from './util.js';
import { handleGeometry, offsetSegment } from './line.js';
import { CABIN } from './gondola.js';

const sameList = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);

export class Input {
  constructor({ canvas, renderer, view, getGame, ui, audio }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.view = view;
    this.getGame = getGame;
    this.ui = ui;
    this.audio = audio;
    this.pointerId = null;
    this.downAt = null;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', () => this.cancel());
    canvas.addEventListener('pointerleave', () => {
      if (!this.view.drag && !this.view.tipUntil) this.view.hoverStation = null;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get game() {
    return this.getGame();
  }

  get enabled() {
    const g = this.game;
    return !!g && !g.demo && g.state !== 'over' && !this.ui.modalOpen;
  }

  get cam() {
    return this.renderer.camera;
  }

  world(e) {
    return this.cam.toWorld(e.clientX, e.clientY);
  }

  /** Toleranz in Welt-Einheiten; bei Touch großzügiger. */
  tol(e, px) {
    const coarse = e.pointerType === 'touch' || e.pointerType === 'pen';
    return (coarse ? px * 1.7 : px) / this.cam.scale;
  }

  // ------------------------------------------------------------ Treffertests
  hitStation(w, tol) {
    let best = null;
    let bd = Infinity;
    for (const s of this.game.stations) {
      const d = Math.hypot(s.x - w.x, s.y - w.y) - s.radius;
      if (d < tol && d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  hitHandle(w, tol) {
    let best = null;
    let bd = Infinity;
    for (const l of this.game.lines) {
      if (!l.active) continue;
      for (const atEnd of [false, true]) {
        const h = handleGeometry(this.game, l, atEnd);
        if (!h) continue;
        const q = pointSegDist(w.x, w.y, h.x0 + h.ux * 12, h.y0 + h.uy * 12, h.x1, h.y1);
        if (q.d < tol + 3 && q.d < bd) {
          bd = q.d;
          best = { line: l, atEnd };
        }
      }
    }
    return best;
  }

  hitGondola(w, tol) {
    let best = null;
    let bd = Infinity;
    for (const g of this.game.gondolas) {
      if (g.state === 'fadeout' || g.fade < 0.5) continue;
      const c = g.cabinCenter();
      const d = Math.hypot(c.x - w.x, c.y - w.y) - (g.big ? CABIN.wBig : CABIN.w) / 2;
      if (d < tol && d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  hitSegment(w, tol) {
    const g = this.game;
    let best = null;
    let bd = Infinity;
    for (const l of g.lines) {
      if (!l.active) continue;
      for (let i = 0; i < l.stations.length - 1; i++) {
        const a = l.stations[i];
        const b = l.stations[i + 1];
        const s = offsetSegment(a, b, g.segOffset(l, a, b));
        const q = pointSegDist(w.x, w.y, s.ax, s.ay, s.bx, s.by);
        const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
        const keep = CONFIG.stationRadius + 5;
        if (q.t * len < keep || (1 - q.t) * len < keep) continue;
        const d = q.d - CONFIG.lineWidth / 2;
        if (d < tol && d < bd) {
          bd = d;
          best = { line: l, index: i };
        }
      }
    }
    return best;
  }

  lineAt(w, tol) {
    const seg = this.hitSegment(w, tol);
    if (seg) return seg.line;
    const st = this.hitStation(w, tol);
    if (!st) return null;
    const lines = this.game.lines.filter((l) => l.active && l.has(st));
    if (!lines.length) return null;
    return lines.includes(this.view.selectedLine) ? this.view.selectedLine : lines[0];
  }

  // ------------------------------------------------------------ Pointer
  onDown(e) {
    if (!this.enabled || this.view.drag || e.button > 0) return;
    e.preventDefault();
    const w = this.world(e);
    this.capture(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    this.view.tipUntil = 0;

    const h = this.hitHandle(w, this.tol(e, 11));
    if (h) return this.startDraw(h.line, h.atEnd, w);
    // Haltende Gondeln hängen direkt unter der Station: exakte Treffer zuerst
    const exact = this.hitStation(w, 2 / this.cam.scale);
    if (exact) return this.startNewLine(exact, w);
    const gd = this.hitGondola(w, this.tol(e, 5));
    if (gd) return this.startItem('gondola', gd, e);
    const st = this.hitStation(w, this.tol(e, 8));
    if (st) return this.startNewLine(st, w);
    const h2 = this.hitHandle(w, this.tol(e, 22));
    if (h2) return this.startDraw(h2.line, h2.atEnd, w);
    const seg = this.hitSegment(w, this.tol(e, 9));
    if (seg) return this.startSegment(seg, w);
    this.view.selectedLine = null;
    this.view.hoverStation = null;
    this.pointerId = null;
  }

  onMove(e) {
    const drag = this.view.drag;
    if (!drag) {
      if (e.pointerType === 'mouse' && this.enabled && e.target === this.canvas) this.updateHover(this.world(e), e);
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    const w = this.world(e);
    drag.pointer = w;
    drag.screen = { x: e.clientX, y: e.clientY };
    if (!drag.moved && this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 7) {
      drag.moved = true;
    }
    if (drag.type === 'draw') this.moveDraw(drag, w, e);
    else if (drag.type === 'segment') this.moveSegment(drag, w, e);
    else if (drag.type === 'item') this.moveItem(drag, w, e);
  }

  onUp(e) {
    const drag = this.view.drag;
    if (!drag || e.pointerId !== this.pointerId) return;
    this.view.drag = null;
    this.pointerId = null;
    this.canvas.style.cursor = '';
    const game = this.game;
    if (!game || game.state === 'over') return;
    if (drag.type === 'draw') this.endDraw(drag);
    else if (drag.type === 'segment') this.endSegment(drag);
    else if (drag.type === 'item') this.endItem(drag, this.world(e));
  }

  /** Zeiger festhalten, damit Ziehen auch über den Fensterrand hinaus sauber endet. */
  capture(e) {
    this.pointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // z. B. bereits beendeter Zeiger – dann eben ohne Capture
    }
  }

  cancel() {
    const drag = this.view.drag;
    this.view.drag = null;
    this.pointerId = null;
    this.canvas.style.cursor = '';
    // Bereits abgehobene Gondel bleibt im Depot – nichts zu tun.
    return drag;
  }

  updateHover(w, e) {
    const st = this.hitStation(w, this.tol(e, 6));
    this.view.hoverStation = st;
    const over =
      st ||
      this.hitHandle(w, this.tol(e, 11)) ||
      this.hitGondola(w, this.tol(e, 6)) ||
      this.hitSegment(w, this.tol(e, 8));
    this.canvas.style.cursor = over ? 'pointer' : '';
  }

  showTip(st) {
    this.view.hoverStation = st;
    this.view.tipUntil = performance.now() + 2600;
  }

  // ------------------------------------------------------------ Linien zeichnen
  startNewLine(st, w) {
    const g = this.game;
    const slots = g.freeSlots();
    if (!slots.length) {
      // Keine Linie frei: Endet hier eine Linie, wird stattdessen sie verlängert.
      for (const l of g.lines) {
        if (!l.active) continue;
        if (l.stations[l.stations.length - 1] === st) return this.startDraw(l, true, w);
        if (l.stations[0] === st) return this.startDraw(l, false, w);
      }
      this.view.drag = {
        type: 'draw',
        mode: 'blocked',
        list: [st],
        color: LINE_COLORS[0],
        moved: false,
        pointer: w,
      };
      return;
    }
    const slot = slots.includes(this.view.preferredSlot) ? this.view.preferredSlot : slots[0];
    this.view.drag = {
      type: 'draw',
      mode: 'new',
      line: null,
      slot,
      color: LINE_COLORS[slot],
      list: [st],
      pointer: w,
      moved: false,
      overLast: true,
    };
  }

  startDraw(line, atEnd, w) {
    this.view.selectedLine = null;
    this.view.drag = {
      type: 'draw',
      mode: 'extend',
      line,
      atEnd,
      color: line.color,
      list: atEnd ? line.stations.slice() : line.stations.slice().reverse(),
      pointer: w,
      moved: false,
      overLast: false,
    };
    this.canvas.style.cursor = 'grabbing';
  }

  moveDraw(drag, w, e) {
    const g = this.game;
    if (drag.mode === 'blocked') {
      if (drag.moved && !drag.warned) {
        drag.warned = true;
        this.ui.toast('Alle Linien sind belegt. Verlängere eine Linie an ihrem Endstück oder lösche eine Linie.');
        this.audio.invalid();
      }
      return;
    }
    const list = drag.list;
    const st = this.hitStation(w, this.tol(e, 6));
    drag.invalidStation = null;
    let last = list[list.length - 1];
    if (st && st !== last) {
      if (list.length >= 2 && st === list[list.length - 2]) {
        list.pop();
        this.audio.snap(list.length, true);
      } else if (!list.includes(st)) {
        const cand = [...list, st];
        const v = g.validate(cand, drag.line);
        if (v.ok) {
          list.push(st);
          this.audio.snap(list.length);
        } else {
          drag.invalidStation = st;
          this.warnInvalid(drag, st, v, list);
        }
      }
    }
    if (!st) drag.lastInvalid = null;
    last = list[list.length - 1];
    drag.overLast = st === last;
    drag.hoverStation = st;
    drag.floatInvalid = !!drag.invalidStation;
    if (!drag.overLast && last && !drag.floatInvalid) {
      const free = g.mastsFree + (drag.line ? drag.line.mastCount : 0) - g.mastsFor(list);
      drag.floatInvalid = g.map.mastPlan(last, w).count > free;
    }
  }

  warnInvalid(drag, st, v, list) {
    if (drag.lastInvalid === st) return;
    drag.lastInvalid = st;
    if (v.reason === 'masts') {
      const need = this.game.map.mastPlan(list[list.length - 1], st).count;
      const free = Math.max(0, v.free - this.game.mastsFor(list));
      this.ui.toast(
        `Zu wenig Masten: Diese Strecke braucht ${need} ${need === 1 ? 'Mast' : 'Masten'}, frei ${free === 1 ? 'ist' : 'sind'} ${free}.`,
      );
    }
    this.audio.invalid();
  }

  endDraw(drag) {
    const g = this.game;
    const list = drag.list;
    if (drag.mode === 'blocked') {
      if (!drag.moved) this.showTip(list[0]);
      return;
    }
    if (drag.mode === 'new') {
      if (list.length >= 2) {
        const line = g.createLine(drag.slot, list);
        if (line) {
          this.audio.line();
          if (!line.gondolas.length) this.ui.toast('Keine Gondel frei – ziehe eine Gondel auf die Linie, sobald du eine hast.');
        }
      } else if (!drag.moved) this.showTip(list[0]);
      return;
    }
    const line = drag.line;
    const finalList = drag.atEnd ? list : list.slice().reverse();
    if (sameList(finalList, line.stations)) {
      if (!drag.moved) this.toggleSelect(line);
      return;
    }
    if (finalList.length < 2) {
      g.closeLine(line);
      this.audio.remove();
    } else if (g.setLineStations(line, finalList)) {
      this.audio.snap(finalList.length);
    }
  }

  // ------------------------------------------------------------ Segment umleiten
  startSegment(seg, w) {
    const { line, index } = seg;
    this.view.drag = {
      type: 'segment',
      line,
      index,
      a: line.stations[index],
      b: line.stations[index + 1],
      chain: [],
      color: line.color,
      pointer: w,
      moved: false,
      bypass: null,
      previewList: null,
    };
  }

  insertList(drag, chain) {
    const st = drag.line.stations;
    return [...st.slice(0, drag.index + 1), ...chain, ...st.slice(drag.index + 1)];
  }

  moveSegment(drag, w, e) {
    const g = this.game;
    const { line, a, b, chain, index } = drag;
    const st = this.hitStation(w, this.tol(e, 6));
    drag.bypass = null;
    drag.previewList = null;
    drag.invalidStation = null;
    drag.hoverStation = st;
    const lastC = chain.length ? chain[chain.length - 1] : a;
    if (st && st !== lastC && st !== b) {
      const prevC = chain.length >= 2 ? chain[chain.length - 2] : a;
      if (chain.length && st === prevC) {
        chain.pop();
        this.audio.snap(chain.length, true);
      } else if (!line.has(st) && !chain.includes(st)) {
        const cand = this.insertList(drag, [...chain, st]);
        const v = g.validate(cand, line);
        if (v.ok) {
          chain.push(st);
          this.audio.snap(chain.length + 2);
        } else {
          drag.invalidStation = st;
          this.warnInvalid(drag, st, v, [...line.stations.slice(0, index + 1), ...chain]);
        }
      } else if (!chain.length && line.has(st)) {
        // Segment über eine Nachbarstation hinaus ziehen: Station wird übersprungen
        const i = line.indexOf(st);
        let list = null;
        if (i === index - 1) list = line.stations.filter((s) => s !== a);
        else if (i === index + 2) list = line.stations.filter((s) => s !== b);
        if (list) {
          if (g.validate(list, line).ok) {
            drag.bypass = st;
            drag.previewList = list;
          } else drag.invalidStation = st;
        }
      }
    }
    if (!st) drag.lastInvalid = null;
    drag.floatInvalid = !!drag.invalidStation;
  }

  endSegment(drag) {
    const g = this.game;
    if (drag.chain.length) {
      if (g.setLineStations(drag.line, this.insertList(drag, drag.chain))) this.audio.snap(4);
    } else if (drag.bypass && drag.previewList) {
      if (g.setLineStations(drag.line, drag.previewList)) this.audio.remove();
    } else if (!drag.moved) {
      this.toggleSelect(drag.line);
    }
  }

  toggleSelect(line) {
    this.view.selectedLine = this.view.selectedLine === line ? null : line;
    this.audio.click();
  }

  // ------------------------------------------------------------ Objekte ziehen
  /** Start aus der unteren Leiste (Depot). */
  beginItem(kind, e) {
    if (!this.enabled || this.view.drag) return;
    this.capture(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    this.view.selectedLine = null;
    this.view.drag = {
      type: 'item',
      kind,
      source: null,
      lifted: true,
      moved: false,
      pointer: this.world(e),
      screen: { x: e.clientX, y: e.clientY },
      target: null,
    };
    this.audio.click();
  }

  startItem(kind, source, e) {
    this.view.drag = {
      type: 'item',
      kind,
      source,
      lifted: false,
      big: source.big,
      moved: false,
      pointer: this.world(e),
      screen: { x: e.clientX, y: e.clientY },
      target: null,
    };
  }

  moveItem(drag, w, e) {
    const g = this.game;
    if (drag.source && !drag.lifted && drag.moved) {
      // Gondel vom Seil nehmen: Fahrgäste steigen an der nächsten Station aus
      drag.big = drag.source.big;
      g.liftGondola(drag.source);
      drag.lifted = true;
      this.audio.whoosh();
      this.canvas.style.cursor = 'grabbing';
    }
    if (!drag.lifted) return;
    const tol = this.tol(e, 14);
    drag.target = null;
    if (drag.kind === 'gondola') {
      const line = this.lineAt(w, tol);
      if (line) drag.target = { line };
    } else if (drag.kind === 'cabin') {
      const gd = this.hitGondola(w, tol);
      if (gd && !gd.big && gd.line.active) drag.target = { gondola: gd, line: gd.line };
      else {
        const line = this.lineAt(w, tol);
        if (line) {
          let best = null;
          let bd = Infinity;
          for (const x of line.gondolas) {
            if (x.big || x.retiring) continue;
            const d = Math.hypot(x.x - w.x, x.y - w.y);
            if (d < bd) {
              bd = d;
              best = x;
            }
          }
          if (best) drag.target = { gondola: best, line };
        }
      }
    } else if (drag.kind === 'interchange') {
      const st = this.hitStation(w, tol);
      if (st && !st.interchange) drag.target = { station: st };
    }
  }

  endItem(drag, w) {
    const g = this.game;
    if (drag.kind === 'gondola') {
      if (drag.source && !drag.lifted) {
        this.toggleSelect(drag.source.line);
        return;
      }
      if (drag.target) {
        if (g.addGondola(drag.target.line, w, { big: drag.big })) this.audio.gondola();
      } else if (drag.source) {
        this.ui.toast('Gondel zurück im Depot.');
      }
    } else if (drag.kind === 'cabin') {
      if (drag.target && g.applyCabin(drag.target.gondola)) this.audio.gondola();
      else if (drag.moved) this.ui.toast('Ziehe die große Kabine auf eine Gondel oder eine Linie mit Gondel.');
    } else if (drag.kind === 'interchange') {
      if (drag.target && g.applyInterchange(drag.target.station)) this.audio.station();
      else if (drag.moved) this.ui.toast('Ziehe die Umsteigestation auf eine Station.');
    }
  }
}
