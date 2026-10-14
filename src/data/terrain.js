// Geländedaten von La Paz und El Alto.
// Koordinaten in km ab der Nordwest-Ecke (x nach Osten, y nach Süden), Höhen in m.
// Abgelesen aus einer topografischen Karte (Maßstab 2 km ≈ 75 px) und ergänzt um bekannte Höhen;
// bewusst vereinfacht, aber in der relativen Lage stimmig.

export const MAP = {
  widthKm: 25.6,
  heightKm: 20.5,
  unitsPerKm: 100, // 1 Welt-Einheit = 10 m
  gridUnits: 10, // Auflösung der Heightmap in Welt-Einheiten
};

/** El-Alto-Hochplateau: alles westlich der Abbruchkante. */
export const PLATEAU = { base: 4030, northRise: 40, noise: 6 };

/** Die „Ceja“: Abbruchkante von El Alto, von Nord nach Süd (wird beim Laden gezackt verfeinert). */
export const CEJA = [
  [7.47, -0.4], [7.33, 2.67], [7.47, 5.33], [7.87, 6.93], [8.27, 8.0], [8.93, 9.07],
  [9.33, 10.4], [8.8, 11.47], [7.73, 12.13], [6.8, 12.8], [6.13, 13.6], [5.73, 14.93],
  [5.6, 16.53], [5.47, 18.4], [5.33, 20.9],
];

/** Breite des Steilabfalls an der Ceja in km. */
export const CEJA_WIDTH = 0.26;

/**
 * Hochflächen und Bergrücken östlich der Ceja (vor dem Einschneiden der Täler).
 * [x, y, Höhe] – wird per inverser Distanzgewichtung interpoliert.
 */
export const UPLAND = [
  // Norden
  [8.3, 0.3, 3990], [9.4, 1.6, 3950], [12.4, 0.4, 4120], [13.0, 2.0, 3980], [15.9, 0.6, 4230],
  [18.0, 1.0, 4330], [20.5, 0.6, 4420], [23.5, 0.8, 4460], [25.6, 2.2, 4400],
  // Nördliche Mitte
  [9.0, 4.2, 3920], [10.2, 4.8, 3830], [12.6, 3.9, 3860], [15.3, 4.3, 3920], [17.2, 3.5, 4120],
  [19.3, 5.0, 4200], [21.8, 3.6, 4300], [24.0, 4.3, 4330], [25.6, 4.0, 4280],
  // Talkessel und östliche Hänge
  [9.7, 6.6, 3800], [10.3, 8.4, 3760], [14.4, 5.6, 3880], [15.4, 7.3, 3880], [17.6, 5.8, 4000],
  [18.5, 8.2, 3950], [20.6, 6.6, 4100], [22.3, 7.0, 4180], [24.2, 7.8, 4150], [25.6, 8.2, 4100],
  // Llojeta, Obrajes, Irpavi
  [10.6, 10.0, 3720], [12.3, 9.8, 3640], [14.9, 9.6, 3640], [17.0, 9.6, 3760], [19.0, 9.8, 3850],
  [21.0, 9.4, 3980], [23.6, 10.8, 4000], [25.6, 11.0, 4050],
  // Rücken zwischen Llojeta und Achocalla, Cota Cota, Muela del Diablo
  [9.0, 12.9, 3920], [10.4, 12.6, 3830], [12.4, 12.8, 3650], [14.2, 13.0, 3560], [17.2, 13.6, 3500],
  [18.7, 14.2, 3700], [20.0, 15.0, 3830], [22.2, 14.3, 3950], [24.8, 15.2, 4020],
  // Achocalla-Becken (Rand) und Süden
  [6.6, 15.8, 3880], [7.8, 17.8, 3870], [6.5, 19.5, 3900], [9.8, 14.8, 3880], [11.4, 14.6, 3700],
  [12.6, 17.6, 3740], [14.6, 16.8, 3480], [15.5, 14.0, 3420], [19.6, 16.6, 3620], [21.4, 16.0, 3820],
  [23.6, 17.6, 3920], [25.6, 17.0, 3980], [8.6, 18.8, 3860], [10.6, 19.4, 3800], [13.4, 19.8, 3600],
  [15.8, 19.4, 3380], [20.4, 19.8, 3600], [22.8, 19.6, 3800], [25.6, 20.4, 3900],
];

