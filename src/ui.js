// DOM-Oberfläche: HUD, untere Leiste, Start-, Belohnungs-, Pause-, Game-Over-, Spielstand-,
// Konto- und Bestenlisten-Dialoge. Reiner Controller – die Logik steckt in main.js.
import { CONFIG, LINE_COLORS } from './config.js';
import { nightness, rushFactor } from './game.js';
import { LANGS, getLang, setLang, onLangChange, applyStatic, t, colorName, dayShort, dayLong, areaName, slotLabel, formatDate } from './i18n.js';

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
          this.toast(t('res.mastsInfo'), 4500);
          return;
        }
        if (kind === 'tall') {
          this.toast(t('res.tallInfo'), 4500);
          return;
        }
        if (btn.classList.contains('empty')) {
          this.toast(t(`res.empty.${kind}`));
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

    // Sprachauswahl (Startbildschirm und Pausenmenü)
    this.last = {};
    for (const box of document.querySelectorAll('.lang-switch')) {
      box.innerHTML = LANGS.map(
        (l) => `<button type="button" class="lang-btn" data-lang="${l.id}" lang="${l.id}" title="${l.label}" aria-label="${l.label}">${l.short}</button>`,
      ).join('');
      box.addEventListener('click', (e) => {
        const b = e.target.closest('.lang-btn');
        if (b) setLang(b.dataset.lang);
      });
    }
    onLangChange(() => this.refreshLang());
    this.refreshLang(true);
  }

  /** Texte nach einem Sprachwechsel neu setzen – auch in gerade offenen Dialogen. */
  refreshLang(initial = false) {
    applyStatic();
    for (const b of document.querySelectorAll('.lang-btn')) {
      const on = b.dataset.lang === getLang();
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.sig = {};
    if (initial) return;
    const L = this.last;
    // Nur den Text erneuern – showStart() würde offene Dialoge (Spielstände, Konto, Bestenliste) schließen
    if (!this.el.start.hidden) this.renderBest(L.best);
    if (!this.el.reward.hidden && L.reward) this.renderReward(...L.reward);
    if (!this.el.over.hidden && L.over) this.renderGameOver(...L.over);
    if (!this.el.saves.hidden && L.saves) this.showSaves(L.saves);
    if (!this.el.account.hidden && L.account) this.renderAccount(L.account);
    if (!this.el.board.hidden && L.board) this.showBoard(...L.board);
    if (!this.el.menu.hidden && L.menu) this.showMenu(true, L.menu);
    if (L.user !== undefined) this.setUser(L.user, L.available);
    if (L.cont !== undefined) this.setContinue(L.cont);
    this.setAuthMode(this.authMode, true);
    this.setAuthError(this.authError);
    if (this.h.onLangChange) this.h.onLangChange();
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
    this.last.best = best;
    for (const k of ['over', 'menu', 'reward', 'saves', 'account', 'board']) this.el[k].hidden = true;
    this.el.start.hidden = false;
    this.el.hud.hidden = true;
    this.el.bar.hidden = true;
    this.el.paused.hidden = true;
    document.body.classList.add('at-start');
    this.renderBest(best);
  }

  renderBest(best) {
    this.el.best.textContent = best ? t('start.best', { n: best.score, score: best.score, week: best.week }) : t('start.noBest');
  }

  showGame() {
    for (const k of ['start', 'over', 'menu', 'reward', 'saves', 'account', 'board']) this.el[k].hidden = true;
    this.el.hud.hidden = false;
    this.el.bar.hidden = false;
    document.body.classList.remove('at-start');
    this.sig = {};
  }

  /** meta: { seed, area } der laufenden Runde */
  showMenu(show, meta = null) {
    this.el.menu.hidden = !show;
    if (show) this.last.menu = meta;
    if (show && meta) $('menu-meta').textContent = t('menu.meta', { seed: meta.seed, area: areaName(meta.area) });
  }

  /** Knopf „Weiterspielen“ im Hauptmenü (letzter Autosave). */
  setContinue(entry) {
    this.last.cont = entry;
    const b = $('btn-continue');
    b.hidden = !entry;
    if (entry) {
      b.title = t('start.continueTitle', { n: entry.meta.score, area: areaName(entry.meta.area), week: entry.meta.week, score: entry.meta.score });
    }
  }

  showReward(game, week, options, onChoose) {
    this.rewardChoices = { options, onChoose };
    this.renderReward(game, week, options);
    this.el.reward.hidden = false;
    const first = this.el.rewardCards.querySelector('.card');
    if (first) first.focus({ preventScroll: true });
  }

  renderReward(game, week, options) {
    this.last.reward = [game, week, options];
    this.el.rewardWeek.textContent = t('reward.week', { n: week });
    const nextColor = game.nextLineColor();
    const params = {
      color: colorName(LINE_COLORS.indexOf(nextColor)),
      big: CONFIG.bigCabinCapacity,
      normal: CONFIG.gondolaCapacity,
      cap: CONFIG.interchangeCapacity,
    };
    this.el.rewardCards.innerHTML = options
      .map((k, i) => {
        const icon = k === 'line' ? ICONS.line(nextColor.hex) : ICONS[k];
        return `<button class="card" data-index="${i}" data-kind="${esc(k)}">
          <span class="card-icon">${icon}</span>
          <span class="card-title">${esc(t(`reward.${k}.title`))}</span>
          <span class="card-text">${esc(t(`reward.${k}.text`, params))}</span>
          <span class="card-key">${i + 1}</span>
        </button>`;
      })
      .join('');
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

  showGameOver(sum, best, record) {
    this.overNote = null;
    this.renderGameOver(sum, best, record);
    this.el.paused.hidden = true;
    this.el.over.hidden = false;
    $('btn-again').focus({ preventScroll: true });
  }

  renderGameOver(sum, best, record) {
    this.last.over = [sum, best, record];
    $('over-eyebrow').textContent = t('over.eyebrow', { week: sum.week, day: dayLong(sum.day - 1) });
    $('over-title').textContent = sum.station ? t('over.title', { station: sum.station }) : t('over.titleDefault');
    $('over-score').textContent = sum.score;
    $('over-record').hidden = !record;
    const rows = [
      ['over.stat.time', formatTime(sum.time)],
      ['over.stat.stations', sum.stations],
      ['over.stat.lines', sum.lines],
      ['over.stat.gondolas', sum.gondolas],
      ['over.stat.transfers', sum.transfers],
      ['over.stat.masts', sum.masts],
      ['over.stat.longest', t('over.stat.longestValue', { n: sum.longest })],
      ['over.stat.best', best ? `${best.score}` : `${sum.score}`],
    ];
    $('over-stats').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`).join('');
    const meta = t('over.meta', { seed: sum.seed, area: areaName(sum.area) });
    const note = this.overNote ? t(this.overNote.key, this.overNote.params) : '';
    $('over-meta').textContent = note ? `${meta} · ${note}` : meta;
  }

  /** Zusatz unter dem Game-Over-Ergebnis (z. B. Bestenliste); wird bei Sprachwechsel mit übersetzt. */
  setGameOverNote(key, params = {}) {
    this.overNote = { key, params };
    if (this.last.over) this.renderGameOver(...this.last.over);
  }

  // ---------------------------------------------------------------- Spielstände
  /**
   * entries: [{ id, label, kind: 'auto'|'slot', source: 'local'|'server', meta|null, empty }]
   * mode: 'load' | 'save'
   */
  /** note: { key, params } – wird bei Sprachwechsel mit übersetzt. */
  showSaves({ mode, entries, note = null, canImport = false }) {
    this.last.saves = { mode, entries, note, canImport };
    this.saveEntries = entries;
    $('saves-title').textContent = t(mode === 'save' ? 'saves.titleSave' : 'saves.titleLoad');
    $('saves-list').innerHTML = entries
      .map((e, i) => {
        const m = e.meta;
        const label = slotLabel(e.id);
        const info = m
          ? `<span class="save-main">${esc(t('saves.main', { n: m.score, week: m.week, score: m.score, area: areaName(m.area) }))}</span>
             <span class="save-sub">${esc(t('saves.sub', { date: formatDate(m.savedAt), seed: m.seed }))}</span>`
          : `<span class="save-main empty">${esc(t('saves.empty'))}</span>`;
        const src =
          e.source === 'server'
            ? `<span class="tag server">${esc(t('saves.tagServer'))}</span>`
            : e.source === 'both'
              ? `<span class="tag server">${esc(t('saves.tagBoth'))}</span>`
              : `<span class="tag">${esc(t('saves.tagLocal'))}</span>`;
        const actions = [];
        if (mode === 'save' && e.kind === 'slot') {
          actions.push(`<button class="btn small primary" data-action="save" data-index="${i}">${esc(t(m ? 'saves.overwrite' : 'saves.save'))}</button>`);
        }
        if (mode === 'load' && m) actions.push(`<button class="btn small primary" data-action="load" data-index="${i}">${esc(t('saves.load'))}</button>`);
        if (m) {
          actions.push(
            `<button class="btn small ghost" data-action="delete" data-index="${i}" aria-label="${esc(t('saves.deleteAria', { slot: label }))}">${esc(t('saves.delete'))}</button>`,
          );
        }
        return `<div class="save-row${m ? '' : ' is-empty'}">
          <div class="save-info"><span class="save-label">${esc(label)} ${src}</span>${info}</div>
          <div class="save-actions">${actions.join('')}</div>
        </div>`;
      })
      .join('');
    $('saves-note').textContent = note ? t(note.key, note.params) : '';
    $('btn-import').hidden = !canImport;
    this.el.saves.hidden = false;
  }

  hideSaves() {
    this.el.saves.hidden = true;
  }

  // ---------------------------------------------------------------- Konto
  setAuthMode(mode, keepError = false) {
    this.authMode = mode;
    for (const tab of document.querySelectorAll('#auth-form .tab')) {
      const on = tab.dataset.mode === mode;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    }
    $('auth-submit').textContent = t(mode === 'register' ? 'account.submitRegister' : 'account.submitLogin');
    $('auth-pass').setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
    $('auth-hint').hidden = mode !== 'register';
    if (!keepError) this.setAuthError('');
  }

  /** e: Schlüssel im Wörterbuch, Fehlerobjekt oder leer – wird bei Sprachwechsel neu übersetzt. */
  setAuthError(e) {
    this.authError = e || null;
    $('auth-error').textContent = !e ? '' : typeof e === 'string' ? t(e) : e.message;
  }

  setAuthBusy(busy) {
    $('auth-submit').disabled = busy;
  }

  showAccount({ available, user, scores = [] }) {
    this.renderAccount({ available, user, scores });
    if (!user) {
      this.setAuthMode(this.authMode);
      $('auth-pass').value = '';
    }
    this.el.account.hidden = false;
    if (!user && available) setTimeout(() => $('auth-user').focus({ preventScroll: true }), 30);
  }

  renderAccount({ available, user, scores = [] }) {
    this.last.account = { available, user, scores };
    $('account-offline').hidden = available;
    $('auth-form').hidden = !available || !!user;
    $('account-info').hidden = !user;
    $('account-title').textContent = t(user ? 'account.titleUser' : 'account.titleLogin');
    if (user) {
      $('account-name').textContent = user.username;
      $('my-scores').innerHTML = scores.length
        ? scores
            .map(
              (s) =>
                `<li><b>${esc(s.score)}</b> ${esc(t('scores.row', { n: s.score, week: s.week, area: areaName(s.area) }))} <span class="muted">${esc(formatDate(s.createdAt))}</span></li>`,
            )
            .join('')
        : `<li class="muted">${esc(t('account.noScores'))}</li>`;
    }
  }

  hideAccount() {
    this.el.account.hidden = true;
  }

  showBoard(rows, me) {
    this.last.board = [rows, me];
    $('board-list').innerHTML = rows.length
      ? rows
          .map(
            (r) =>
              `<li class="${me && r.username === me.username ? 'me' : ''}"><b>${esc(r.score)}</b> ${esc(r.username)} <span class="muted">${esc(t('board.row', { week: r.week, area: areaName(r.area) }))}</span></li>`,
          )
          .join('')
      : `<li class="muted">${esc(t('board.empty'))}</li>`;
    this.el.board.hidden = false;
  }

  hideBoard() {
    this.el.board.hidden = true;
  }

  /** Angemeldeten Namen klein in der Ecke zeigen; Knöpfe im Hauptmenü anpassen. */
  setUser(user, available) {
    this.last.user = user;
    this.last.available = available;
    this.el.userChip.hidden = !user;
    this.el.userName.textContent = user ? user.username : '';
    $('btn-account').textContent = t(user ? 'start.account' : 'start.login');
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
      $('start-sound').textContent = t(m ? 'start.soundOff' : 'start.soundOn');
    });
    if (!game || game.demo) return;
    this.set('score', game.score, (v) => (el.score.textContent = v));
    const h = Math.floor(game.hour);
    const mm = Math.floor((game.hour - h) * 6) * 10;
    const clock = `${dayShort(game.dayIndex)} ${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    this.set('clock', clock, (v) => (el.clockDay.textContent = v));
    this.set('week', game.week, (v) => (el.clockWeek.textContent = t('hud.week', { n: v })));
    this.set('meta', `${game.seed}|${game.startArea.name}`, () => {
      el.hudMeta.textContent = t('hud.meta', { seed: game.seed, area: areaName(game.startArea.name) });
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
      el.pause.setAttribute('aria-label', t(p ? 'hud.resume' : 'hud.pause'));
      el.pause.setAttribute('title', t(p ? 'hud.resume' : 'hud.pause'));
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
          const color = colorName(i);
          const label = esc(
            s === 'f'
              ? t(i === pref ? 'dots.freeNext' : 'dots.free', { color })
              : s === 'c'
                ? t('dots.closing', { color })
                : t('dots.select', { color }),
          );
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

