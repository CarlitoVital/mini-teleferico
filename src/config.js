/**
 * Zentrale Spielkonstanten.
 * Längen sind Welt-Einheiten, Zeiten Spielsekunden (bei 1× = echte Sekunden).
 */
export const CONFIG = {
  // Zeit
  dayLength: 15, // Spielsekunden pro Tag (24 h)
  startHour: 6,

  // Stationen
  stationRadius: 11,
  stationCapacity: 6,
  interchangeCapacity: 12,
  stationMinDist: 84,
  overcrowdTime: 42, // Sekunden Überfüllung bis Game Over
  overcrowdRecover: 30, // Sekunden, bis ein voller Timer wieder leer ist

  // Linien & Seil
  maxLines: 10,
  maxSpan: 230, // maximale Spannweite ohne Mast
  lineWidth: 6,
  lineSpacing: 7, // Abstand paralleler Linien
  handleLength: 26,

  // Gondeln
  gondolaSpeed: 88,
  gondolaAccel: 125,
  gondolaCapacity: 6,
  bigCabinCapacity: 10,
  boardTime: 0.16,
  boardTimeInterchange: 0.07,
  minDwell: 0.45,

  // Höhe: bergauf langsamer, bergab etwas schneller
  elevRef: 450,
  uphillSlow: 0.25,
  downhillFast: 0.15,

  // Routing-Kosten
  hopCost: 1,
  hopCostPerUnit: 1 / 400,
  transferCost: 1.6,
  transferCostInterchange: 0.7,

  // Wachstum
  firstStationDelay: 8,
  stationBaseInterval: 19,
  stationRamp: 1.4, // Verkürzung pro Woche
  stationMinInterval: 7,
  passengerBaseInterval: 13,
  passengerRamp: 1.05,
  passengerMinInterval: 1.2, // wird erst spät erreicht: das Spiel endet garantiert
  rareShapeChance: 0.14,
  rareFromStations: 7,

  // Stadtbereich um den Startpunkt: Kantenlänge wächst bis Woche regionFullWeeks auf das
  // regionGrowth-Fache, danach langsam weiter bis regionMaxGrowth
  regionGrowth: 2.0,
  regionFullWeeks: 8,
  regionMaxGrowth: 2.6,
  maxBuildSlope: 1.9, // m Höhe pro 10 m: steiler ist kein Bauplatz

  // Startausstattung
  start: { lines: 3, gondolas: 3, masts: 4, tallMasts: 0, cabins: 0, interchanges: 0 },
};

/** Linienfarben, angelehnt an die Farbnamen des realen Netzes (name = interner Bezeichner; Anzeige: src/lang, „colors“). */
export const LINE_COLORS = [
  { name: 'Rot', hex: '#E03A3E' },
  { name: 'Gelb', hex: '#F4B400', light: true },
  { name: 'Grün', hex: '#2E9E58' },
  { name: 'Blau', hex: '#2B62C4' },
  { name: 'Orange', hex: '#F07A1B' },
  { name: 'Weiß', hex: '#FFFFFF', casing: '#8A8D94', light: true },
  { name: 'Hellblau', hex: '#38B2E3', light: true },
  { name: 'Violett', hex: '#7C4DB6' },
  { name: 'Braun', hex: '#8A593A' },
  { name: 'Silber', hex: '#B0B6BD', casing: '#878E96', light: true },
];

export const SHAPES = ['circle', 'triangle', 'square', 'diamond', 'star', 'cross'];
export const COMMON_SHAPES = ['circle', 'triangle', 'square'];
export const RARE_SHAPES = ['diamond', 'star', 'cross'];

export const INK = '#2A2A2E';
