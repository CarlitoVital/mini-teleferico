// Spielstände: Speichern → Laden muss exakt denselben Spielverlauf ergeben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { AutoPlayer } from '../src/autoplay.js';
import { serializeGame, deserializeGame, saveMeta, migrate, SAVE_VERSION } from '../src/save.js';

const DT = 1 / 60;

function playWithBot(seed, seconds) {
  const game = new Game({ seed, aspect: 1.8, area: 360000 });
  const bot = new AutoPlayer(game);
  while (game.time < seconds && game.state !== 'over') {
    bot.update(DT);
    game.update(DT);
  }
  return game;
}

function step(game, seconds) {
  const end = game.time + seconds;
  let guard = 0;
  while (game.time < end && game.state !== 'over' && guard++ < 1e6) {
    if (game.state === 'reward') game.chooseReward(game.rewardOptions[0]);
    game.update(DT);
  }
}

/** Zustand ohne Zeitstempel, als String vergleichbar. */
const snap = (game) => (game.state === 'over' ? `over:${game.score}:${game.overStation.name}:${game.time}` : JSON.stringify(serializeGame(game)));

for (const seed of ['SAVE1', 'ZONASUR', 'X7K9Q2']) {
  test(`Speichern und Laden ist verlustfrei und deterministisch (${seed})`, () => {
    const a = playWithBot(seed, 140);
    assert.notEqual(a.state, 'over', 'Runde sollte noch laufen');
    assert.ok(a.lines.length > 0 && a.gondolas.length > 0, 'Netz vorhanden');
    const data = JSON.parse(JSON.stringify(serializeGame(a, { x: 10, y: 20, scale: 1.5, manual: true })));
    const { game: b, camera } = deserializeGame(data);
    assert.deepEqual(camera, { x: 10, y: 20, scale: 1.5, manual: true });
    // Direkt nach dem Laden identisch …
    assert.equal(snap(b), snap(a));
    // … und auch nach weiterem Spielen (Passagiere, Gondeln, neue Stationen, Wochenwechsel)
    for (const secs of [5, 30, 90]) {
      step(a, secs);
      step(b, secs);
      assert.equal(snap(b), snap(a), `abweichend nach weiteren ${secs} s`);
    }
  });
}

test('Spielstand enthält Version, Seed, Inventar und alle Objekte', () => {
  const g = playWithBot('META', 60);
  const data = serializeGame(g);
  assert.equal(data.version, SAVE_VERSION);
  assert.equal(data.seed, 'META');
  assert.ok(Number.isInteger(data.rng));
  assert.equal(data.stations.length, g.stations.length);
  assert.equal(data.gondolas.length, g.gondolas.length);
  assert.ok('masts' in data.res && 'tallMasts' in data.res && 'gondolas' in data.res);
  const meta = saveMeta(g);
  assert.equal(meta.seed, 'META');
  assert.equal(meta.area, g.startArea.name);
  assert.equal(meta.score, g.score);
});

test('Ungültige oder neuere Spielstände werden abgelehnt', () => {
  assert.throws(() => migrate(null));
  assert.throws(() => migrate({}));
  assert.throws(() => migrate({ version: SAVE_VERSION + 1 }));
  const g = playWithBot('BROKEN', 20);
  const data = serializeGame(g);
  data.lines.push({ id: 99, slot: 9, state: 'active', created: 0, stations: [999] });
  assert.throws(() => deserializeGame(data));
});

test('Wochen-Belohnung bleibt beim Laden offen', () => {
  const g = new Game({ seed: 'REWARD', aspect: 1.8, area: 360000 });
  while (g.state !== 'reward') g.update(DT);
  const { game } = deserializeGame(JSON.parse(JSON.stringify(serializeGame(g))));
  assert.equal(game.state, 'reward');
  assert.deepEqual(game.rewardOptions, g.rewardOptions);
});

test('Geänderte Mastregeln: geladener Stand rutscht nicht ins Minus', () => {
  const g = playWithBot('MASTEN', 120);
  assert.ok(g.mastsUsed > 0, 'Netz mit Masten');
  const data = JSON.parse(JSON.stringify(serializeGame(g)));
  // Stand aus einer Version, in der dieselben Strecken weniger Masten brauchten
  data.res.masts = 0;
  data.res.tallMasts = 0;
  const { game } = deserializeGame(data);
  assert.ok(game.mastsFree >= 0, `frei: ${game.mastsFree}`);
  assert.ok(game.tallMastsFree >= 0, `hoch frei: ${game.tallMastsFree}`);
  assert.equal(game.res.masts, game.mastsUsed);
});
