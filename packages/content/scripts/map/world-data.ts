// Hand-made inputs of the world map classifier. Every pixel coordinate below is a position on the
// reference image (1920x1080), read off the image by eye. The reference itself is never stored.

export type RGB = [number, number, number];
export type Pt = [number, number];
export type Rect = [number, number, number, number]; // x0, y0, x1, y1

export interface Country {
  id: string;
  name: string;
  /** Suggested colour token of the interface style document. */
  token: string;
  /** Where the name comes from. */
  nameSource: string;
}

export const SEA = 'sea';

/**
 * Palette of flat colour classes. `rects` are clean areas of the reference (no labels or icons)
 * the median colour of which is measured at run time; `ref` is the value measured when the script was
 * written, kept only to document the palette (the script prints the measured value and warns on drift).
 */
export const PALETTE_RECTS: { cls: string; ref: RGB; rects: Rect[] }[] = [
  {
    cls: 'sea',
    ref: [110, 120, 130],
    rects: [
      [1200, 560, 1260, 600],
      [1180, 880, 1260, 930],
      [1010, 960, 1090, 1000],
      [1450, 130, 1500, 160],
      [650, 60, 760, 90],
    ],
  },
  {
    cls: 'fire',
    ref: [168, 105, 92],
    rects: [
      [700, 880, 780, 940],
      [940, 800, 1000, 880],
      [660, 780, 700, 840],
    ],
  },
  {
    cls: 'earth',
    ref: [137, 108, 109],
    rects: [
      [100, 200, 200, 250],
      [380, 120, 440, 220],
      [250, 380, 330, 410],
    ],
  },
  {
    cls: 'wind',
    ref: [126, 122, 113],
    rects: [
      [50, 560, 200, 640],
      [350, 880, 450, 960],
      [50, 850, 150, 900],
    ],
  },
  {
    cls: 'lightning',
    ref: [190, 160, 90],
    rects: [
      [1100, 200, 1180, 260],
      [1450, 150, 1530, 220],
      [1300, 300, 1360, 340],
    ],
  },
  {
    cls: 'neutral',
    ref: [175, 155, 135],
    rects: [
      [760, 270, 800, 300],
      [1760, 640, 1860, 700],
      [570, 800, 600, 880],
      [1060, 560, 1100, 580],
    ],
  },
];

/** Colour classes that are land of a named country directly. Everything else land is "neutral". */
export const DIRECT_CLASS_COUNTRY: Record<string, string> = {
  fire: 'core:fire',
  earth: 'core:earth',
  wind: 'core:wind',
  lightning: 'core:lightning',
};

/** The compass rose (drawn over the map): its hexes are filled from the neighbours. */
export const COMPASS: { c: Pt; r: number } = { c: [1750, 180], r: 150 };

/** Rectangles covered by large labels or icons where colour is unreliable: samples inside are ignored. */
export const MASKS: Rect[] = [];

export interface Region {
  id: string; // country id the polygon gives to neutral-coloured hexes
  /** Human label on the reference the polygon encloses. */
  label: string;
  poly: Pt[];
}

/**
 * Neutral (beige) lands share one colour, so they are told apart by their drawn borders. Each polygon is
 * traced by hand from the borders visible on the reference. A neutral hex gets the country of the first
 * polygon that contains its centre, else of the nearest polygon. Order matters where polygons overlap.
 */
