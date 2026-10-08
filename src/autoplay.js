// Einfacher Bot: spielt im Hintergrund des Startbildschirms und dient der Balancing-Simulation.

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class AutoPlayer {
  constructor(game, opts = {}) {
    this.game = game;
    this.period = opts.period ?? 1.2;
    this.timer = opts.delay ?? 0.6;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.period;
    this.act();
  }

  act() {
    const g = this.game;
    if (g.state === 'reward') {
      g.chooseReward(this.pickReward(g.rewardOptions));
      return;
    }
    if (g.state !== 'playing') return;
    this.connectLoose();
    this.placeGondolas();
    this.placeCabins();
    this.placeInterchange();
  }

  connected() {
    const set = new Set();
    for (const l of this.game.lines) if (l.active) for (const s of l.stations) set.add(s);
    return set;
  }

  connectLoose() {
    const g = this.game;
    const conn = this.connected();
    const loose = g.stations
      .filter((s) => !conn.has(s) && g.time - s.born > 0.8)
      .sort((a, b) => b.waiting.length - a.waiting.length);
    for (const s of loose) if (this.connect(s, conn)) return;
  }

  connect(s, conn) {
    const g = this.game;
    const options = [];
    for (const l of g.lines) {
      if (!l.active) continue;
      const st = l.stations;
      for (const atEnd of [false, true]) {
        const t = atEnd ? st[st.length - 1] : st[0];
        const list = atEnd ? [...st, s] : [s, ...st];
        const v = g.validate(list, l);
        if (!v.ok) continue;
        options.push({ cost: d2(t, s) + 45 * (v.masts - l.mastCount) + st.length * 5, run: () => g.setLineStations(l, list) });
      }
      for (let i = 0; i < st.length - 1; i++) {
        const list = [...st.slice(0, i + 1), s, ...st.slice(i + 1)];
        const v = g.validate(list, l);
        if (!v.ok) continue;
        const detour = d2(st[i], s) + d2(s, st[i + 1]) - d2(st[i], st[i + 1]);
        options.push({ cost: detour * 1.1 + 45 * (v.masts - l.mastCount) + st.length * 5, run: () => g.setLineStations(l, list) });
      }
    }
    const slots = g.freeSlots();
    if (slots.length) {
      for (const t of g.stations) {
        if (t === s) continue;
        const list = [s, t];
        const v = g.validate(list);
        if (!v.ok) continue;
        const cost = d2(s, t) * 0.8 + 45 * v.masts + (t.shape === s.shape ? 70 : 0) + (conn.size && !conn.has(t) ? 90 : 0);
        options.push({ cost, run: () => g.createLine(slots[0], list) });
      }
    }
    if (!options.length) return false;
    options.sort((a, b) => a.cost - b.cost);
    return !!options[0].run();
  }

  lineLoad(l) {
    let w = 0;
    for (const s of l.stations) w += s.waiting.length;
    return w + l.stations.length * 3;
  }

  placeGondolas() {
    const g = this.game;
    // eine Gondel für die nächste neue Linie zurückhalten
    const reserve = g.freeSlots().length ? 1 : 0;
    let guard = 0;
    while (g.gondolasFree > 0 && guard++ < 10) {
      let best = null;
      let bestScore = -1;
      for (const l of g.lines) {
        if (!l.active) continue;
        if (l.gondolas.length && g.gondolasFree <= reserve) continue;
        const score = (l.gondolas.length ? 0 : 1000) + this.lineLoad(l) / (l.gondolas.length + 1);
        if (score > bestScore) {
          bestScore = score;
          best = l;
        }
      }
      if (!best) return;
      const busiest = best.stations.reduce((a, b) => (b.waiting.length > a.waiting.length ? b : a));
      if (!g.addGondola(best, busiest)) return;
    }
  }

  placeCabins() {
    const g = this.game;
    let guard = 0;
    while (g.cabinsFree > 0 && guard++ < 10) {
      const cands = g.gondolas.filter((x) => !x.big && x.line.active);
      if (!cands.length) return;
      cands.sort((a, b) => this.lineLoad(b.line) / b.line.gondolas.length - this.lineLoad(a.line) / a.line.gondolas.length);
      g.applyCabin(cands[0]);
    }
  }

  placeInterchange() {
    const g = this.game;
    if (g.interchangesFree <= 0) return;
    const conn = this.connected();
    const cands = g.stations.filter((s) => !s.interchange && conn.has(s));
    if (!cands.length) return;
    cands.sort((a, b) => b.waiting.length + b.overcrowd * 10 - (a.waiting.length + a.overcrowd * 10));
    g.applyInterchange(cands[0]);
  }

  pickReward(options) {
    const g = this.game;
    const conn = this.connected();
    const loose = g.stations.filter((s) => !conn.has(s)).length;
    if (options.includes('masts') && g.mastsFree <= 0) return 'masts';
    if (options.includes('line') && loose >= 2 && !g.freeSlots().length) return 'line';
    for (const k of ['gondola', 'line', 'cabin', 'interchange', 'masts']) if (options.includes(k)) return k;
    return options[0];
  }
}
