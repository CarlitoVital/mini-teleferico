// DOM-Oberfläche: HUD, untere Leiste, Start-, Belohnungs-, Pause- und Game-Over-Bildschirm.
import { CONFIG, LINE_COLORS } from './config.js';
import { REWARDS, nightness, rushFactor } from './game.js';

const $ = (id) => document.getElementById(id);

export const ICONS = {
  gondola: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M2 7.5 30 4.5" class="stroke"/><path d="M16 6v6" class="stroke"/><circle cx="16" cy="6" r="1.8"/><rect x="11" y="11" width="10" height="2" rx="1"/><rect x="8.5" y="13" width="15" height="12.5" rx="3.2" class="body"/><rect x="11" y="16" width="10" height="4.2" rx="1.2" class="win"/></svg>`,
  masts: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 8.5h26" class="stroke thin"/><path d="M12 28 15 9h2l3 19z"/><path d="M8.5 7h15v3h-15z"/><path d="M13.6 21.5 18 14.5M18.4 21.5 14 14.5M12.8 24.5h6.4" class="cut"/></svg>`,
  cabin: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3v6" class="stroke"/><circle cx="16" cy="3.5" r="1.8"/><rect x="3.5" y="9.5" width="25" height="15" rx="3.5" class="body"/><path d="M16 12.5v9M11.5 17h9" class="cut wide"/></svg>`,
  interchange: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" class="ring"/><circle cx="16" cy="16" r="6.5" class="ring"/></svg>`,
  line: (hex) =>
    `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 25 27 7" stroke="${hex}" stroke-width="5" stroke-linecap="round" fill="none"/><circle cx="5.5" cy="24.5" r="4" class="ring-s"/><circle cx="26.5" cy="7.5" r="4" class="ring-s"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" class="stroke"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m15.5 9.5 5 5m0-5-5 5" class="stroke"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" class="stroke"/></svg>`,
};

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
      clockSun: $('clock-sun'),
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
      best: $('best'),
      pause: $('btn-pause'),
      speed: $('btn-speed'),
      sound: $('btn-sound'),
    };
    this.sig = {};
    this.toastTimer = 0;
    this.rewardChoices = null;

    this.el.menuBtn = $('btn-menu');
    this.el.menuBtn.innerHTML = ICONS.menu;
    this.el.pause.addEventListener('click', () => this.h.onPause());
    this.el.speed.addEventListener('click', () => this.h.onSpeed());
    this.el.sound.addEventListener('click', () => this.h.onSound());
    this.el.menuBtn.addEventListener('click', () => this.h.onMenu());
    $('btn-play').addEventListener('click', () => this.h.onPlay());
    $('btn-again').addEventListener('click', () => this.h.onPlay());
    $('btn-home').addEventListener('click', () => this.h.onHome());
    $('btn-resume').addEventListener('click', () => this.h.onResume());
    $('btn-restart').addEventListener('click', () => this.h.onPlay());
    $('btn-quit').addEventListener('click', () => this.h.onHome());
    $('start-sound').addEventListener('click', () => this.h.onSound());
    this.el.del.addEventListener('click', () => this.h.onDeleteLine());

    this.res = {};
    for (const btn of document.querySelectorAll('#resources .res')) {
      const kind = btn.dataset.kind;
      btn.insertAdjacentHTML('afterbegin', ICONS[kind]);
      this.res[kind] = { btn, count: btn.querySelector('.count') };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (kind === 'masts') {
          this.toast(
            `Masten werden automatisch gesetzt: Jede Strecke über ${CONFIG.maxSpan} m Spannweite oder über eine Schlucht braucht einen.`,
          );
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
  }

  get modalOpen() {
    return !this.el.reward.hidden || !this.el.menu.hidden || !this.el.over.hidden || !this.el.start.hidden;
  }

  // ---------------------------------------------------------------- Bildschirme
  showStart(best) {
    this.el.start.hidden = false;
    this.el.hud.hidden = true;
    this.el.bar.hidden = true;
    this.el.over.hidden = true;
    this.el.menu.hidden = true;
    this.el.reward.hidden = true;
    this.el.paused.hidden = true;
    this.el.best.textContent = best
      ? `Rekord: ${best.score} Fahrgäste · Woche ${best.week}`
      : 'Noch kein Rekord – leg los!';
  }

  showGame() {
    this.el.start.hidden = true;
    this.el.over.hidden = true;
    this.el.menu.hidden = true;
    this.el.reward.hidden = true;
    this.el.hud.hidden = false;
    this.el.bar.hidden = false;
    this.sig = {};
  }

  showMenu(show) {
    this.el.menu.hidden = !show;
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
    this.el.reward.hidden = true;
    onChoose(options[i]);
  }

  showGameOver(sum, best, record) {
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
    $('over-stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    this.el.paused.hidden = true;
    this.el.over.hidden = false;
    $('btn-again').focus({ preventScroll: true });
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
    const dayFrac = (game.totalHours % 24) / 24;
    el.clockArc.style.strokeDashoffset = String(87.96 * (1 - dayFrac));
    const night = nightness(game.hour) > 0.5;
    this.set('night', night, (n) => el.clockArc.classList.toggle('night', n));
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
      cabin: game.cabinsFree,
      interchange: game.interchangesFree,
    };
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
