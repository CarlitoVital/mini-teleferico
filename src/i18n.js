// Mehrsprachigkeit: Deutsch, Englisch, Spanisch.
// t('schlüssel', { name: 'x' }) liefert den Text der aktuellen Sprache; {name} wird ersetzt.
// Einträge der Form { one, other } wählen die Form über den Parameter n.
// Fehlt ein Schlüssel, gilt Deutsch, zuletzt der Schlüssel selbst.
import { storageGet, storageSet } from './util.js';
import de from './lang/de.js';
import en from './lang/en.js';
import es from './lang/es.js';

export const LANGS = [
  { id: 'de', label: 'Deutsch', short: 'DE', locale: 'de-DE' },
  { id: 'en', label: 'English', short: 'EN', locale: 'en-GB' },
  { id: 'es', label: 'Español', short: 'ES', locale: 'es-BO' },
];
const DICTS = { de, en, es };
const STORE_KEY = 'teleferico.lang';

function detect() {
  const stored = storageGet(STORE_KEY);
  if (stored && DICTS[stored]) return stored;
  try {
    const prefs = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [];
    for (const p of prefs) {
      const id = String(p || '').slice(0, 2).toLowerCase();
      if (DICTS[id]) return id;
    }
  } catch {
    // ohne navigator: Standard
  }
  return 'en';
}

let current = detect();
const listeners = new Set();

export function getLang() {
  return current;
}

export function locale() {
  return LANGS.find((l) => l.id === current).locale;
}

/** Sprache wechseln (wird im Browser gespeichert). */
export function setLang(id) {
  if (!DICTS[id] || id === current) return;
  current = id;
  storageSet(STORE_KEY, id);
  for (const fn of listeners) fn(id);
}

/** Wird bei jedem Sprachwechsel aufgerufen. Liefert eine Abmeldefunktion. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(key, lang) {
  const v = DICTS[lang][key];
  return v === undefined && lang !== 'de' ? DICTS.de[key] : v;
}

/** Gibt es diesen Schlüssel (in irgendeiner Sprache)? */
export function has(key) {
  return lookup(key, current) !== undefined;
}

const plural = {};
function pluralForm(n) {
  try {
    plural[current] ||= new Intl.PluralRules(current);
    return plural[current].select(n);
  } catch {
    return n === 1 ? 'one' : 'other';
  }
}

export function t(key, params = {}) {
  let v = lookup(key, current);
  if (v === undefined) return key;
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') v = v[pluralForm(Number(params.n))] ?? v.other;
  return String(v).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

// ---------------------------------------------------------------- Namen aus der Spielwelt
const SLOT_COLORS = 10;

/** Farbname einer Linienfarbe (Index oder Farbobjekt mit hex aus LINE_COLORS). */
export function colorName(slotOrIndex) {
  const names = t('colors');
  const i = Number(slotOrIndex);
  return Array.isArray(names) && i >= 0 && i < SLOT_COLORS ? names[i] : String(slotOrIndex);
}

export function shapeName(shape) {
  return t(`shape.${shape}`);
}

export function dayShort(dayIndex) {
  return t('days.short')[((dayIndex % 7) + 7) % 7];
}

export function dayLong(dayIndex) {
  return t('days.long')[((dayIndex % 7) + 7) % 7];
}

/** Startgebiet: interner Name (z. B. „Zentrum“) → Anzeige; Eigennamen bleiben. */
export function areaName(name) {
  const key = `area.${name}`;
  return has(key) ? t(key) : String(name ?? '');
}

/** Gebäudename für Hinweise: Gattungen übersetzt, Eigennamen (Stadien, Spitäler …) unverändert. */
export function buildingName(b) {
  if (!b) return '';
  if (b.kind === 'highrise' || b.kind === 'approach' || b.kind === 'airport') return t(`building.${b.kind}`);
  return b.name;
}

/** Bezeichnung eines Speicherplatzes. */
export function slotLabel(id) {
  const m = /^import-(\d+)$/.exec(id);
  if (m) return t('slot.import', { n: m[1] });
  return has(`slot.${id}`) ? t(`slot.${id}`) : String(id);
}

/** Datum und Uhrzeit im Format der Sprache. */
export function formatDate(ts) {
  if (!ts) return '';
  try {
    return new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

// ---------------------------------------------------------------- Statische Texte im HTML
const ATTRS = [
  ['data-i18n', (el, v) => (el.textContent = v)],
  ['data-i18n-html', (el, v) => (el.innerHTML = v)],
  ['data-i18n-title', (el, v) => el.setAttribute('title', v)],
  ['data-i18n-aria', (el, v) => el.setAttribute('aria-label', v)],
  ['data-i18n-placeholder', (el, v) => el.setAttribute('placeholder', v)],
];

/** Setzt alle mit data-i18n* markierten Texte (nur eigene, vertrauenswürdige Wörterbuchtexte). */
export function applyStatic(root = document) {
  for (const [attr, set] of ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) set(el, t(el.getAttribute(attr)));
  }
  if (root === document) {
    document.documentElement.lang = current;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', t('meta.description'));
  }
}