/**
 * Flüsse und Bäche. Jeder Punkt: [x, y, Talsohle m, Schluchttiefe m, halbe Sohlenbreite km, Hangneigung?].
 * slope: Hangneigung des Tals in m pro 10 m (pro Punkt überschreibbar). Die Täler werden in die
 * Hochflächen eingeschnitten; zusätzlich erzeugt terrain.js kleine Quebradas (Seitenrinnen).
 * main: als Fluss beschriftet und kräftiger gezeichnet.
 */
export const RIVERS = [
  {
    name: 'Río Choqueyapu',
    main: true,
    slope: 0.95,
    pts: [
      [10.3, -0.4, 4030, 70, 0.05], [10.6, 1.5, 3880, 60, 0.05], [11.1, 3.3, 3760, 30, 0.08],
      [11.6, 5.1, 3680, 0, 0.15], [12.1, 6.7, 3610, 0, 0.2], [12.8, 8.2, 3530, 0, 0.18],
      [13.6, 9.5, 3450, 20, 0.12, 1.1], [14.3, 10.4, 3390, 30, 0.12, 1.3], [15.2, 11.1, 3330, 25, 0.15, 1.4],
      [16.0, 11.8, 3290, 20, 0.2, 1.4], [16.1, 12.9, 3265, 40, 0.12, 1.6], [16.25, 14.0, 3240, 60, 0.08, 1.8],
      [16.4, 15.2, 3215, 70, 0.08, 1.8], [17.0, 16.4, 3180, 80, 0.06, 1.9], [17.6, 17.5, 3150, 80, 0.08, 1.9],
      [18.2, 18.9, 3110, 90, 0.06, 2.0], [18.6, 20.9, 3070, 100, 0.06, 2.0],
    ],
  },
  {
    name: 'Río Orkojahuira',
    main: true,
    slope: 1.4,
    pts: [
      [15.2, -0.4, 4090, 80, 0.04], [14.6, 1.5, 3940, 70, 0.05], [14.0, 3.2, 3800, 40, 0.06],
      [13.5, 4.8, 3700, 20, 0.08], [13.25, 6.4, 3610, 0, 0.1], [13.0, 7.6, 3550, 0, 0.1],
      [12.8, 8.2, 3530, 0, 0.12],
    ],
  },
  {
    name: 'Río Irpavi',
    main: true,
    slope: 1.6,
    pts: [
      [23.4, 10.0, 3930, 70, 0.04], [22.2, 10.6, 3800, 60, 0.06], [21.0, 11.1, 3650, 40, 0.1],
      [19.6, 11.25, 3500, 30, 0.12], [18.2, 11.4, 3390, 25, 0.15], [17.0, 11.6, 3320, 20, 0.15],
      [16.0, 11.8, 3290, 20, 0.2],
    ],
  },
  {
    name: 'Río Huañajahuira',
    slope: 1.7,
    pts: [
      [22.6, 13.4, 3880, 60, 0.04], [21.0, 13.1, 3700, 50, 0.06], [19.4, 12.8, 3520, 40, 0.08],
      [17.8, 12.5, 3370, 30, 0.1], [16.1, 12.9, 3265, 40, 0.1],
    ],
  },
  {
    name: 'Río Achocalla',
    main: true,
    slope: 0.7,
    pts: [
      [6.5, 13.9, 3890, 0, 0.35], [7.4, 15.4, 3830, 0, 0.6], [8.6, 16.2, 3790, 10, 0.4, 1.0],
      [10.0, 16.4, 3690, 60, 0.08, 1.8], [11.6, 16.0, 3540, 80, 0.06, 2.0], [13.2, 15.5, 3390, 80, 0.06, 2.0],
      [14.8, 15.3, 3280, 70, 0.06, 2.0], [16.4, 15.2, 3215, 70, 0.08, 1.9],
    ],
  },
  {
    name: 'Río Cotahuma',
    slope: 1.7,
    pts: [[9.6, 10.9, 3800, 50, 0.03], [11.2, 11.2, 3620, 60, 0.04], [12.8, 10.9, 3470, 40, 0.05], [14.3, 10.4, 3390, 30, 0.1]],
  },
  {
    name: 'Río Achachicala',
    slope: 1.7,
    pts: [[8.0, 3.4, 3960, 60, 0.03], [9.4, 3.9, 3820, 50, 0.03], [11.25, 4.0, 3725, 20, 0.05]],
  },
  {
    name: 'Río Chuquiaguillo',
    slope: 1.7,
    pts: [[17.2, 1.0, 4150, 60, 0.03], [16.0, 2.3, 3960, 60, 0.03], [14.9, 3.0, 3830, 40, 0.04], [14.0, 3.2, 3800, 40, 0.06]],
  },
  {
    name: 'Quebrada Kupini',
    slope: 1.8,
    pts: [[16.2, 7.6, 3800, 50, 0.03], [14.8, 8.5, 3640, 40, 0.04], [13.6, 9.5, 3450, 20, 0.08]],
  },
  {
    name: 'Río Hampaturi',
    slope: 2.0,
    pts: [[17.0, -0.4, 4250, 90, 0.03], [18.6, 2.0, 4080, 110, 0.03], [20.4, 3.8, 3920, 130, 0.03], [22.6, 5.2, 3760, 140, 0.04], [26.0, 6.4, 3550, 150, 0.05]],
  },
  {
    name: 'Valle de las Ánimas',
    slope: 2.0,
    pts: [[19.2, 6.4, 3990, 80, 0.03], [21.2, 7.6, 3860, 120, 0.03], [23.2, 8.6, 3720, 140, 0.03], [26.0, 9.2, 3560, 150, 0.04]],
  },
  {
    name: 'Quebrada Uni',
    slope: 2.0,
    pts: [[23.4, 12.4, 3920, 80, 0.03], [24.6, 13.2, 3760, 120, 0.03], [26.0, 14.0, 3600, 140, 0.04]],
  },
  {
    name: 'Quebrada Lipari',
    slope: 1.9,
    pts: [[20.2, 13.9, 3720, 60, 0.03], [19.4, 15.6, 3500, 80, 0.03], [18.6, 16.8, 3300, 80, 0.04], [17.6, 17.5, 3150, 80, 0.06]],
  },
  {
    name: 'Quebrada Huajchilla',
    slope: 2.0,
    pts: [[23.5, 16.5, 3850, 80, 0.03], [21.5, 17.6, 3560, 100, 0.03], [19.8, 18.6, 3300, 100, 0.03], [18.4, 19.5, 3100, 90, 0.05]],
  },
];

