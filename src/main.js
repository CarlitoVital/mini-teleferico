// Einstiegspunkt: verbindet Spiel, Darstellung, Eingabe, Oberfläche und Ton.
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { SoundBoard } from './audio.js';
import { AutoPlayer } from './autoplay.js';
import { SHAPE_NAMES, LINE_COLORS } from './config.js';
import { storageGet, storageSet } from './util.js';

window.__tfBooted = true;

const STEP = 1 / 60;
const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const audio = new SoundBoard();
const view = { drag: null, selectedLine: null, preferredSlot: null, hoverStation: null, tipUntil: 0, demo: true };
const state = { paused: false, speed: 1, muted: audio.muted, menuWasPaused: false };
let game = null;
let demoBot = null;

const ui = new UI({
  onPlay: () => startGame(),
  onHome: () => showHome(),
  onPause: () => togglePause(),
  onSpeed: () => setSpeed(state.speed === 1 ? 2 : 1),
  onSound: () => toggleSound(),
  onMenu: () => openMenu(),
  onResume: () => closeMenu(),
  onDeleteLine: () => deleteSelected(),
  onDot: (slot) => onDot(slot),
  onItemDown: (kind, e) => input.beginItem(kind, e),
});
const input = new Input({ canvas, renderer, view, getGame: () => game, ui, audio });

function loadBest() {
  try {
    const raw = storageGet('teleferico.best');
    const best = raw ? JSON.parse(raw) : null;
    return best && Number.isFinite(best.score) ? best : null;
  } catch {
    return null;
  }
}

function newGame(demo) {
  const size = renderer.worldSize();
  const g = new Game({ width: size.w, height: size.h, seed: (Math.random() * 2 ** 32) >>> 0, demo });
  renderer.camera.fit(g.viewRegion(), true);
  return g;
}

function resetView() {
  input.cancel();
  view.selectedLine = null;
  view.preferredSlot = null;
  view.hoverStation = null;
  view.tipUntil = 0;
  state.paused = false;
  state.speed = 1;
}

/** Startbildschirm mit selbst spielendem Netz im Hintergrund. */
function showHome() {
  resetView();
  game = newGame(true);
  game.res = { ...game.res, lines: 5, gondolas: 9, masts: 12 };
  demoBot = new AutoPlayer(game, { period: 1.4, delay: 0.2 });
  for (let i = 0; i < 40 * 30; i++) {
    demoBot.update(1 / 30);
    game.update(1 / 30);
  }
  renderer.camera.fit(game.viewRegion(), true);
  view.demo = true;
  ui.showStart(loadBest());
}

function startGame() {
  audio.unlock();
  audio.click();
  resetView();
  game = newGame(false);
  demoBot = null;
  view.demo = false;
  wire(game);
  ui.showGame();
  ui.toast('Ziehe von einer Station zur nächsten, um deine erste Seilbahnlinie zu bauen.', 5500);
}

function wire(g) {
  // Einmalige Hinweise pro Runde
  const hints = new Set();
  const hint = (key, text, ms = 5000) => {
    if (hints.has(key)) return;
    hints.add(key);
    setTimeout(() => {
      if (game === g && g.state !== 'over') ui.toast(text, ms);
    }, 900);
  };
  g.on('line', (line) => {
    if (line.mastCount) hint('mast', `Masten tragen das Seil über Schluchten und lange Spannweiten. Frei: ${g.mastsFree}.`);
    else hint('handle', 'Linie steht! Am T-Ende kannst du sie verlängern – oder durch Zurückziehen kürzen.');
  });
  g.on('lineChanged', (line) => {
    if (line.mastCount) hint('mast', `Masten tragen das Seil über Schluchten und lange Spannweiten. Frei: ${g.mastsFree}.`);
  });
  g.on('station', () => {
    if (g.time > 0.5) audio.station();
  });
  g.on('rare', (st) => {
    audio.rare();
    ui.toast(`Neue Station mit seltener Form: ${SHAPE_NAMES[st.shape]} in ${st.name}.`);
  });
  g.on('board', ({ line }) => audio.board(line.slot));
  g.on('deliver', ({ line }) => audio.deliver(line.slot));
  g.on('warn', (st) => {
    audio.warn();
    ui.toast(`${st.name} ist überfüllt! Bring schnell Gondeln dorthin.`);
  });
  g.on('week', ({ week, options }) => {
    input.cancel();
    audio.week();
    ui.showReward(g, week, options, (k) => {
      g.chooseReward(k);
      audio.click();
      const kindHint = {
        line: 'Neue Linie frei: Ziehe von einer Station aus, um sie zu bauen.',
        cabin: 'Ziehe die große Kabine auf eine Gondel oder Linie.',
        interchange: 'Ziehe die Umsteigestation auf eine viel genutzte Station.',
      }[k];
      if (kindHint && !hints.has(k)) hint(k, kindHint);
      else if (g.gondolasFree > 0) hint('depot', 'Ziehe die neue Gondel aus der unteren Leiste auf eine Linie.');
    });
  });
  g.on('gameover', (sum) => onGameOver(g, sum));
}

