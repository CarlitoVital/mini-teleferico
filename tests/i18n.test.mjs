// Wörterbücher: vollständig, gleiche Platzhalter, und jeder verwendete Schlüssel existiert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import de from '../src/lang/de.js';
import en from '../src/lang/en.js';
import es from '../src/lang/es.js';
import { t, setLang, getLang, colorName, areaName, slotLabel, dayLong, buildingName } from '../src/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = { de, en, es };

const placeholders = (v) => {
  const texts = typeof v === 'string' ? [v] : Array.isArray(v) ? [] : Object.values(v);
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
};

test('Alle Sprachen haben dieselben Schlüssel', () => {
  const keys = Object.keys(de).sort();
  for (const [id, dict] of Object.entries(LANGS)) {
    assert.deepEqual(Object.keys(dict).sort(), keys, `Schlüssel in ${id}`);
  }
});

test('Gleiche Platzhalter, Pluralformen und Listenlängen', () => {
  for (const [key, ref] of Object.entries(de)) {
    for (const [id, dict] of Object.entries(LANGS)) {
      const v = dict[key];
      assert.equal(typeof v, typeof ref, `${id}:${key} Typ`);
      if (Array.isArray(ref)) {
        assert.equal(v.length, ref.length, `${id}:${key} Länge`);
        assert.ok(v.every((x) => typeof x === 'string' && x), `${id}:${key} Einträge`);
        continue;
      }
      if (typeof ref === 'object') assert.deepEqual(Object.keys(v).sort(), Object.keys(ref).sort(), `${id}:${key} Pluralformen`);
      // Pluralform „one“ darf die Zahl ausschreiben statt {n} zu verwenden
      const strip = (list) => list.filter((p) => p !== 'n');
      assert.deepEqual(strip(placeholders(v)), strip(placeholders(ref)), `${id}:${key} Platzhalter`);
      const texts = typeof v === 'string' ? [v] : Object.values(v);
      assert.ok(texts.every((s) => s.trim()), `${id}:${key} leer`);
    }
  }
});

/** Alle Schlüssel, die der Code literal verwendet (t('…'), data-i18n…="…"). */
function usedKeys() {
  const keys = new Set();
  const dir = path.join(ROOT, 'src');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([\w.-]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\bt\(\s*\w+\s*\?\s*'([\w.-]+)'\s*:\s*'([\w.-]+)'/g)) keys.add(m[1]).add(m[2]);
    for (const m of src.matchAll(/setGameOverNote\(\s*[^)]*?'([\w.-]+)'/g)) keys.add(m[1]);
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([\w.-]+)"/g)) keys.add(m[1]);
  return keys;
}

test('Jeder im Code verwendete Schlüssel existiert', () => {
  const missing = [...usedKeys()].filter((k) => !(k in de));
  assert.deepEqual(missing, []);
});

test('Server-Fehlercodes sind übersetzt', () => {
  const app = fs.readFileSync(path.join(ROOT, 'server', 'app.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'server', 'plausible.js'), 'utf8');
  const codes = new Set();
  for (const m of app.matchAll(/(?:fail\(\s*\d+,\s*|HttpError\([^;]*?,\s*|code:\s*|tooMany\([^)]*?,\s*|Gate\([^)]*?,\s*)'([a-zA-Z]+)'/g)) codes.add(m[1]);
  const msgBlock = app.slice(app.indexOf('const MSG = {'), app.indexOf('};', app.indexOf('const MSG = {')));
  for (const m of msgBlock.matchAll(/^\s+(\w+):/gm)) codes.add(m[1]);
  assert.ok(codes.size > 25, `nur ${codes.size} Codes gefunden`);
  const missing = [...codes].filter((c) => !(`err.${c}` in de));
  assert.deepEqual(missing, []);
});

test('t(): Platzhalter, Plural, Rückfall und Namen', () => {
  const before = getLang();
  try {
    setLang('en');
    assert.equal(t('hud.week', { n: 3 }), 'Week 3');
    assert.equal(t('toast.imported', { n: 1 }), '1 saved game copied to your account.');
    assert.equal(t('toast.imported', { n: 4 }), '4 saved games copied to your account.');
    assert.equal(t('gibt.es.nicht'), 'gibt.es.nicht');
    assert.equal(colorName(6), 'Light Blue');
    assert.equal(areaName('Zentrum'), 'City centre');
    assert.equal(areaName('El Alto'), 'El Alto');
    assert.equal(slotLabel('import-2'), 'Imported 2');
    assert.equal(slotLabel('slot-1'), 'Slot 1');
    assert.equal(buildingName({ kind: 'airport', name: 'Flughafen El Alto' }), 'El Alto Airport');
    assert.equal(buildingName({ kind: 'stadium', name: 'Estadio Hernando Siles' }), 'Estadio Hernando Siles');
    setLang('es');
    assert.equal(t('reason.masts', { n: 2, free: 0 }), 'Faltan torres: este tramo necesita 2 torres; disponibles: 0.');
    assert.equal(dayLong(8), 'martes');
    assert.equal(areaName('Zentrum'), 'Centro');
    setLang('de');
    assert.equal(t('reason.tall', { n: 1, free: 0 }), 'Hier braucht das Seil 1 hohen Mast über Gebäude – frei: 0.');
    assert.equal(colorName(0), 'Rot');
  } finally {
    setLang(before);
  }
});
