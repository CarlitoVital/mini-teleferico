// Maus- und Touch-Steuerung: Linien zeichnen, verlängern, umleiten, Objekte ziehen.
import { CONFIG, LINE_COLORS } from './config.js';
import { pointSegDist, clamp } from './util.js';
import { handleGeometry, offsetSegment } from './line.js';
import { CABIN } from './gondola.js';
import { t, buildingName } from './i18n.js';

/** Grund, warum eine Strecke gesperrt ist (Code aus dem Mastplan → Text). */
function blockedText(plan) {
  if (plan.reason === 'airport') return t('reason.airport');
  if (plan.reason === 'building') return t('reason.building', { name: buildingName(plan.blockedBy) });
  if (plan.reason === 'mastSpace') return t('reason.mastSpace');
  return t('reason.generic');
}

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
    // Kamera-Gesten: aktive Touch-Zeiger, Pinch-Zustand, Ziehen mit rechter/mittlerer Maustaste
    this.touches = new Map();
    this.pinch = null;
    this.pan = null;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => {
      this.touches.delete(e.pointerId);
      if (this.pinch) this.touchesChanged();
      if (this.pan && this.pan.id === e.pointerId) this.pan = null;
      if (e.pointerId === this.pointerId) this.cancel();
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
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

  // ------------------------------------------------------------ Kamera (Pan/Zoom)
  get cameraEnabled() {
    const g = this.game;
    return !!g && !g.demo && !this.ui.modalOpen;
  }

  onWheel(e) {
    if (!this.cameraEnabled) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = clamp(e.deltaY * unit, -240, 240);
    // Rein seitliches Scrollen (Wischen zur Seite, Shift+Rad) zoomt nicht und lässt die Kamera folgen.
    // Pinch auf dem Touchpad (ctrlKey) liefert oft winzige Werte – die zählen immer.
    if (dy === 0 || (!e.ctrlKey && Math.abs(dy) < 0.5 && Math.abs(e.deltaX) > Math.abs(e.deltaY))) return;
    this.cam.zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.006 : 0.0016)));
  }

  /** Zwei Finger: Pinch-Zoom und Schwenken. */
  startPinch() {
    // ein begonnenes Linienziehen o. Ä. verwerfen
    if (this.view.drag) this.cancel();
    this.basePinch();
  }

  /** Bezugswerte aus den ersten beiden Fingern (nach jedem Wechsel der Finger neu). */
  basePinch() {
    const [a, b] = [...this.touches.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  /** Ein Finger kam weg: mit weniger als zwei endet der Pinch, sonst neu ansetzen statt zu springen. */
  touchesChanged() {
    if (this.touches.size < 2) this.pinch = null;
    else this.basePinch();
  }

  movePinch() {
    const [a, b] = [...this.touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this.cam.panBy(mx - this.pinch.mx, my - this.pinch.my);
    this.cam.zoomAt(mx, my, d / this.pinch.d);
    this.pinch = { d, mx, my };
  }

  // ------------------------------------------------------------ Pointer
  onDown(e) {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        if (this.cameraEnabled) {
          e.preventDefault();
          this.startPinch();
        }
        return;
      }
    }
    if ((e.button === 1 || e.button === 2) && this.cameraEnabled) {
      e.preventDefault();
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.canvas.style.cursor = 'grabbing';
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // ohne Capture weiter
      }
      return;
    }
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
    // Tipp auf ein Bauwerk: kurz erklären, warum dort kein Seil hinüberführt
    const B = this.game.map.buildings;
    const bld = B && B.buildingAt(w.x, w.y);
    this.view.hoverBuilding = bld;
    if (bld) this.view.tipUntil = performance.now() + 2600;
  }

  onMove(e) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touches.size >= 2) {
        this.movePinch();
        return;
      }
    }
    if (this.pan && e.pointerId === this.pan.id) {
      this.cam.panBy(e.clientX - this.pan.x, e.clientY - this.pan.y);
      this.pan.x = e.clientX;
      this.pan.y = e.clientY;
      return;
    }
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
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinch) {
        this.touchesChanged();
        return;
      }
    }
    if (this.pan && e.pointerId === this.pan.id) {
      this.pan = null;
      this.canvas.style.cursor = '';
      return;
    }
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
    const B = this.game.map.buildings;
    this.view.hoverBuilding = !st && B ? B.buildingAt(w.x, w.y) : null;
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
        this.ui.toast(t('toast.allLinesUsed'));
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
          this.markInvalid(drag, st, v, list[list.length - 1]);
        }
      }
    }
    if (!st) drag.lastInvalid = null;
    last = list[list.length - 1];
    drag.overLast = st === last;
    drag.hoverStation = st;
    drag.floatInvalid = !!drag.invalidStation;
    drag.floatReason = drag.invalidStation ? drag.invalidText : null;
    if (!drag.overLast && last && !drag.floatInvalid) {
      drag.floatReason = this.checkFloating(drag, last, w, list);
      drag.floatInvalid = !!drag.floatReason;
    }
  }

  /** Ungültige Station unter dem Zeiger merken; Hinweis nur einmal pro Station. */
  markInvalid(drag, st, v, from, next = null) {
    drag.invalidStation = st;
    drag.invalidText = this.invalidText(v, from, st, next);
    if (drag.lastInvalid === st) return;
    drag.lastInvalid = st;
    this.ui.toast(drag.invalidText);
    this.audio.invalid();
  }

  /** Kurzer Hinweis, warum eine Strecke nicht gebaut werden kann. */
  invalidText(v, a, b, next = null) {
    const g = this.game;
    // Bedarf nur der neuen Strecke(n) a→b (und b→next beim Einfügen), nicht der ganzen Linie
    const need = (key) => (a && b ? g.map.mastPlan(a, b)[key] + (next ? g.map.mastPlan(b, next)[key] : 0) : null);
    if (v.reason === 'blocked') return blockedText(v.plan);
    if (v.reason === 'tall') {
      const n = need('tall') ?? v.tall;
      return t('reason.tall', { n, free: Math.max(0, v.tallFree - (v.tall - n)) });
    }
    if (v.reason === 'masts' && a && b) {
      const n = need('count');
      return t('reason.masts', { n, free: Math.max(0, v.free - (v.masts - n)) });
    }
    return t('reason.generic');
  }

  /** Prüft das frei schwebende Stück (letzte Station → Zeiger) und merkt sich den Grund. */
  checkFloating(drag, from, to, list) {
    const g = this.game;
    const plan = g.map.mastPlan(from, to);
    const free = g.mastsFree + (drag.line ? drag.line.mastCount : 0) - g.mastsFor(list);
    const tallFree = g.tallMastsFree + (drag.line ? drag.line.tallCount : 0) - g.tallFor(list);
    if (plan.blocked) return blockedText(plan);
    if (plan.tall > tallFree) return t('float.tall', { n: plan.tall, free: Math.max(0, tallFree) });
    if (plan.count > free) return t('float.masts', { n: plan.count, free: Math.max(0, free) });
    return null;
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
          if (!line.gondolas.length) this.ui.toast(t('toast.noGondola'));
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
          // eingefügt werden zwei Strecken: letzte Station → st und st → b
          this.markInvalid(drag, st, v, chain.length ? chain[chain.length - 1] : a, b);
        }
      } else if (!chain.length && line.has(st)) {
        // Segment über eine Nachbarstation hinaus ziehen: Station wird übersprungen
        const i = line.indexOf(st);
        let list = null;
        if (i === index - 1) list = line.stations.filter((s) => s !== a);
        else if (i === index + 2) list = line.stations.filter((s) => s !== b);
        if (list) {
          const v = g.validate(list, line);
          if (v.ok) {
            drag.bypass = st;
            drag.previewList = list;
          } else this.markInvalid(drag, st, v, i === index - 1 ? b : a);
        }
      }
    }
    if (!st) drag.lastInvalid = null;
    drag.floatInvalid = !!drag.invalidStation;
    drag.floatReason = drag.invalidStation ? drag.invalidText : null;
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
        this.ui.toast(t('toast.gondolaDepot'));
      }
    } else if (drag.kind === 'cabin') {
      if (drag.target && g.applyCabin(drag.target.gondola)) this.audio.gondola();
      else if (drag.moved) this.ui.toast(t('toast.cabinTarget'));
    } else if (drag.kind === 'interchange') {
      if (drag.target && g.applyInterchange(drag.target.station)) this.audio.station();
      else if (drag.moved) this.ui.toast(t('toast.interchangeTarget'));
    }
  }
}
