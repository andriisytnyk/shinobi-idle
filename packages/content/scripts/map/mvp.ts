// MVP playable area (hand-made, ours): the hexes of the Land of Fire the slice uses, a first terrain proposal
// for them, and the placement of the 36 slice cells. Coordinates are offset (col,row) of the grid in grid.ts.
import { hexAt, neighbours } from './grid.ts';

export type Terrain =
  'forest' | 'plains' | 'road' | 'river' | 'hills' | 'coast' | 'settlement' | 'lake';

type CR = [number, number];

/** Playable hexes: every hex of the Land of Fire in these rows (the southern tongue below is outline only). */
export const PLAYABLE_ROWS: [number, number] = [11, 21];

const RIVER: CR[] = [
  [17, 11],
  [18, 12],
  [19, 12],
  [20, 12],
  [21, 12],
  [19, 13],
  [19, 14],
];
const ROADS: CR[] = [
  // Leaf - Shukuba - Tanzaku
  [18, 17],
  [17, 17],
  [16, 17],
  [15, 17],
  [15, 16],
  [14, 16],
  // Leaf - Valley of the End
  [18, 16],
  [17, 15],
  [17, 14],
  [17, 13],
  [17, 12],
  // Leaf - south
  [19, 18],
  [19, 19],
  [20, 20],
  [20, 21],
  // Leaf - north-east coast (Hell Valley, Bamboo village)
  [19, 17],
  [20, 16],
  [21, 15],
  [22, 14],
  [22, 13],
];
const SETTLEMENTS: CR[] = [
  [18, 17],
  [14, 16],
  [15, 17],
  [22, 12],
]; // Leaf, Tanzaku, Shukuba, Bamboo village
const HILLS: CR[] = [
  [21, 20],
  [21, 21],
  [23, 13],
]; // stone hills in the south-east; Hell Valley by the coast
const LAKES: CR[] = [[14, 14]];

export interface CellDef {
  region: 'forest' | 'plains' | 'valley';
  index: number; // 1..12 within the region of slice.json
  hex: CR;
  why: string;
}

/** The 36 cells of slice.json (names come from slice.json by region and index). */
export const CELLS: CellDef[] = [
  {
    region: 'forest',
    index: 1,
    hex: [17, 17],
    why: 'Поряд із Листям, з боку Сюкуби: застава на західному тракті',
  },
  { region: 'forest', index: 2, hex: [19, 17], why: 'Поля поруч із селом, на східному тракті' },
  { region: 'forest', index: 3, hex: [17, 16], why: 'Склад на північний захід від села, у лісі' },
  { region: 'forest', index: 4, hex: [18, 15], why: 'Узлісся там, де ліс переходить у поля' },
  {
    region: 'forest',
    index: 5,
    hex: [18, 16],
    why: 'Полігон №44 на краю села, на північному тракті',
  },
  {
    region: 'forest',
    index: 6,
    hex: [17, 15],
    why: 'Початок прикордонного лісу на північному тракті',
  },
  { region: 'forest', index: 7, hex: [17, 14], why: 'Хащі глибше в лісі, на шляху до Долини' },
  { region: 'forest', index: 8, hex: [19, 14], why: 'Брід через притоку річки з Долини' },
  {
    region: 'forest',
    index: 9,
    hex: [16, 13],
    why: 'Скеля над водоспадом ближче до північних пагорбів',
  },
  { region: 'forest', index: 10, hex: [15, 14], why: 'Тернові зарості на західній окраїні лісу' },
  { region: 'forest', index: 11, hex: [14, 14], why: 'Лісове озеро на півночі від Танзаку' },
  { region: 'forest', index: 12, hex: [16, 17], why: 'Старий тракт між Листям і Сюкубою' },
  { region: 'plains', index: 1, hex: [19, 18], why: 'Початок південного тракту від Листя' },
  {
    region: 'plains',
    index: 2,
    hex: [15, 17],
    why: 'Містечко на рівнинах — Сюкуба (місто на мапі-орієнтирі)',
  },
  { region: 'plains', index: 3, hex: [21, 18], why: 'Храм на сході рівнин' },
  { region: 'plains', index: 4, hex: [19, 19], why: 'Караванний шлях уздовж південного тракту' },
  { region: 'plains', index: 5, hex: [18, 19], why: 'Табір найманців поруч із караванним шляхом' },
  { region: 'plains', index: 6, hex: [17, 19], why: 'Сухе річище на заході рівнин' },
  {
    region: 'plains',
    index: 7,
    hex: [16, 20],
    why: 'Руїни прикордонної фортеці біля кордону Країни Річок',
  },
  {
    region: 'plains',
    index: 8,
    hex: [16, 19],
    why: 'Сховище в підвалах фортеці, поруч із руїнами',
  },
  { region: 'plains', index: 9, hex: [22, 20], why: 'Соляні копальні на південному узбережжі' },
  {
    region: 'plains',
    index: 10,
    hex: [18, 20],
    why: 'Степові зарості між караванним шляхом і хутором',
  },
  { region: 'plains', index: 11, hex: [21, 20], why: "Кам'яні пагорби на південному сході рівнин" },
  {
    region: 'plains',
    index: 12,
    hex: [17, 21],
    why: 'Покинутий хутір на півдні, найдалі від Листя',
  },
  {
    region: 'valley',
    index: 1,
    hex: [17, 12],
    why: 'Північний тракт упирається в Долину: застава',
  },
  {
    region: 'valley',
    index: 2,
    hex: [17, 11],
    why: 'Долина Завершення на північному кордоні Країни Вогню, як на мапі',
  },
  { region: 'valley', index: 3, hex: [18, 12], why: 'Берег ріки, що витікає з Долини' },
  { region: 'valley', index: 4, hex: [16, 12], why: 'Стежка мисливця західніше Долини' },
  { region: 'valley', index: 5, hex: [18, 11], why: 'Сховок під водоспадом на північному кордоні' },
  {
    region: 'valley',
    index: 6,
    hex: [16, 11],
    why: 'Святе місце біля водоспаду, поруч із Долиною',
  },
  { region: 'valley', index: 7, hex: [15, 12], why: 'Туманний яр у північних пагорбах' },
  { region: 'valley', index: 8, hex: [15, 11], why: "Кам'яні уступи на кордоні" },
  {
    region: 'valley',
    index: 9,
    hex: [14, 11],
    why: 'Завалена печера на північно-західному кордоні',
  },
  { region: 'valley', index: 10, hex: [18, 13], why: 'Старе поле бою південніше Долини' },
  { region: 'valley', index: 11, hex: [14, 12], why: 'Прикордонна застава на заході Долини' },
  { region: 'valley', index: 12, hex: [19, 12], why: "Верхів'я ріки східніше Долини" },
];