export const REGIONS: Region[] = [
  {
    id: 'core:far-east',
    label: 'unlabelled eastern land with the long peninsula (south-east of the compass)',
    poly: [
      [1700, 840],
      [1700, 790],
      [1760, 730],
      [1800, 670],
      [1815, 600],
      [1840, 540],
      [1919, 520],
      [1919, 790],
      [1830, 780],
      [1780, 795],
      [1725, 835],
    ],
  },
  {
    id: 'core:far-east',
    label: 'unlabelled eastern land under the compass (north-east)',
    poly: [
      [1690, 100],
      [1919, 40],
      [1919, 280],
      [1770, 260],
      [1690, 200],
    ],
  },
  {
    id: 'core:forests',
    label: 'СТРАНА ЛЕСОВ: long island south-east of Fire',
    poly: [
      [1060, 770],
      [1310, 770],
      [1310, 880],
      [1060, 880],
    ],
  },
  {
    id: 'core:forests',
    label: 'СТРАНА ЛЕСОВ: island south of it',
    poly: [
      [1330, 880],
      [1455, 880],
      [1455, 1010],
      [1330, 1010],
    ],
  },
  {
    id: 'core:waves',
    label: 'СТРАНА ВОЛН: long island east of Fire',
    poly: [
      [1285, 410],
      [1415, 410],
      [1415, 530],
      [1285, 530],
    ],
  },
  {
    id: 'core:waves',
    label: 'СТРАНА ВОЛН: small island the arrow points to',
    poly: [
      [1115, 675],
      [1185, 675],
      [1185, 745],
      [1115, 745],
    ],
  },
  {
    id: 'core:water',
    label: 'СТРАНА ВОДЫ: archipelago round the Hidden Mist island',
    poly: [
      [1375, 570],
      [1790, 570],
      [1790, 1020],
      [1375, 1020],
    ],
  },
  {
    id: 'core:rock',
    label: 'СКРЫТАЯ СКАЛА: western beige land',
    poly: [
      [0, 380],
      [425, 380],
      [425, 635],
      [0, 635],
    ],
  },
  {
    id: 'core:rain',
    label: 'СКРЫТЫЙ ДОЖДЬ and МОСТ ТЕНЧИ with the wedge north of it',
    poly: [
      [425, 470],
      [500, 470],
      [500, 415],
      [592, 415],
      [592, 480],
      [568, 480],
      [568, 580],
      [500, 580],
      [500, 632],
      [425, 632],
    ],
  },
  {
    id: 'core:rivers',
    label: 'СТРАНА РЕК: strip between Wind and Fire',
    poly: [
      [495, 632],
      [740, 632],
      [740, 1045],
      [495, 1045],
    ],
  },
  {
    id: 'core:waterfall',
    label: 'СКРЫТЫЙ ВОДОПАД',
    poly: [
      [575, 250],
      [705, 250],
      [705, 445],
      [592, 445],
      [592, 415],
      [575, 415],
    ],
  },
  {
    id: 'core:disputed',
    label: 'СПОРНЫЕ ЗЕМЛИ',
    poly: [
      [705, 250],
      [830, 250],
      [830, 345],
      [797, 345],
      [782, 395],
      [770, 445],
      [705, 445],
    ],
  },
  {
    id: 'core:sound',
    label: "СТРАНА ЗВУКА: northern peninsula with the Mountains' Graveyard",
    poly: [
      [780, 100],
      [960, 100],
      [960, 235],
      [870, 262],
      [870, 345],
      [830, 345],
      [830, 262],
      [780, 262],
    ],
  },
  {
    id: 'core:sound',
    label: 'СКРЫТЫЙ ЗВУК',
    poly: [
      [797, 345],
      [880, 345],
      [880, 445],
      [770, 445],
      [782, 395],
    ],
  },
  {
    id: 'core:steam',
    label: 'СТРАНА ПАРА',
    poly: [
      [880, 345],
      [945, 300],
      [985, 345],
      [990, 420],
      [985, 452],
      [880, 452],
    ],
  },
  {
    id: 'core:frost',
    label: 'СТРАНА МОРОЗА',
    poly: [
      [945, 300],
      [1125, 300],
      [1125, 420],
      [990, 420],
      [985, 350],
    ],
  },
  {
    id: 'core:fire',
    label:
      'north-east coastal strip with Bamboo village and Hell Valley (drawn beige, named as Fire)',
    poly: [
      [985, 422],
      [1125, 410],
      [1195, 520],
      [1195, 640],
      [1000, 640],
      [935, 455],
    ],
  },
];

/** Areas forced to a country regardless of colour (the sea-coloured island of the Hidden Mist). */
export const FORCED: { id: string; label: string; poly: Pt[] }[] = [
  {
    id: 'core:water',
    label: 'СКРЫТЫЙ ТУМАН: round island inside the brown ring (sea-coloured on the reference)',
    poly: [
      [1475, 710],
      [1495, 655],
      [1530, 635],
      [1580, 635],
      [1620, 660],
      [1648, 705],
      [1645, 750],
      [1620, 785],
      [1580, 820],
      [1545, 820],
      [1500, 785],
      [1480, 770],
      [1475, 735],
    ],
  },
];

/**
 * Islets smaller than a hex that the colour vote loses to the sea. The hex containing the pixel is given
 * the country, so that named places on them have land under them.
 */
export const ISLETS: { at: Pt; id: string; label: string }[] = [
  {
    at: [1430, 368],
    id: 'core:lightning',
    label: 'ЧЕРЕПАШИЙ ОСТРОВ: yellow islet south of the Lightning coast',
  },
  {
    at: [1150, 707],
    id: 'core:waves',
    label: 'СТРАНА ВОЛН: small island with a dot, the arrow points to it',
  },
];

export const COUNTRIES: Country[] = [
  { id: 'core:fire', name: 'Країна Вогню', token: 'hanko', nameSource: 'документи проєкту' },
  { id: 'core:earth', name: 'Країна Землі', token: 'doton', nameSource: 'документи проєкту' },
  { id: 'core:wind', name: 'Країна Вітру', token: 'futon', nameSource: 'документи проєкту' },
  {
    id: 'core:lightning',
    name: 'Країна Блискавки',
    token: 'raiton',
    nameSource: 'документи проєкту',
  },
  { id: 'core:water', name: 'Країна Води', token: 'suiton', nameSource: 'документи проєкту' },
  { id: 'core:waves', name: 'Країна Хвиль', token: 'chakra', nameSource: 'документи проєкту' },
  { id: 'core:forests', name: 'Країна Лісів', token: 'leaf', nameSource: 'переклад' },
  { id: 'core:rivers', name: 'Країна Річок', token: 'steel', nameSource: 'переклад' },
  { id: 'core:rain', name: 'Країна Дощу', token: 'steel', nameSource: 'документи проєкту' },
  {
    id: 'core:waterfall',
    name: 'Країна Водоспадів',
    token: 'chakra',
    nameSource: 'документи проєкту',
  },
  { id: 'core:disputed', name: 'Спірні землі', token: 'text-dim', nameSource: 'переклад' },
  { id: 'core:sound', name: 'Країна Звуку', token: 'orange', nameSource: 'документи проєкту' },
  { id: 'core:steam', name: 'Країна Пари', token: 'katon', nameSource: 'переклад' },
  { id: 'core:frost', name: 'Країна Морозу', token: 'steel', nameSource: 'переклад' },
  { id: 'core:rock', name: 'Країна Скелі', token: 'ink-600', nameSource: 'переклад' },
  {
    id: 'core:far-east',
    name: 'Східні землі',
    token: 'ink-600',
    nameSource: 'умовна назва: на мапі-орієнтирі земля без підпису',
  },
];