/** Gebiete mit starker Erosion (zerklüftete Badlands). [x, y, Radius km, Amplitude m] */
export const EROSION = [
  [16.0, 14.3, 1.5, 55], // Valle de la Luna
  [15.4, 16.2, 1.0, 40], // Mallasa / Valle de las Flores
  [12.8, 15.0, 1.2, 35], // Schlucht unterhalb Achocalla
  [20.2, 15.2, 1.1, 45], // Muela del Diablo
];

/** Zerfurchte Bergrücken im Osten: gerichtetes Rauschen (Rücken laufen von NW nach SO). */
export const EAST_RIDGES = { fromX: 16.0, fullX: 19.5, amplitude: 150, angleDeg: 32, wavelengthKm: 1.3 };

/** Seen. [x, y, Radius x km, Radius y km, Name] */
export const LAKES = [
  [7.47, 15.73, 0.28, 0.16, 'Laguna de Achocalla'],
  [22.4, 12.2, 0.11, 0.08, 'Laguna Uni'],
];

/**
 * Siedlungsgebiete: [x, y, Radius x km, Radius y km, Dichte 0..1, Stil].
 * Stil 'grid' = Schachbrett (El Alto), 'slope' = Hangbebauung, 'garden' = locker mit Feldern.
 */
export const URBAN = [
  [3.6, 5.2, 4.3, 4.6, 1.0, 'grid'],
  [3.6, 12.4, 3.9, 4.1, 0.95, 'grid'],
  [2.6, 17.6, 3.1, 3.0, 0.6, 'grid'],
  [6.3, 2.6, 1.5, 3.2, 0.95, 'grid'],
  [11.7, 6.9, 2.1, 2.5, 1.0, 'slope'],
  [10.3, 4.0, 1.5, 2.0, 0.85, 'slope'],
  [13.9, 4.3, 1.7, 2.1, 0.85, 'slope'],
  [14.7, 7.4, 1.4, 1.4, 0.8, 'slope'],
  [10.8, 9.8, 1.5, 1.4, 0.8, 'slope'],
  [13.8, 9.9, 1.1, 0.9, 0.85, 'slope'],
  [16.4, 11.8, 1.7, 1.2, 0.95, 'slope'],
  [18.4, 11.6, 1.3, 1.0, 0.85, 'slope'],
  [18.0, 13.2, 1.2, 0.8, 0.75, 'garden'],
  [20.6, 11.3, 1.2, 0.7, 0.6, 'garden'],
  [19.6, 12.9, 0.8, 0.6, 0.6, 'garden'],
  [16.2, 15.4, 0.9, 0.6, 0.5, 'garden'],
  [17.6, 17.6, 0.8, 0.6, 0.45, 'garden'],
  [7.4, 15.2, 1.5, 1.3, 0.55, 'garden'],
  [18.3, 19.4, 0.8, 0.6, 0.4, 'garden'],
  [22.3, 12.3, 0.5, 0.4, 0.35, 'garden'],
];