const key = (c: CR) => `${c[0]},${c[1]}`;

/**
 * Builds the playable set and the terrain. `countryAt(col,row)` gives the classified country of a hex;
 * the function throws when a hand-made hex falls outside the Land of Fire, so the proposal stays honest
 * if the classification changes.
 */
export function buildPlayable(countryAt: (col: number, row: number) => string, cols: number) {
  const playable = new Map<string, CR>();
  for (let row = PLAYABLE_ROWS[0]; row <= PLAYABLE_ROWS[1]; row++)
    for (let col = 0; col < cols; col++)
      if (countryAt(col, row) === 'core:fire') playable.set(key([col, row]), [col, row]);
  const inArea = (c: CR, what: string) => {
    if (!playable.has(key(c))) throw new Error(`${what} ${key(c)} is outside the playable area`);
  };
  [...RIVER, ...ROADS, ...SETTLEMENTS, ...HILLS, ...LAKES].forEach((c) => inArea(c, 'terrain hex'));
  const seen = new Set<string>();
  for (const cell of CELLS) {
    inArea(cell.hex, `cell ${cell.region}#${cell.index}`);
    if (seen.has(key(cell.hex))) throw new Error(`two cells on ${key(cell.hex)}`);
    seen.add(key(cell.hex));
  }
  const terrain = new Map<string, Terrain>();
  const set = (list: CR[], t: Terrain) => list.forEach((c) => terrain.set(key(c), t));
  for (const [k, [col, row]] of playable) {
    let t: Terrain;
    if (row <= 12 && col <= 16)
      t = 'hills'; // northern ridge along the Earth / Waterfall border
    else if (row >= 18) t = 'plains';
    else if (col >= 21 && row >= 14)
      t = 'plains'; // eastern coastal plain
    else t = 'forest';
    terrain.set(k, t);
  }
  set(HILLS, 'hills');
  set(LAKES, 'lake');
  set(ROADS, 'road');
  set(RIVER, 'river');
  set(SETTLEMENTS, 'settlement');
  // Coast: forest/plains/hills hexes touching the sea.
  for (const [k, [col, row]] of playable) {
    const t = terrain.get(k)!;
    if (t !== 'forest' && t !== 'plains' && t !== 'hills') continue;
    if (neighbours(col, row).some((n) => n && countryAt(n[0], n[1]) === 'sea'))
      terrain.set(k, 'coast');
  }
  // Axial keys.
  const hexes: string[] = [];
  const terrainAxial = new Map<string, Terrain>();
  for (const [k, [col, row]] of playable) {
    const h = hexAt(col, row);
    const a = `${h.q},${h.r}`;
    hexes.push(a);
    terrainAxial.set(a, terrain.get(k)!);
  }
  const cells = CELLS.map((c) => {
    const h = hexAt(c.hex[0], c.hex[1]);
    return { ...c, q: h.q, r: h.r };
  });
  return { hexes, terrain: terrainAxial, cells };
}
