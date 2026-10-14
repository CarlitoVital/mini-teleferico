// Plausibilitätsprüfung für eingereichte Ergebnisse. Der Server kann eine Runde nicht nachspielen,
// aber er kennt die Spielregeln: Mehr Fahrgäste, als in der angegebenen Spielzeit überhaupt
// entstehen können, sind unmöglich – ebenso eine Woche, die nicht zur Spielzeit passt.
import { CONFIG } from '../src/config.js';
import { START_AREAS } from '../src/data/terrain.js';

export const AREA_NAMES = new Set(START_AREAS.map((a) => a.name));
export const SEED_RE = /^[A-Z0-9]{1,12}$/; // wie normalizeSeed() im Spiel

const WEEK_SECONDS = CONFIG.dayLength * 7;
const RUSH_MAX = 1.8; // Obergrenze von rushFactor() (Stoßzeit)
const MAX_STATIONS = 40; // Obergrenze von game.maxStations

/**
 * Obergrenze für die Zahl der Fahrgäste, die in `time` Spielsekunden entstehen können (und damit
 * für den Punktestand). Bewusst großzügig: Stationen erscheinen so schnell wie möglich, jede
 * erzeugt Fahrgäste im kürzesten Abstand und immer zur Stoßzeit.
 */
export function maxPlausibleScore(time) {
  let stations = 3;
  let spawned = 0;
  for (let t = 0; t < time; t++) {
    const dt = Math.min(1, time - t);
    const w = t / WEEK_SECONDS;
    const stationEvery =
      0.75 * Math.max(CONFIG.stationMinInterval, CONFIG.stationBaseInterval - CONFIG.stationRamp * w);
    const passengerEvery =
      0.55 * Math.max(CONFIG.passengerMinInterval, CONFIG.passengerBaseInterval - CONFIG.passengerRamp * w);
    stations = Math.min(MAX_STATIONS, stations + dt / stationEvery);
    spawned += (stations * RUSH_MAX * dt) / passengerEvery;
  }
  return Math.ceil(spawned * 1.1) + 20;
}

/** Woche, in der das Spiel nach `time` Spielsekunden steht (wie Game.week). */
export function weekAt(time) {
  const totalHours = CONFIG.startHour + (time / CONFIG.dayLength) * 24;
  return Math.floor(totalHours / 24 / 7) + 1;
}

/** { code, message } oder null, wenn das Ergebnis zu den Spielregeln passt. */
export function implausible({ score, week, seed, area, time }) {
  if (!AREA_NAMES.has(area)) return { code: 'scoreArea', message: 'Unbekanntes Startgebiet.' };
  if (!SEED_RE.test(seed)) return { code: 'scoreSeed', message: 'Ungültiger Seed.' };
  // Spielzeit wird gerundet übertragen – an einer Wochengrenze darf die Woche um eins abweichen
  if (Math.abs(week - weekAt(time)) > 1) return { code: 'scoreWeek', message: 'Woche passt nicht zur Spielzeit.' };
  if (score > maxPlausibleScore(time)) {
    return { code: 'scoreTooHigh', message: 'So viele Fahrgäste sind in dieser Spielzeit nicht möglich.' };
  }
  return null;
}
