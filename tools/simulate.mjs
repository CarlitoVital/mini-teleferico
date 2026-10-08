// Headless-Balancing-Simulation: lässt den Bot mehrere Runden spielen.
// Aufruf: node tools/simulate.mjs [Anzahl Runden] [Breite] [Höhe]
import { Game } from '../src/game.js';
import { AutoPlayer } from '../src/autoplay.js';

const runs = Number(process.argv[2] || 8);
const width = Number(process.argv[3] || 1900);
const height = Number(process.argv[4] || 900);
const dt = 1 / 30;
const results = [];

for (let r = 0; r < runs; r++) {
  const seed = 1000 + r * 7919;
  const game = new Game({ width, height, seed });
  const bot = new AutoPlayer(game);
  let steps = 0;
  while (game.state !== 'over' && game.time < 3600) {
    bot.update(dt);
    game.update(dt);
    if (++steps % 300 === 0) {
      const { waiting, riding } = game.countPassengers();
      if (game.stats.spawned !== game.stats.delivered + waiting + riding) {
        throw new Error(`Fahrgast-Bilanz stimmt nicht (seed ${seed}, t=${game.time.toFixed(1)})`);
      }
    }
  }
  const s = game.summary();
  results.push(s);
  console.log(
    `seed ${String(seed).padStart(6)}  ${(game.time / 60).toFixed(1).padStart(5)} min  Woche ${s.week}  ` +
      `Score ${String(s.score).padStart(4)}  Stationen ${s.stations}  Linien ${s.lines}  ` +
      `Gondeln ${s.gondolas}  Umstiege ${s.transfers}  Masten ${s.masts}  überfüllt: ${s.station}`,
  );
}

const mins = results.map((s) => s.time / 60).sort((a, b) => a - b);
const avg = mins.reduce((a, b) => a + b, 0) / mins.length;
console.log(`\nØ ${avg.toFixed(1)} min, Median ${mins[Math.floor(mins.length / 2)].toFixed(1)} min, ` +
  `Spanne ${mins[0].toFixed(1)}–${mins[mins.length - 1].toFixed(1)} min`);