/**
 * Orte und Stadtteile (ungefähre Lage). label: 1 = Gebietsname auf der Karte, 2 = kleiner Ortsname.
 * Stationen erhalten den Namen des nächstgelegenen noch freien Ortes.
 */
export const PLACES = [
  // Gebiete
  { name: 'El Alto', x: 3.6, y: 5.6, label: 1 },
  { name: 'La Paz', x: 12.2, y: 6.0, label: 1 },
  { name: 'Zona Sur', x: 17.6, y: 12.0, label: 1 },
  { name: 'Achocalla', x: 7.2, y: 15.0, label: 1 },
  { name: 'Mallasa', x: 16.8, y: 15.4, label: 2 },
  { name: 'Valle de la Luna', x: 15.5, y: 14.3, label: 2 },
  { name: 'Ovejuyo', x: 21.1, y: 11.0, label: 2 },
  { name: 'Laguna Uni', x: 22.6, y: 12.5, label: 2 },
  { name: 'Muela del Diablo', x: 20.1, y: 15.3, label: 2 },
  { name: 'Obrajes', x: 14.1, y: 10.3, label: 2 },
  { name: 'Calacoto', x: 16.0, y: 11.6, label: 2 },
  { name: 'Jupapina', x: 17.6, y: 17.5, label: 2 },
  { name: 'Villa El Carmen', x: 13.1, y: 3.6, label: 2 },
  { name: 'Garita de Lima', x: 9.4, y: 6.7, label: 2 },
  { name: 'Plaza España', x: 10.6, y: 8.4, label: 2 },
  // El Alto
  { name: 'Ciudad Satélite', x: 8.6, y: 10.2 }, { name: 'Villa Adela', x: 2.7, y: 9.9 },
  { name: '16 de Julio', x: 6.6, y: 5.4 }, { name: 'Villa Ingenio', x: 3.7, y: 4.7 },
  { name: 'Río Seco', x: 2.0, y: 2.0 }, { name: 'Villa Dolores', x: 6.5, y: 6.7 },
  { name: 'Ballivián', x: 4.8, y: 3.4 }, { name: 'Villa Tunari', x: 1.8, y: 4.2 },
  { name: 'Alto Lima', x: 6.9, y: 2.8 }, { name: 'Santiago II', x: 3.6, y: 12.1 },
  { name: 'Senkata', x: 2.4, y: 15.6 }, { name: 'Villa Bolívar', x: 5.4, y: 11.3 },
  { name: 'Ventilla', x: 1.8, y: 18.6 }, { name: 'Rosas Pampa', x: 4.8, y: 13.2 },
  { name: 'Mercedario', x: 1.4, y: 12.6 }, { name: 'La Ceja', x: 7.0, y: 6.2 },
  { name: 'Parcopata', x: 1.6, y: 17.3 }, { name: 'Charapaqui', x: 2.6, y: 6.6 },
  { name: 'Villa Exaltación', x: 6.2, y: 9.8 }, { name: 'Huayna Potosí', x: 4.4, y: 1.2 },
  { name: 'Villa Mercedes', x: 6.6, y: 13.8 }, { name: 'Cosmos 79', x: 1.2, y: 8.6 },
  // Hänge und Zentrum
  { name: 'Munaypata', x: 9.6, y: 5.5 }, { name: 'Pura Pura', x: 9.3, y: 4.3 },
  { name: 'Achachicala', x: 10.3, y: 2.6 }, { name: 'Tembladerani', x: 9.9, y: 8.7 },
  { name: 'Cotahuma', x: 10.4, y: 9.6 }, { name: 'Llojeta', x: 10.7, y: 10.8 },
  { name: 'Bajo Llojeta', x: 12.1, y: 11.4 }, { name: 'Sopocachi', x: 11.3, y: 8.2 },
  { name: 'Max Paredes', x: 10.6, y: 6.2 }, { name: 'Gran Poder', x: 11.1, y: 6.6 },
  { name: 'Villa Victoria', x: 10.2, y: 5.6 }, { name: 'El Tejar', x: 10.4, y: 5.0 },
  { name: 'Vino Tinto', x: 10.7, y: 4.4 }, { name: 'Chamoco Chico', x: 9.7, y: 7.4 },
  { name: 'Plaza Murillo', x: 12.1, y: 6.5 }, { name: 'San Francisco', x: 11.7, y: 6.8 },
  { name: 'El Prado', x: 12.1, y: 7.3 }, { name: 'San Pedro', x: 11.4, y: 7.4 },
  { name: 'San Jorge', x: 12.3, y: 8.2 }, { name: 'Plaza Abaroa', x: 11.9, y: 8.6 },
  { name: 'Santa Bárbara', x: 12.7, y: 6.9 }, { name: 'Periférica', x: 12.3, y: 2.9 },
  { name: 'Villa Fátima', x: 13.9, y: 3.7 }, { name: 'Miraflores', x: 13.1, y: 7.3 },
  { name: 'Villa Copacabana', x: 14.6, y: 5.4 }, { name: 'Pampahasi', x: 15.3, y: 7.5 },
  { name: 'Villa San Antonio', x: 14.5, y: 6.6 }, { name: 'Kupini', x: 14.5, y: 8.4 },
  { name: 'Callampaya', x: 13.8, y: 4.7 }, { name: 'Chuquiaguillo', x: 16.0, y: 1.9 },
  { name: 'Alto Miraflores', x: 14.0, y: 6.3 }, { name: 'Villa Armonía', x: 15.2, y: 8.6 },
  { name: 'Alto Obrajes', x: 13.6, y: 9.6 },
  // Zona Sur und Süden
  { name: 'San Miguel', x: 16.4, y: 11.3 }, { name: 'Irpavi', x: 17.5, y: 11.1 },
  { name: 'Achumani', x: 18.1, y: 12.3 }, { name: 'Cota Cota', x: 17.7, y: 13.2 },
  { name: 'Los Pinos', x: 16.9, y: 12.6 }, { name: 'Bolognia', x: 15.0, y: 11.3 },
  { name: 'Següencoma', x: 15.3, y: 12.4 }, { name: 'Aranjuez', x: 16.0, y: 13.6 },
  { name: 'Chasquipampa', x: 19.4, y: 12.9 }, { name: 'Alto Irpavi', x: 18.8, y: 10.1 },
  { name: 'Koani', x: 17.2, y: 12.0 }, { name: 'Auquisamaña', x: 17.6, y: 13.9 },
  { name: 'Mallasilla', x: 15.3, y: 15.6 }, { name: 'Huajchilla', x: 18.2, y: 19.5 },
  { name: 'Lipari', x: 16.2, y: 18.4 }, { name: 'Uni', x: 22.3, y: 12.0 },
  { name: 'Las Lomas', x: 19.0, y: 11.8 }, { name: 'Alto Seguencoma', x: 14.6, y: 12.8 },
  // Achocalla und Osten
  { name: 'Pacajes', x: 8.5, y: 16.5 }, { name: 'Cañaviri', x: 6.2, y: 13.9 },
  { name: 'Chullpas', x: 10.9, y: 19.4 }, { name: 'Pucarani', x: 7.4, y: 17.4 },
  { name: 'Aruntaya', x: 17.6, y: 5.6 }, { name: 'Alaxpacha', x: 23.6, y: 8.5 },
  { name: 'Hampaturi', x: 19.6, y: 2.6 }, { name: 'Ánimas', x: 21.6, y: 7.6 },
  { name: 'Munumarca', x: 21.3, y: 18.1 },
];