function onGameOver(g, sum) {
  input.cancel();
  audio.gameOver();
  const best = loadBest();
  const record = sum.score > 0 && (!best || sum.score > best.score);
  if (record) storageSet('teleferico.best', JSON.stringify({ score: sum.score, week: sum.week }));
  const st = g.overStation;
  // Station oberhalb des Game-Over-Panels zeigen
  const cam = renderer.camera;
  const zoom = cam.fitScale(g.viewRegion()) * 1.8;
  cam.focus(st.x, st.y + (cam.vp.h * 0.3) / zoom, zoom);
  setTimeout(() => {
    if (game === g) ui.showGameOver(sum, loadBest(), record);
  }, 1700);
}

const playing = () => game && !game.demo && game.state === 'playing';

function togglePause() {
  if (!playing() || !ui.el.menu.hidden) return;
  state.paused = !state.paused;
  audio.click();
}

function setSpeed(s) {
  if (!game || game.demo) return;
  state.speed = s;
  audio.click();
}

function toggleSound() {
  audio.unlock();
  audio.setMuted(!audio.muted);
  state.muted = audio.muted;
  audio.click();
}

function openMenu() {
  if (!playing() || !ui.el.menu.hidden) return;
  input.cancel();
  state.menuWasPaused = state.paused;
  state.paused = true;
  ui.showMenu(true);
  audio.click();
}

function closeMenu() {
  ui.showMenu(false);
  state.paused = state.menuWasPaused;
  audio.click();
}

function deleteSelected() {
  const l = view.selectedLine;
  if (!game || !l || !l.active) return;
  game.closeLine(l);
  view.selectedLine = null;
  audio.remove();
  ui.toast(`Linie ${l.color.name} wird abgebaut – ihre Gondeln kehren ins Depot zurück.`);
}

function onDot(slot) {
  if (!game || game.demo) return;
  const l = game.lines.find((x) => x.slot === slot);
  if (l && l.active) view.selectedLine = view.selectedLine === l ? null : l;
  else if (!l) {
    view.preferredSlot = slot;
    view.selectedLine = null;
    ui.toast(`Die nächste neue Linie wird ${LINE_COLORS[slot].name}.`, 1800);
  }
  audio.click();
}

// ---------------------------------------------------------------- Tastatur
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key;
  const onButton = e.target instanceof HTMLButtonElement;
  if (!ui.el.reward.hidden) {
    if (k === '1' || k === '2') ui.chooseReward(Number(k) - 1);
    return;
  }
  if (!ui.el.start.hidden || !ui.el.over.hidden) {
    if ((k === 'Enter' || k === ' ') && !onButton) {
      e.preventDefault();
      startGame();
    }
    return;
  }
  if (!ui.el.menu.hidden) {
    if (k === 'Escape') closeMenu();
    return;
  }
  if (onButton && (k === ' ' || k === 'Enter')) return;
  if (k === ' ') {
    e.preventDefault();
    togglePause();
  } else if (k === '1') setSpeed(1);
  else if (k === '2') setSpeed(2);
  else if (k === 'm' || k === 'M') toggleSound();
  else if (k === 'Delete' || k === 'Backspace') deleteSelected();
  else if (k === 'Escape') {
    if (view.drag) input.cancel();
    else if (view.selectedLine) view.selectedLine = null;
    else openMenu();
  }
});

// Knöpfe nach Mausklick nicht fokussiert lassen (sonst löst die Leertaste sie erneut aus)
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (b && e.detail > 0) b.blur();
});

window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
window.addEventListener('resize', () => {
  renderer.resize();
  if (game && game.state !== 'over') renderer.camera.fit(game.viewRegion(), true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing()) state.paused = true;
});

// ---------------------------------------------------------------- Spielschleife
let last = performance.now();
function frame(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (game) {
    if (game.demo) {
      demoBot.update(realDt);
      game.update(realDt);
    } else if (!state.paused && game.state === 'playing') {
      const t = realDt * state.speed;
      const steps = Math.max(1, Math.ceil(t / STEP));
      for (let i = 0; i < steps && game.state === 'playing'; i++) game.update(t / steps);
    }
    if (game.state !== 'over') renderer.camera.fit(game.viewRegion());
    renderer.camera.update(realDt);
    if (view.tipUntil && now > view.tipUntil) {
      view.tipUntil = 0;
      view.hoverStation = null;
    }
    audio.alarm(playing() && !state.paused ? game.maxOvercrowd : 0, realDt);
  }
  renderer.render(game, view, now / 1000);
  state.selectedLine = view.selectedLine;
  state.preferredSlot = view.preferredSlot;
  ui.update(game, state);
  requestAnimationFrame(frame);
}

// Zugriff für Tests und Neugierige in der Browser-Konsole
window.__teleferico = {
  get game() {
    return game;
  },
  renderer,
  view,
  state,
};

showHome();
requestAnimationFrame(frame);
