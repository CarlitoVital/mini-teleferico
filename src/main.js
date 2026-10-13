// Einstiegspunkt: verbindet Spiel, Darstellung, Eingabe, Oberfläche, Ton, Spielstände und Konto.
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { SoundBoard } from './audio.js';
import { AutoPlayer } from './autoplay.js';
import { SHAPE_NAMES, LINE_COLORS } from './config.js';
import { storageGet, storageSet, randomSeed, normalizeSeed, clamp } from './util.js';
import { deserializeGame } from './save.js';
import { Persistence } from './persist.js';
import { localSaves } from './storage.js';
import { api } from './api.js';

window.__tfBooted = true;

const STEP = 1 / 60;
const AUTOSAVE_SECONDS = 30;
const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const audio = new SoundBoard();
const persist = new Persistence();
const view = { drag: null, selectedLine: null, preferredSlot: null, hoverStation: null, hoverBuilding: null, tipUntil: 0, demo: true };
const state = { paused: false, speed: 1, muted: audio.muted, menuWasPaused: false };
let game = null;
let demoBot = null;
let runId = null;
let autosaveAcc = 0;
let lastSaved = { time: -1, dirty: true };
let continueEntry = null;
let loadSeq = 0; // verwirft Ladevorgänge, die von einer neueren Aktion überholt wurden

