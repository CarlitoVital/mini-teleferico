// Stresstest der Spiellogik: zufällige Netzänderungen während des Betriebs.
// Prüft Invarianten (Fahrgastbilanz, Ressourcen, Gondel-/Linienzuordnung).
// Aufruf: node tools/stress.mjs [Runden]
import { Game } from '../src/game.js';
import { makeRng } from '../src/util.js';

const runs = Number(process.argv[2] || 30);
const dt = 1 / 30;

function check(game, seed) {
  const fail = (msg) => {
    throw new Error(`seed ${seed}, t=${game.time.toFixed(1)}: ${msg}`);
  };
  const { waiting, riding } = game.countPassengers();
  if (game.stats.spawned !== game.stats.delivered + waiting + riding) fail('Fahrgastbilanz');
  if (game.gondolasFree < 0) fail('negative Gondeln');
  if (game.mastsFree < 0) fail('negative Masten');
  if (game.cabinsFree < 0) fail('negative Kabinen');
  if (game.interchangesFree < 0) fail('negative Umsteigestationen');
  const slots = new Set();
  for (const l of game.lines) {
    if (slots.has(l.slot)) fail('Farbe doppelt vergeben');
    slots.add(l.slot);
    if (l.active && l.stations.length < 2) fail('aktive Linie mit < 2 Stationen');
    if (new Set(l.stations).size !== l.stations.length) fail('Station doppelt in Linie');
    for (const g of l.gondolas) if (!game.gondolas.includes(g)) fail('Gondel nur in Linie');
  }
  for (const g of game.gondolas) {
    if (!g.line.gondolas.includes(g)) fail('Gondel ohne Linienzuordnung');
    if (!game.lines.includes(g.line)) fail('Gondel auf entfernter Linie');
    if (g.riders.length > g.capacity) fail('Gondel überladen');
    if (!['dwell', 'move', 'fadeout'].includes(g.state)) fail(`unbekannter Zustand ${g.state}`);
    if (g.state === 'move' && (!g.from || !g.to)) fail('Fahrt ohne Strecke');
    if (g.state === 'dwell' && g.dwell > 20) fail('Gondel hängt an einer Station fest');
  }
  for (const s of game.stations) for (const p of s.waiting) if (p.transfers > 40) fail('Umsteige-Pingpong');
  for (const g of game.gondolas) for (const p of g.riders) if (p.transfers > 40) fail('Umsteige-Pingpong');
}

let totalEdits = 0;
for (let r = 0; r < runs; r++) {
  const seed = 500 + r * 104729;
  const rng = makeRng(seed ^ 0x9e3779b9);
  const game = new Game({ width: 1500 + r * 13, height: 900, seed });
  game.res = { lines: 6, gondolas: 10, masts: 8, cabins: 4, interchanges: 3 };
  let steps = 0;
  while (game.state !== 'over' && game.time < 900) {
    if (game.state === 'reward') game.chooseReward(game.rewardOptions[Math.floor(rng() * 2)]);
    if (++steps % 20 === 0) {
      const st = game.stations;
      const act = rng();
      const active = game.lines.filter((l) => l.active);
      const line = active[Math.floor(rng() * active.length)];
      const randomStation = () => st[Math.floor(rng() * st.length)];
      if (act < 0.25 && game.freeSlots().length) {
        const list = [...new Set([randomStation(), randomStation(), randomStation()])];
        if (list.length >= 2) game.createLine(game.freeSlots()[0], list);
      } else if (act < 0.45 && line) {
        const s = randomStation();
        if (!line.has(s)) game.setLineStations(line, rng() < 0.5 ? [...line.stations, s] : [s, ...line.stations]);
      } else if (act < 0.55 && line) {
        const s = randomStation();
        const i = Math.floor(rng() * (line.stations.length - 1));
        if (!line.has(s)) game.setLineStations(line, [...line.stations.slice(0, i + 1), s, ...line.stations.slice(i + 1)]);
      } else if (act < 0.65 && line) {
        const i = Math.floor(rng() * line.stations.length);
        game.setLineStations(line, line.stations.filter((_, k) => k !== i));
      } else if (act < 0.7 && line) {
        game.closeLine(line);
      } else if (act < 0.8 && game.gondolas.length) {
        const g = game.gondolas[Math.floor(rng() * game.gondolas.length)];
        const big = g.big;
        game.liftGondola(g);
        const target = active[Math.floor(rng() * active.length)];
        if (target && rng() < 0.8) game.addGondola(target, randomStation(), { big });
      } else if (act < 0.88 && line) {
        game.addGondola(line, randomStation());
      } else if (act < 0.94 && game.gondolas.length) {
        game.applyCabin(game.gondolas[Math.floor(rng() * game.gondolas.length)]);
      } else {
        game.applyInterchange(randomStation());
      }
      totalEdits++;
    }
    game.update(dt);
    check(game, seed);
  }
  console.log(`seed ${seed}: ${(game.time / 60).toFixed(1)} min, Score ${game.score}, Umstiege ${game.stats.transfers}, Zustand ${game.state}`);
}
console.log(`\nOK – ${runs} Runden, ${totalEdits} zufällige Netzänderungen, alle Invarianten erfüllt.`);