/** Hinweis am Kartenrand: Richtung Palca und Illimani. */
export const EDGE_LABELS = [
  { text: 'Palca →', x: 25.1, y: 13.4, align: 'right' },
  { text: 'Illimani ↘', x: 25.1, y: 19.9, align: 'right' },
];

/** Mögliche Startgebiete einer Runde. */
export const START_AREAS = [
  { name: 'Zentrum', x: 12.1, y: 7.2 },
  { name: 'El Alto', x: 4.4, y: 5.0 },
  { name: 'Zona Sur', x: 16.8, y: 12.0 },
  { name: 'Achocalla', x: 8.0, y: 15.3 },
  { name: 'Ovejuyo', x: 20.0, y: 11.5 },
  { name: 'Villa Fátima', x: 13.4, y: 3.9 },
  { name: 'Ciudad Satélite', x: 7.6, y: 10.6 },
];

/**
 * Feste, blockierende Bauwerke (keine Seile darüber, keine Masten, keine Stationen).
 * rect: [x, y, Länge km, Breite km, Winkel°]; circle: [x, y, Radius km]
 */
export const LANDMARKS = [
  { kind: 'airport', name: 'Flughafen El Alto', rect: [5.15, 7.95, 4.6, 1.05, -3] },
  { kind: 'approach', name: 'Einflugschneise', approach: { x: 5.15, y: 7.95, angle: -3, halfRunway: 2.3, length: 2.1, w0: 0.5, w1: 0.95 } },
  { kind: 'stadium', name: 'Estadio Hernando Siles', circle: [13.3, 7.2, 0.17] },
  { kind: 'stadium', name: 'Estadio Municipal de El Alto', circle: [3.73, 3.87, 0.15] },
  { kind: 'stadium', name: 'Estadio Rafael Mendoza', circle: [18.35, 12.1, 0.13] },
  { kind: 'stadium', name: 'Estadio Tembladerani', circle: [10.0, 8.95, 0.11] },
  { kind: 'hospital', name: 'Hospital de Clínicas', circle: [13.0, 6.45, 0.11] },
  { kind: 'hospital', name: 'Hospital del Norte', circle: [5.9, 3.0, 0.1] },
  { kind: 'hospital', name: 'Hospital El Alto Sur', circle: [1.47, 9.6, 0.1] },
  { kind: 'hospital', name: 'Hospital Boliviano Holandés', circle: [8.65, 9.25, 0.1] },
  { kind: 'hospital', name: 'Hospital Boliviano Japonés', circle: [5.33, 16.2, 0.1] },
  { kind: 'hospital', name: 'Clínica Zona Sur', circle: [16.55, 12.25, 0.09] },
  { kind: 'barracks', name: 'Gran Cuartel de Miraflores', rect: [13.75, 7.05, 0.36, 0.24, 20] },
  { kind: 'barracks', name: 'Colegio Militar', rect: [17.35, 10.85, 0.6, 0.38, 8] },
  { kind: 'barracks', name: 'Cuartel El Alto', rect: [2.5, 11.0, 0.42, 0.3, 0] },
];

/** Zonen, in denen der Seed Hochhaus-Gruppen erzeugt. [x, y, Radius km, Anzahl min, max] */
export const HIGHRISE_ZONES = [
  [12.1, 7.4, 0.95, 14, 20], // Centro: El Prado, San Jorge, Sopocachi
  [16.2, 11.7, 0.7, 9, 14], // Calacoto, San Miguel
  [13.2, 6.8, 0.4, 3, 6], // Miraflores
  [6.9, 6.1, 0.45, 2, 4], // La Ceja / 16 de Julio
];

/** Parameter der automatisch erzeugten Quebradas (kleine Seitenrinnen). */
export const GULLIES = {
  cejaSpacing: [240, 420], // Abstand der Rinnen von der Ceja hinab (Welt-Einheiten)
  cejaStartFloor: 3880,
  sideSpacing: [130, 240], // Abstand der Seitenrinnen entlang der Täler
  sideLength: [110, 320],
  slope: 1.8,
  gorge: [12, 28], // bleibt unter der Mast-Schwelle
};