const ui = new UI({
  onPlay: (seed) => startGame(seed),
  onPlaySame: () => startGame(game && !game.demo ? game.seed : ui.seedInput()),
  onDice: () => {
    ui.setSeedInput(randomSeed());
    audio.click();
  },
  onRecenter: () => recenter(),
  onContinue: () => continueEntry && loadEntry(continueEntry),
  onOpenSaves: (mode) => openSaves(mode),
  onSaveSlot: (entry) => saveToSlot(entry),
  onLoadSlot: (entry) => loadEntry(entry),
  onDeleteSlot: (entry) => deleteEntry(entry),
  onImportLocal: () => importLocal(),
  onOpenAccount: () => openAccount(),
  onAuthSubmit: (mode, user, pass) => authSubmit(mode, user, pass),
  onLogout: () => logout(),
  onOpenBoard: () => openBoard(),
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

const newRunId = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e8).toString(36)}`;

function loadBest() {
  try {
    const raw = storageGet('teleferico.best');
    const best = raw ? JSON.parse(raw) : null;
    return best && Number.isFinite(best.score) ? best : null;
  } catch {
    return null;
  }
}

function newGame(demo, seed) {
  const geo = renderer.startGeometry();
  const g = new Game({ seed: seed || randomSeed(), aspect: geo.aspect, area: geo.area, demo });
  const cam = renderer.camera;
  cam.setBounds(g.map.W, g.map.H);
  cam.manual = false;
  cam.fit(g.viewRegion(), true);
  return g;
}

/** Kamera wieder dem Stadtbereich folgen lassen. */
function recenter() {
  if (!game) return;
  renderer.camera.manual = false;
  audio.click();
}

function resetView() {
  input.cancel();
  view.selectedLine = null;
  view.preferredSlot = null;
  view.hoverStation = null;
  view.hoverBuilding = null;
  view.tipUntil = 0;
  state.paused = false;
  state.speed = 1;
}

/** Startbildschirm mit selbst spielendem Netz im Hintergrund. */
function showHome() {
  loadSeq++;
  autosave();
  resetView();
  game = newGame(true);
  game.res = { ...game.res, lines: 5, gondolas: 9, masts: 24 };
  demoBot = new AutoPlayer(game, { period: 1.4, delay: 0.2 });
  for (let i = 0; i < 40 * 30; i++) {
    demoBot.update(1 / 30);
    game.update(1 / 30);
  }
  renderer.camera.fit(game.viewRegion(), true);
  view.demo = true;
  runId = null;
  ui.showStart(loadBest());
  refreshContinue();
}

function startGame(seed) {
  loadSeq++;
  autosave();
  audio.unlock();
  audio.click();
  resetView();
  game = newGame(false, seed ? normalizeSeed(seed) : null);
  demoBot = null;
  view.demo = false;
  runId = newRunId();
  lastSaved = { time: -1, dirty: true };
  autosaveAcc = 0;
  wire(game);
  ui.showGame();
  ui.toast('Ziehe von einer Station zur nächsten, um deine erste Seilbahnlinie zu bauen.', 5500);
}

function showReward(g, week, options) {
  ui.showReward(g, week, options, (k) => {
    g.chooseReward(k);
    lastSaved.dirty = true;
    audio.click();
    if (g.hint) g.hint.reward(k);
  });
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
  g.hint = {
    reward(k) {
      const kindHint = {
        line: 'Neue Linie frei: Ziehe von einer Station aus, um sie zu bauen.',
        cabin: 'Ziehe die große Kabine auf eine Gondel oder Linie.',
        interchange: 'Ziehe die Umsteigestation auf eine viel genutzte Station.',
        tall: 'Hoher Mast: Ein neues Seil darf jetzt ein einzelnes Hochhaus, Stadion, Spital oder eine Kaserne überspannen.',
      }[k];
      if (kindHint && !hints.has(k)) hint(k, kindHint);
      else if (g.gondolasFree > 0) hint('depot', 'Ziehe die neue Gondel aus der unteren Leiste auf eine Linie.');
    },
  };
  const mastHint = () => hint('mast', `Masten tragen das Seil über Schluchten, steile Kanten und Bergrücken. Frei: ${g.mastsFree}.`);
  g.on('line', (line) => {
    if (line.mastCount) mastHint();
    else hint('handle', 'Linie steht! Am T-Ende kannst du sie verlängern – oder durch Zurückziehen kürzen.');
  });
  g.on('lineChanged', (line) => {
    if (line.mastCount) mastHint();
  });
  // Jede Änderung am Spielstand – auch in der Pause (Gondeln, Kabinen, Umsteigestationen)
  for (const ev of ['network', 'gondola', 'resources']) g.on(ev, () => (lastSaved.dirty = true));
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
    showReward(g, week, options);
  });
  g.on('gameover', (sum) => onGameOver(g, sum));
}

function onGameOver(g, sum) {
  input.cancel();
  audio.gameOver();
  const best = loadBest();
  const record = sum.score > 0 && (!best || sum.score > best.score);
  if (record) storageSet('teleferico.best', JSON.stringify({ score: sum.score, week: sum.week }));
  persist.finishRun(runId).then(refreshContinue);
  const st = g.overStation;
  // Station oberhalb des Game-Over-Panels zeigen
  const cam = renderer.camera;
  const zoom = cam.fitScale(g.viewRegion()) * 1.8;
  cam.focus(st.x, st.y + (cam.vp.h * 0.3) / zoom, zoom);
  setTimeout(() => {
    if (game !== g) return;
    ui.showGameOver(sum, loadBest(), record);
    if (persist.online && sum.score > 0) {
      api
        .submitScore({ score: sum.score, week: sum.week, seed: sum.seed, area: sum.area, time: Math.round(sum.time) })
        .then((r) => ui.setGameOverNote(r && r.best === sum.score ? 'Neuer persönlicher Bestwert im Konto!' : 'Im Konto gespeichert'))
        .catch((err) => ui.setGameOverNote(`Bestenliste: ${err.message}`));
    }
  }, 1700);
}

// ---------------------------------------------------------------- Spielstände
function cameraState() {
  const c = renderer.camera;
  return { x: c.x, y: c.y, scale: c.scale, manual: c.manual };
}

/** Gibt es seit dem letzten Speichern/Laden Änderungen? (Ein nur geladener Stand überschreibt „auto“ nicht.) */
function unsaved() {
  return !!game && !game.demo && game.state !== 'over' && (game.time !== lastSaved.time || lastSaved.dirty);
}

/** Automatisch speichern (alle 30 s, beim Verlassen und beim Wechsel ins Hauptmenü). */
async function autosave() {
  if (!unsaved()) return;
  lastSaved = { time: game.time, dirty: false };
  const r = await persist.save('auto', game, cameraState(), runId);
  // Konto-Kopie fehlgeschlagen: beim nächsten Autosave, Hauptmenü oder Verlassen erneut versuchen
  if (r.server === false && persist.online) lastSaved.dirty = true;
  if (r.server === false && !autosave.warned) {
    autosave.warned = true;
    if (persist.online) ui.toast(`Konto-Speicherung fehlgeschlagen (${r.error}) – lokal gesichert.`);
  } else if (r.server) {
    autosave.warned = false;
  }
}

function saveOnExit() {
  if (!unsaved()) return;
  lastSaved = { time: game.time, dirty: false };
  // Beacon abgelehnt (z. B. zu groß): beim nächsten Mal erneut senden
  if (persist.saveOnExit(game, cameraState(), runId) === false) lastSaved.dirty = true;
}

async function refreshContinue() {
  try {
    continueEntry = await persist.latestAuto();
  } catch {
    continueEntry = null;
  }
  if (!ui.el.start.hidden) ui.setContinue(continueEntry);
}

async function openSaves(mode) {
  const { entries, error } = mode === 'save' ? await persist.saveSlots() : await persist.list();
  let note = '';
  if (mode === 'save') {
    note = persist.online
      ? 'Gespeichert wird lokal und zusätzlich in deinem Konto.'
      : 'Gespeichert wird lokal in diesem Browser. Mit einem Konto auch auf dem Server.';
  } else {
    note = persist.online ? '' : api.available ? 'Melde dich an, um Spielstände auf allen Geräten zu laden.' : '';
  }
  if (error) note = `Spielstände im Konto konnten nicht geladen werden (${error}).`;
  if (!(await localSaves.available())) {
    note = 'Dieser Browser erlaubt keinen dauerhaften Speicher – Spielstände gehen beim Neuladen verloren.';
  }
  const canImport = mode === 'load' && persist.online && (await persist.hasLocal());
  ui.showSaves({ mode, entries, note, canImport });
  ui.savesMode = mode;
}

async function saveToSlot(entry) {
  if (!game || game.demo || game.state === 'over') return;
  const r = await persist.save(entry.id, game, cameraState(), runId, entry.key);
  audio.click();
  if (r.server === false) ui.toast(`Lokal gespeichert, Konto fehlgeschlagen: ${r.error}`);
  else ui.toast(`Gespeichert in ${entry.label}${r.server ? ' (lokal und im Konto)' : ''}.`);
  openSaves('save');
}

async function loadEntry(entry) {
  const seq = ++loadSeq;
  try {
    const data = await persist.loadData(entry);
    if (seq !== loadSeq) return; // inzwischen wurde etwas anderes gestartet oder geladen
    const { game: g, camera } = deserializeGame(data);
    // Nur „Weiterspielen“ setzt dieselbe Runde fort; ein Speicherplatz startet einen neuen Zweig,
    // damit dessen Autosaves nicht als Teil einer womöglich schon beendeten Runde gelten
    applyLoaded(g, camera, entry.kind === 'auto' ? entry.meta && entry.meta.runId : null);
    audio.click();
    ui.toast(`Spielstand geladen – Woche ${g.week}, ${g.score} Fahrgäste. Leertaste zum Fortsetzen.`, 4000);
  } catch (err) {
    ui.toast(`Laden fehlgeschlagen: ${err.message}`);
  }
}

function applyLoaded(g, camera, rid) {
  resetView();
  game = g;
  demoBot = null;
  view.demo = false;
  runId = rid || newRunId();
  lastSaved = { time: g.time, dirty: false };
  autosaveAcc = 0;
  const cam = renderer.camera;
  cam.setBounds(g.map.W, g.map.H);
  if (camera) {
    cam.manual = !!camera.manual;
    cam.x = cam.tx = camera.x;
    cam.y = cam.ty = camera.y;
    cam.scale = cam.ts = clamp(camera.scale, cam.minScale, cam.maxScale);
  } else {
    cam.manual = false;
    cam.fit(g.viewRegion(), true);
  }
  wire(g);
  ui.showGame();
  state.paused = true;
  if (g.state === 'reward') showReward(g, g.week, g.rewardOptions);
}

async function deleteEntry(entry) {
  const where = { server: 'im Konto', both: 'auf diesem Gerät und im Konto' }[entry.source] || 'auf diesem Gerät';
  if (!window.confirm(`„${entry.label}“ ${where} wirklich löschen?`)) return;
  try {
    await persist.remove(entry);
    ui.toast('Spielstand gelöscht.');
  } catch (err) {
    ui.toast(`Löschen fehlgeschlagen: ${err.message}`);
  }
  openSaves(ui.savesMode || 'load');
  refreshContinue();
}

async function importLocal() {
  try {
    const n = await persist.importLocal();
    ui.toast(n ? `${n} ${n === 1 ? 'Spielstand' : 'Spielstände'} ins Konto übernommen.` : 'Keine lokalen Spielstände gefunden.');
  } catch (err) {
    ui.toast(`Übernahme fehlgeschlagen: ${err.message}`);
  }
  openSaves('load');
}

// ---------------------------------------------------------------- Konto
/** Der eigene Server markiert die ausgelieferte Seite; bei statischem Hosting gibt es keine API. */
const hasBackend = () => !!document.querySelector('meta[name="teleferico-server"]');

// Sitzung auf dem Server abgelaufen oder in einem anderen Tab abgemeldet
persist.onSessionLost = () => {
  ui.setUser(null, api.available);
  ui.toast('Deine Anmeldung ist abgelaufen – bitte erneut anmelden. Bis dahin wird nur lokal gespeichert.', 6000);
  refreshContinue();
};

async function initAccount() {
  if (hasBackend() && (await api.probe())) {
    try {
      await api.me();
    } catch {
      api.user = null;
    }
  }
  ui.setUser(api.user, api.available);
  refreshContinue();
}

async function openAccount() {
  if (!api.available && hasBackend()) await api.probe();
  let scores = [];
  if (api.user) {
    try {
      scores = await api.myScores();
    } catch {
      scores = [];
    }
  }
  ui.setUser(api.user, api.available);
  ui.showAccount({ available: api.available, user: api.user, scores });
}

async function authSubmit(mode, username, password) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(name)) {
    ui.setAuthError('Benutzername: 3–24 Zeichen, nur Buchstaben, Ziffern, _ . -');
    return;
  }
  if (String(password || '').length < 8) {
    ui.setAuthError('Das Passwort muss mindestens 8 Zeichen lang sein.');
    return;
  }
  ui.setAuthBusy(true);
  try {
    if (mode === 'register') await api.register(name, password);
    else await api.login(name, password);
    audio.click();
    await openAccount();
    ui.toast(
      (await persist.hasLocal())
        ? `Angemeldet als ${api.user.username}. Unter „Spielstände“ kannst du lokale Stände ins Konto übernehmen.`
        : `Angemeldet als ${api.user.username}.`,
      5000,
    );
    refreshContinue();
  } catch (err) {
    ui.setAuthError(err.message);
  } finally {
    ui.setAuthBusy(false);
  }
}

async function logout() {
  try {
    await api.logout();
  } catch (err) {
    ui.toast(err.message);
  }
  api.user = null;
  ui.setUser(null, api.available);
  ui.showAccount({ available: api.available, user: null });
  refreshContinue();
}

async function openBoard() {
  try {
    ui.showBoard(await api.leaderboard(), api.user);
  } catch (err) {
    ui.toast(`Bestenliste nicht verfügbar: ${err.message}`);
  }
}

// ---------------------------------------------------------------- Spielsteuerung
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
  ui.showMenu(true, `Seed ${game.seed} · Start: ${game.startArea.name}`);
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
  // Nur sichtbare Knöpfe behalten Leertaste/Enter für sich (ein versteckter Dialog behält manchmal den Fokus)
  const onButton = e.target instanceof HTMLButtonElement && !e.target.closest('[hidden]');
  const inInput = e.target instanceof HTMLInputElement;
  if (ui.overlayOpen) {
    if (k === 'Escape') {
      ui.hideSaves();
      ui.hideAccount();
      ui.hideBoard();
    }
    return;
  }
  if (!ui.el.reward.hidden) {
    if (k === '1' || k === '2') ui.chooseReward(Number(k) - 1);
    return;
  }
  if (!ui.el.start.hidden || !ui.el.over.hidden) {
    if (k === 'Enter' && !onButton) {
      e.preventDefault();
      startGame(ui.el.start.hidden ? '' : ui.seedInput());
    } else if (k === ' ' && !onButton && !inInput) {
      e.preventDefault();
      startGame(ui.el.start.hidden ? '' : ui.seedInput());
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
  else if (k === 'c' || k === 'C' || k === 'Home') recenter();
  else if (k === '+' || k === '=') renderer.camera.zoomAt(renderer.camera.cx, renderer.camera.cy, 1.25);
  else if (k === '-' || k === '_') renderer.camera.zoomAt(renderer.camera.cx, renderer.camera.cy, 0.8);
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
  if (!game) return;
  renderer.camera.setBounds(game.map.W, game.map.H);
  if (game.state !== 'over' && !renderer.camera.manual) renderer.camera.fit(game.viewRegion(), true);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (playing()) state.paused = true;
  saveOnExit();
});
window.addEventListener('pagehide', saveOnExit);
window.addEventListener('beforeunload', saveOnExit);

// ---------------------------------------------------------------- Spielschleife
let last = performance.now();
function frame(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (game) {
    if (game.demo) {
      demoBot.update(realDt);
      game.update(realDt);
    } else {
      if (!state.paused && game.state === 'playing') {
        const t = realDt * state.speed;
        const steps = Math.max(1, Math.ceil(t / STEP));
        for (let i = 0; i < steps && game.state === 'playing'; i++) game.update(t / steps);
      }
      autosaveAcc += realDt;
      if (autosaveAcc >= AUTOSAVE_SECONDS) {
        autosaveAcc = 0;
        autosave();
      }
    }
    if (game.state !== 'over') renderer.camera.follow(game.viewRegion());
    renderer.camera.update(realDt);
    if (view.tipUntil && now > view.tipUntil) {
      view.tipUntil = 0;
      view.hoverStation = null;
      view.hoverBuilding = null;
    }
    audio.alarm(playing() && !state.paused ? game.maxOvercrowd : 0, realDt);
  }
  renderer.render(game, view, now / 1000);
  state.selectedLine = view.selectedLine;
  state.preferredSlot = view.preferredSlot;
  state.manualCamera = renderer.camera.manual;
  ui.update(game, state);
  requestAnimationFrame(frame);
}

// Zugriff für Tests und Neugierige in der Browser-Konsole
window.__teleferico = {
  get game() {
    return game;
  },
  get runId() {
    return runId;
  },
  renderer,
  view,
  state,
  ui,
  persist,
  api,
  autosave,
};

showHome();
initAccount();
requestAnimationFrame(frame);
