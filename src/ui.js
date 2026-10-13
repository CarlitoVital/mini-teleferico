// DOM-Oberfläche: HUD, untere Leiste, Start-, Belohnungs-, Pause-, Game-Over-, Spielstand-,
// Konto- und Bestenlisten-Dialoge. Reiner Controller – die Logik steckt in main.js.
import { LINE_COLORS } from './config.js';
import { REWARDS, nightness, rushFactor } from './game.js';

const $ = (id) => document.getElementById(id);

export const ICONS = {
  gondola: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M2 7.5 30 4.5" class="stroke"/><path d="M16 6v6" class="stroke"/><circle cx="16" cy="6" r="1.8"/><rect x="11" y="11" width="10" height="2" rx="1"/><rect x="8.5" y="13" width="15" height="12.5" rx="3.2" class="body"/><rect x="11" y="16" width="10" height="4.2" rx="1.2" class="win"/></svg>`,
  masts: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 8.5h26" class="stroke thin"/><path d="M12 28 15 9h2l3 19z"/><path d="M8.5 7h15v3h-15z"/><path d="M13.6 21.5 18 14.5M18.4 21.5 14 14.5M12.8 24.5h6.4" class="cut"/></svg>`,
  tall: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 4.5h26" class="stroke thin"/><path d="M13.2 30 15.2 5h1.6l2 25z"/><path d="M10 3.2h12v2.6H10z"/><rect x="20" y="17" width="9" height="13" rx="1" class="block"/><path d="M14.4 24.5 17.6 18M17.6 24.5 14.4 18M14 12.5 17.8 8.5M18 12.5 14.2 8.5" class="cut"/></svg>`,
  cabin: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3v6" class="stroke"/><circle cx="16" cy="3.5" r="1.8"/><rect x="3.5" y="9.5" width="25" height="15" rx="3.5" class="body"/><path d="M16 12.5v9M11.5 17h9" class="cut wide"/></svg>`,
  interchange: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" class="ring"/><circle cx="16" cy="16" r="6.5" class="ring"/></svg>`,
  line: (hex) =>
    `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 25 27 7" stroke="${hex}" stroke-width="5" stroke-linecap="round" fill="none"/><circle cx="5.5" cy="24.5" r="4" class="ring-s"/><circle cx="26.5" cy="7.5" r="4" class="ring-s"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" class="stroke"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m15.5 9.5 5 5m0-5-5 5" class="stroke"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" class="stroke"/></svg>`,
  center: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" class="stroke"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" class="stroke"/></svg>`,
};

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Illimani-Farben über den Tag: [Stunde, Berg, Schnee]
const ILLIMANI_SKY = [
  [0, [62, 74, 110], [190, 201, 225]],
  [4.5, [62, 74, 110], [190, 201, 225]],
  [6.2, [128, 104, 140], [247, 196, 178]], // Morgenrot
  [8, [140, 154, 174], [255, 255, 255]],
  [16.8, [140, 154, 174], [255, 255, 255]],
  [18.6, [139, 94, 122], [245, 176, 140]], // Abendrot
  [20.5, [62, 74, 110], [190, 201, 225]],
  [24, [62, 74, 110], [190, 201, 225]],
];

function skyColors(h) {
  for (let i = 0; i < ILLIMANI_SKY.length - 1; i++) {
    const [h0, m0, s0] = ILLIMANI_SKY[i];
    const [h1, m1, s1] = ILLIMANI_SKY[i + 1];
    if (h >= h0 && h <= h1) {
      const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
      const mix = (a, b) => a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',');
      return { mtn: `rgb(${mix(m0, m1)})`, snow: `rgb(${mix(s0, s1)})` };
    }
  }
  return { mtn: 'rgb(140,154,174)', snow: 'rgb(255,255,255)' };
}

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      hud: $('hud'),
      bar: $('bar'),
      score: $('score'),
      clockDay: $('clock-day'),
      clockWeek: $('clock-week'),
      clockArc: $('clock-arc'),
      illimani: $('illimani'),
      hudMeta: $('hud-meta'),
      rush: $('rush'),
      dots: $('line-dots'),
      del: $('btn-delete'),
      toast: $('toast'),
      paused: $('paused'),
      start: $('screen-start'),
      reward: $('screen-reward'),
      rewardWeek: $('reward-week'),
      rewardCards: $('reward-cards'),
      over: $('screen-over'),
      menu: $('screen-menu'),
      saves: $('screen-saves'),
      account: $('screen-account'),
      board: $('screen-board'),
      best: $('best'),
      pause: $('btn-pause'),
      speed: $('btn-speed'),
      sound: $('btn-sound'),
      center: $('btn-center'),
      seed: $('seed-input'),
      userChip: $('user-chip'),
      userName: $('user-name'),
    };
    this.sig = {};
    this.toastTimer = 0;
    this.rewardChoices = null;
    this.authMode = 'login';

    const click = (id, fn) => $(id).addEventListener('click', fn);
    this.el.menuBtn = $('btn-menu');
    this.el.menuBtn.innerHTML = ICONS.menu;
    this.el.center.innerHTML = ICONS.center;
    click('btn-pause', () => this.h.onPause());
    click('btn-speed', () => this.h.onSpeed());
    click('btn-sound', () => this.h.onSound());
    click('btn-menu', () => this.h.onMenu());
    click('btn-center', () => this.h.onRecenter());
    click('btn-play', () => this.h.onPlay(this.seedInput()));
    click('btn-dice', () => this.h.onDice());
    click('btn-continue', () => this.h.onContinue());
    click('btn-saves', () => this.h.onOpenSaves('load'));
    click('btn-account', () => this.h.onOpenAccount());
    click('btn-board', () => this.h.onOpenBoard());
    click('btn-again', () => this.h.onPlay(''));
    click('btn-same', () => this.h.onPlaySame());
    click('btn-home', () => this.h.onHome());
    click('btn-resume', () => this.h.onResume());
    click('btn-save', () => this.h.onOpenSaves('save'));
    click('btn-restart', () => this.h.onPlaySame());
    click('btn-quit', () => this.h.onHome());
    click('start-sound', () => this.h.onSound());
    click('btn-delete', () => this.h.onDeleteLine());
    click('btn-saves-close', () => this.hideSaves());
    click('btn-import', () => this.h.onImportLocal());
    click('btn-account-close', () => this.hideAccount());
    click('btn-logout', () => this.h.onLogout());
    click('btn-board-close', () => this.hideBoard());

    this.res = {};
    for (const btn of document.querySelectorAll('#resources .res')) {
      const kind = btn.dataset.kind;
      btn.insertAdjacentHTML('afterbegin', ICONS[kind]);
      this.res[kind] = { btn, count: btn.querySelector('.count') };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (kind === 'masts') {
          this.toast(
            'Masten setzt das Spiel automatisch: bei langen Spannweiten, tiefen Schluchten, steilen Kanten wie der Ceja und wo das Seil sonst den Boden berühren würde.',
            4500,
          );
          return;
        }
        if (kind === 'tall') {
          this.toast('Hohe Masten werden automatisch genutzt, wenn ein Seil ein einzelnes Hochhaus, Stadion, Spital oder eine Kaserne überspannt.', 4500);
          return;
        }
        if (btn.classList.contains('empty')) {
          this.toast(`Keine ${btn.dataset.label} verfügbar.`);
          return;
        }
        this.h.onItemDown(kind, e);
      });
    }
    this.el.dots.addEventListener('click', (e) => {
      const b = e.target.closest('.dot');
      if (b) this.h.onDot(Number(b.dataset.slot));
    });
    this.el.rewardCards.addEventListener('click', (e) => {
      const b = e.target.closest('.card');
      if (b) this.chooseReward(Number(b.dataset.index));
    });
    $('saves-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const entry = this.saveEntries && this.saveEntries[Number(b.dataset.index)];
      if (!entry) return;
      if (b.dataset.action === 'load') this.h.onLoadSlot(entry);
      else if (b.dataset.action === 'save') this.h.onSaveSlot(entry);
      else if (b.dataset.action === 'delete') this.h.onDeleteSlot(entry);
    });
    for (const tab of document.querySelectorAll('#auth-form .tab')) {
      tab.addEventListener('click', () => this.setAuthMode(tab.dataset.mode));
    }
    $('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.setAuthError('');
      this.h.onAuthSubmit(this.authMode, $('auth-user').value, $('auth-pass').value);
    });
    this.el.seed.addEventListener('input', () => {
      const v = this.el.seed.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v !== this.el.seed.value) this.el.seed.value = v;
    });
  }

  get modalOpen() {
    const e = this.el;
    return !e.reward.hidden || !e.menu.hidden || !e.over.hidden || !e.start.hidden || !e.saves.hidden || !e.account.hidden || !e.board.hidden;
  }

  /** Ist ein Dialog über dem Hauptmenü bzw. Spiel offen (Spielstände, Konto, Bestenliste)? */
  get overlayOpen() {
    return !this.el.saves.hidden || !this.el.account.hidden || !this.el.board.hidden;
  }

  seedInput() {
    return this.el.seed.value.trim();
  }

  setSeedInput(seed) {
    this.el.seed.value = seed || '';
  }

  // ---------------------------------------------------------------- Bildschirme
  showStart(best) {
    for (const k of ['over', 'menu', 'reward', 'saves', 'account', 'board']) this.el[k].hidden = true;
    this.el.start.hidden = false;
    this.el.hud.hidden = true;
    this.el.bar.hidden = true;
    this.el.paused.hidden = true;
    document.body.classList.add('at-start');
    this.el.best.textContent = best
      ? `Rekord: ${best.score} Fahrgäste · Woche ${best.week}`
      : 'Noch kein Rekord – leg los!';
  }

  showGame() {
    for (const k of ['start', 'over', 'menu', 'reward', 'saves', 'account', 'board']) this.el[k].hidden = true;
    this.el.hud.hidden = false;
    this.el.bar.hidden = false;
    document.body.classList.remove('at-start');
    this.sig = {};
  }

  showMenu(show, meta = '') {
    this.el.menu.hidden = !show;
    if (show) $('menu-meta').textContent = meta;
  }

  /** Knopf „Weiterspielen“ im Hauptmenü (letzter Autosave). */
  setContinue(entry) {
    const b = $('btn-continue');
    b.hidden = !entry;
    if (entry) b.title = `${entry.meta.area} · Woche ${entry.meta.week} · ${entry.meta.score} Fahrgäste`;
  }

  showReward(game, week, options, onChoose) {
    this.rewardChoices = { options, onChoose };
    this.el.rewardWeek.textContent = `Woche ${week}`;
    const nextColor = game.nextLineColor();
    this.el.rewardCards.innerHTML = options
      .map((k, i) => {
        const r = REWARDS[k];
        const icon = k === 'line' ? ICONS.line(nextColor.hex) : ICONS[k];
        const text = k === 'line' ? `Linie ${nextColor.name} wird freigeschaltet.` : r.text;
        return `<button class="card" data-index="${i}" data-kind="${k}">
          <span class="card-icon">${icon}</span>
          <span class="card-title">${r.title}</span>
          <span class="card-text">${text}</span>
          <span class="card-key">${i + 1}</span>
        </button>`;
      })
      .join('');
    this.el.reward.hidden = false;
    const first = this.el.rewardCards.querySelector('.card');
    if (first) first.focus({ preventScroll: true });
  }

  chooseReward(i) {
    if (!this.rewardChoices || this.el.reward.hidden) return;
    const { options, onChoose } = this.rewardChoices;
    if (i < 0 || i >= options.length) return;
    this.rewardChoices = null;
    // Fokus der Karte freigeben, sonst schluckt der versteckte Knopf die nächste Leertaste
    if (this.el.reward.contains(document.activeElement)) document.activeElement.blur();
    this.el.reward.hidden = true;
    onChoose(options[i]);
  }

  showGameOver(sum, best, record, note = '') {
    $('over-eyebrow').textContent = `Game Over · Woche ${sum.week}, ${sum.dayLong}`;
    $('over-title').textContent = `${sum.station} ist überfüllt`;
    $('over-score').textContent = sum.score;
    $('over-record').hidden = !record;
    const rows = [
      ['Spielzeit', formatTime(sum.time)],
      ['Stationen', sum.stations],
      ['Linien', sum.lines],
      ['Gondeln', sum.gondolas],
      ['Umstiege', sum.transfers],
      ['Masten', sum.masts],
      ['Längste Linie', `${sum.longest} St.`],
      ['Rekord', best ? `${best.score}` : `${sum.score}`],
    ];
    $('over-stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('over-meta').textContent = `Seed ${sum.seed} · Start: ${sum.area}${note ? ` · ${note}` : ''}`;
    this.el.paused.hidden = true;
    this.el.over.hidden = false;
    $('btn-again').focus({ preventScroll: true });
  }

  setGameOverNote(text) {
    const el = $('over-meta');
    if (!el.dataset.base) el.dataset.base = el.textContent;
    el.textContent = `${el.dataset.base} · ${text}`;
  }

  // ---------------------------------------------------------------- Spielstände
  /**
   * entries: [{ id, label, kind: 'auto'|'slot', source: 'local'|'server', meta|null, empty }]
   * mode: 'load' | 'save'
   */
  showSaves({ mode, entries, note = '', canImport = false }) {
    this.saveEntries = entries;
    $('saves-title').textContent = mode === 'save' ? 'Speichern' : 'Laden';
    $('saves-list').innerHTML = entries
      .map((e, i) => {
        const m = e.meta;
        const info = m
          ? `<span class="save-main">Woche ${esc(m.week)} · ${esc(m.score)} Fahrgäste · ${esc(m.area)}</span>
             <span class="save-sub">${esc(formatDate(m.savedAt))} · Seed ${esc(m.seed)}</span>`
          : '<span class="save-main empty">leer</span>';
        const src =
          e.source === 'server'
            ? '<span class="tag server">Konto</span>'
            : e.source === 'both'
              ? '<span class="tag server">Lokal + Konto</span>'
              : '<span class="tag">Lokal</span>';
        const actions = [];
        if (mode === 'save' && e.kind === 'slot') actions.push(`<button class="btn small primary" data-action="save" data-index="${i}">${m ? 'Überschreiben' : 'Speichern'}</button>`);
        if (mode === 'load' && m) actions.push(`<button class="btn small primary" data-action="load" data-index="${i}">Laden</button>`);
        if (m) actions.push(`<button class="btn small ghost" data-action="delete" data-index="${i}" aria-label="${esc(e.label)} löschen">Löschen</button>`);
        return `<div class="save-row${m ? '' : ' is-empty'}">
          <div class="save-info"><span class="save-label">${esc(e.label)} ${src}</span>${info}</div>
          <div class="save-actions">${actions.join('')}</div>
        </div>`;
      })
      .join('');
    $('saves-note').textContent = note;
    $('btn-import').hidden = !canImport;
    this.el.saves.hidden = false;
  }

  hideSaves() {
    this.el.saves.hidden = true;
  }

  // ---------------------------------------------------------------- Konto
  setAuthMode(mode) {
    this.authMode = mode;
    for (const tab of document.querySelectorAll('#auth-form .tab')) {
      const on = tab.dataset.mode === mode;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    }
    $('auth-submit').textContent = mode === 'register' ? 'Konto anlegen' : 'Anmelden';
    $('auth-pass').setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
    $('auth-hint').hidden = mode !== 'register';
    this.setAuthError('');
  }

  setAuthError(msg) {
    $('auth-error').textContent = msg || '';
  }

  setAuthBusy(busy) {
    $('auth-submit').disabled = busy;
  }

  showAccount({ available, user, scores = [] }) {
    $('account-offline').hidden = available;
    $('auth-form').hidden = !available || !!user;
    $('account-info').hidden = !user;
    $('account-title').textContent = user ? 'Dein Konto' : 'Anmelden';
    if (user) {
      $('account-name').textContent = user.username;
      $('my-scores').innerHTML = scores.length
        ? scores.map((s) => `<li><b>${esc(s.score)}</b> Fahrgäste · Woche ${esc(s.week)} · ${esc(s.area)} <span class="muted">${esc(formatDate(s.createdAt))}</span></li>`).join('')
        : '<li class="muted">Noch keine Runden gespeichert.</li>';
    } else {
      this.setAuthMode(this.authMode);
      $('auth-pass').value = '';
    }
    this.el.account.hidden = false;
    if (!user && available) setTimeout(() => $('auth-user').focus({ preventScroll: true }), 30);
  }

  hideAccount() {
    this.el.account.hidden = true;
  }

  showBoard(rows, me) {
    $('board-list').innerHTML = rows.length
      ? rows
          .map((r) => `<li class="${me && r.username === me.username ? 'me' : ''}"><b>${esc(r.score)}</b> ${esc(r.username)} <span class="muted">Woche ${esc(r.week)} · ${esc(r.area)}</span></li>`)
          .join('')
      : '<li class="muted">Noch keine Einträge – spiel die erste Runde!</li>';
    this.el.board.hidden = false;
  }

  hideBoard() {
    this.el.board.hidden = true;
  }

  /** Angemeldeten Namen klein in der Ecke zeigen; Knöpfe im Hauptmenü anpassen. */
  setUser(user, available) {
    this.el.userChip.hidden = !user;
    this.el.userName.textContent = user ? user.username : '';
    $('btn-account').textContent = user ? 'Konto' : 'Anmelden';
    $('btn-board').hidden = !available;
  }

  toast(msg, ms = 3200) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- Laufende Aktualisierung
  set(key, value, fn) {
    if (this.sig[key] === value) return;
    this.sig[key] = value;
    fn(value);
  }

  update(game, state) {
    const el = this.el;
    this.set('muted', state.muted, (m) => {
      el.sound.innerHTML = m ? ICONS.mute : ICONS.sound;
      el.sound.setAttribute('aria-pressed', String(m));
      $('start-sound').textContent = m ? 'Ton: aus' : 'Ton: an';
    });
    if (!game || game.demo) return;
    this.set('score', game.score, (v) => (el.score.textContent = v));
    this.set('clock', game.clockText(), (v) => (el.clockDay.textContent = v));
    this.set('week', game.week, (v) => (el.clockWeek.textContent = `Woche ${v}`));
    this.set('meta', `${game.seed}|${game.startArea.name}`, () => {
      el.hudMeta.textContent = `Seed ${game.seed} · ${game.startArea.name}`;
    });
    const dayFrac = (game.totalHours % 24) / 24;
    el.clockArc.style.strokeDashoffset = String(87.96 * (1 - dayFrac));
    const night = nightness(game.hour) > 0.5;
    this.set('night', night, (n) => el.clockArc.classList.toggle('night', n));
    this.set('sky', Math.round(game.hour * 4), () => {
      const c = skyColors(game.hour);
      el.illimani.style.setProperty('--mtn', c.mtn);
      el.illimani.style.setProperty('--snow', c.snow);
    });
    this.set('rush', rushFactor(game.hour) > 1.25, (r) => (el.rush.hidden = !r));
    this.set('paused', state.paused && game.state === 'playing' && el.menu.hidden, (p) => (el.paused.hidden = !p));
    this.set('pauseBtn', state.paused, (p) => {
      el.pause.innerHTML = p ? ICONS.play : ICONS.pause;
      el.pause.setAttribute('aria-label', p ? 'Weiter (Leertaste)' : 'Pause (Leertaste)');
    });
    this.set('speed', state.speed, (s) => {
      el.speed.textContent = `${s}×`;
      el.speed.classList.toggle('active', s > 1);
    });
    this.set('center', !!state.manualCamera, (m) => (el.center.hidden = !m));

    // Linienpunkte
    const sel = state.selectedLine && game.lines.includes(state.selectedLine) ? state.selectedLine : null;
    const slots = [];
    for (let i = 0; i < game.res.lines; i++) {
      const l = game.lines.find((x) => x.slot === i);
      slots.push(l ? (l.active ? `a${l.gondolas.length ? '' : '0'}` : 'c') : 'f');
    }
    const freeSlots = game.freeSlots();
    const pref = freeSlots.includes(state.preferredSlot) ? state.preferredSlot : freeSlots[0];
    const dotSig = `${slots.join(',')}|${sel ? sel.slot : -1}|${pref}`;
    this.set('dots', dotSig, () => {
      el.dots.innerHTML = slots
        .map((s, i) => {
          const c = LINE_COLORS[i];
          const cls = ['dot'];
          if (s.startsWith('a')) cls.push('used');
          if (s === 'a0') cls.push('nogondola');
          if (s === 'c') cls.push('closing');
          if (s === 'f') cls.push('free');
          if (sel && sel.slot === i) cls.push('selected');
          if (s === 'f' && i === pref) cls.push('next');
          if (c.light) cls.push('light');
          const label =
            s === 'f'
              ? `Linie ${c.name} (frei)${i === pref ? ' – wird als Nächstes gebaut' : ''}`
              : s === 'c'
                ? `Linie ${c.name} wird abgebaut`
                : `Linie ${c.name} auswählen`;
          return `<button class="${cls.join(' ')}" data-slot="${i}" style="--c:${c.hex}" title="${label}" aria-label="${label}"></button>`;
        })
        .join('');
    });
    this.set('del', sel && sel.active ? sel.slot : -1, (s) => {
      el.del.hidden = s < 0;
      if (s >= 0) el.del.style.setProperty('--c', LINE_COLORS[s].hex);
    });

    // Ressourcen
    const counts = {
      gondola: game.gondolasFree,
      masts: game.mastsFree,
      tall: game.tallMastsFree,
      cabin: game.cabinsFree,
      interchange: game.interchangesFree,
    };
    this.set('tallShown', game.res.tallMasts > 0, (v) => (this.res.tall.btn.hidden = !v));
    for (const [k, n] of Object.entries(counts)) {
      this.set(`res-${k}`, n, (v) => {
        const r = this.res[k];
        r.count.textContent = v;
        r.btn.classList.toggle('empty', v <= 0);
        r.btn.classList.remove('pop');
        void r.btn.offsetWidth;
        r.btn.classList.add('pop');
      });
    }
  }
}

