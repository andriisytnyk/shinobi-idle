// Places of the world map. `px` is the position read on the reference image (marker dot, or the centre of the
// village glyph when the reference has no dot). Names are Ukrainian; `source` says where the name comes from.
import type { Pt } from './world-data.ts';

export type PlaceKind =
  'country' | 'hidden-village' | 'town' | 'village' | 'landmark' | 'hideout' | 'island';

export interface PlaceDef {
  id: string;
  name: string;
  kind: PlaceKind;
  px: Pt;
  source: string;
  /** Reference label (Russian), kept to make the check against the image easy. */
  refLabel: string;
}

const WIKI = 'uk.wikipedia.org/wiki/Наруто (форма «Прихованого …» за зразком статті)';
const DOCS = 'документи проєкту';
const TR = 'переклад';

export const PLACES: PlaceDef[] = [
  // Land of Fire
  {
    id: 'core:hidden-leaf',
    name: 'Коноха (Село Прихованого Листя)',
    kind: 'hidden-village',
    px: [848, 682],
    source: `${WIKI}; у документах — «Листя»`,
    refLabel: 'Скрытый лист',
  },
  {
    id: 'core:tanzaku',
    name: 'Місто Танзаку',
    kind: 'town',
    px: [651, 643],
    source: `${TR}: транслітерація (Tanzaku-gai, «Танзаку»)`,
    refLabel: 'Город Танзаку',
  },
  {
    id: 'core:shukuba',
    name: 'Місто Сюкуба',
    kind: 'town',
    px: [741, 703],
    source: `${TR}: 宿場 (Shukuba, «станційне містечко»), транслітерація`,
    refLabel: 'Город Шукуба',
  },
  {
    id: 'core:valley-of-the-end',
    name: 'Долина Завершення',
    kind: 'landmark',
    px: [835, 467],
    source: DOCS,
    refLabel: 'Долина завершения',
  },
  {
    id: 'core:bamboo-village',
    name: 'Бамбукове село',
    kind: 'village',
    px: [1023, 497],
    source: `${TR}: за написом на мапі (Бамбуковая деревня)`,
    refLabel: 'Бамбуковая деревня',
  },
  {
    id: 'core:hell-valley',
    name: 'Пекельна долина',
    kind: 'landmark',
    px: [1074, 543],
    source: `${TR}: 地獄谷 (Jigokudani, «пекельна долина»)`,
    refLabel: 'Адская долина',
  },
  // Land of Earth
  {
    id: 'core:hidden-stone',
    name: 'Село Прихованого Каменю',
    kind: 'hidden-village',
    px: [385, 335],
    source: `${WIKI}: «Прихованого в Камені»`,
    refLabel: 'Скрытый камень',
  },
  // Land of Wind
  {
    id: 'core:hidden-sand',
    name: 'Село Прихованого Піску',
    kind: 'hidden-village',
    px: [302, 895],
    source: `${WIKI}: «Прихованого в Піску»`,
    refLabel: 'Скрытый песок',
  },
  {
    id: 'core:pottery-village',
    name: 'Село кераміки',
    kind: 'village',
    px: [510, 758],
    source: `${TR}: за написом на мапі (Деревня керамики)`,
    refLabel: 'Деревня керамики',
  },
  // Land of Rivers
  {
    id: 'core:akatsuki-hideout',
    name: 'Сховок Акацукі',
    kind: 'hideout',
    px: [603, 775],
    source: `${TR}: за написом на мапі (Убежище Акацуки); «Акацукі» — написання з виданих українських перекладів`,
    refLabel: 'Убежище Акацуки',
  },
  {
    id: 'core:hidden-valley-village',
    name: 'Село, сховане в долині',
    kind: 'hidden-village',
    px: [632, 838],
    source: `${TR}: за написом на мапі (Деревня скрытая в долине)`,
    refLabel: 'Деревня скрытая в долине',
  },
  // Small lands between Earth, Wind and Fire
  {
    id: 'core:hidden-rain',
    name: 'Село Прихованого Дощу',
    kind: 'hidden-village',
    px: [470, 552],
    source: `${TR}: за зразком форми «Прихованого …» (${WIKI}); 雨隠れ`,
    refLabel: 'Скрытый дождь',
  },
  {
    id: 'core:tenchi-bridge',
    name: 'Міст Тенчі',
    kind: 'landmark',
    px: [522, 533],
    source: `${TR}: транслітерація (天地橋, «міст неба й землі»)`,
    refLabel: 'Мост Тенчи',
  },
  {
    id: 'core:hidden-rock-village',
    name: 'Село Прихованої Скелі',
    kind: 'hidden-village',
    px: [349, 535],
    source: `${TR}: за написом на мапі (Скрытая скала)`,
    refLabel: 'Скрытая скала',
  },
  {
    id: 'core:hidden-waterfall',
    name: 'Село Прихованого Водоспаду',
    kind: 'hidden-village',
    px: [613, 335],
    source: `${WIKI}: «Прихованого Водоспаду»`,
    refLabel: 'Скрытый водопад',
  },
  // North of Fire
  {
    id: 'core:hidden-sound',
    name: 'Село Прихованого Звуку',
    kind: 'hidden-village',
    px: [820, 396],
    source: `${DOCS}: «Село Звуку»; форма за зразком ${WIKI}`,
    refLabel: 'Скрытый звук',
  },
  {
    id: 'core:mountains-graveyard',
    name: 'Цвинтар Гір',
    kind: 'landmark',
    px: [901, 143],
    source: `${TR}: за написом на мапі (Кладбище гор)`,
    refLabel: 'Кладбище гор',
  },
  {
    id: 'core:hidden-hot-spring',
    name: 'Село Прихованого Гарячого Джерела',
    kind: 'hidden-village',
    px: [945, 413],
    source: `${TR}: за написом на мапі (деревня скрытого горячего источника); 湯隠れ`,
    refLabel: 'Страна пара',
  },
  {
    id: 'core:hidden-frost',
    name: 'Село Прихованого Морозу',
    kind: 'hidden-village',
    px: [1003, 358],
    source: `${TR}: за написом на мапі (деревня скрытого мороза); 霜隠れ`,
    refLabel: 'Страна мороза',
  },
  // Land of Lightning
  {
    id: 'core:hidden-cloud',
    name: 'Село Прихованої Хмари',
    kind: 'hidden-village',
    px: [1265, 275],
    source: `${DOCS}: «Хмари»; форма за зразком ${WIKI}`,
    refLabel: 'Скрытое облако',
  },
  {
    id: 'core:alliance-hq',
    name: 'Штаб Альянсу шінобі',
    kind: 'landmark',
    px: [1405, 317],
    source: `${TR}: за написом на мапі (Штаб-квартира альянса шиноби)`,
    refLabel: 'Штаб квартира альянса шиноби',
  },
  {
    id: 'core:turtle-island',
    name: 'Черепашачий острів',
    kind: 'island',
    px: [1430, 368],
    source: `${TR}: за написом на мапі (Черепаший остров); 亀の島`,
    refLabel: 'Черепаший остров',
  },
  {
    id: 'core:colosseum',
    name: 'Колізей',
    kind: 'landmark',
    px: [1495, 465],
    source: `${TR}: за написом на мапі (Коллизей); у морі на мапі`,
    refLabel: 'Коллизей',
  },
  // Land of Water
  {
    id: 'core:hidden-mist',
    name: 'Село Прихованого Туману',
    kind: 'hidden-village',
    px: [1558, 727],
    source: `${DOCS}: «Туман»; форма за зразком ${WIKI}`,
    refLabel: 'Скрытый туман',
  },
  // Countries (a label position of the country on the reference; snapped to the nearest hex of the country)
  {
    id: 'core:land-of-fire',
    name: 'Країна Вогню',
    kind: 'country',
    px: [700, 560],
    source: DOCS,
    refLabel: 'Страна огня',
  },
  {
    id: 'core:land-of-earth',
    name: 'Країна Землі',
    kind: 'country',
    px: [150, 100],
    source: DOCS,
    refLabel: 'Страна земли',
  },
  {
    id: 'core:land-of-wind',
    name: 'Країна Вітру',
    kind: 'country',
    px: [150, 750],
    source: DOCS,
    refLabel: 'Страна ветра',
  },
  {
    id: 'core:land-of-lightning',
    name: 'Країна Блискавки',
    kind: 'country',
    px: [1400, 80],
    source: `${DOCS}`,
    refLabel: 'Страна молнии',
  },
  {
    id: 'core:land-of-water',
    name: 'Країна Води',
    kind: 'country',
    px: [1500, 570],
    source: DOCS,
    refLabel: 'Страна воды',
  },
  {
    id: 'core:land-of-waves',
    name: 'Країна Хвиль',
    kind: 'country',
    px: [1150, 707],
    source: `${DOCS}; ${WIKI}`,
    refLabel: 'Страна волн',
  },
  {
    id: 'core:land-of-forests',
    name: 'Країна Лісів',
    kind: 'country',
    px: [1190, 822],
    source: `${TR}: за написом на мапі (Страна лесов)`,
    refLabel: 'Страна лесов',
  },
  {
    id: 'core:land-of-rivers',
    name: 'Країна Річок',
    kind: 'country',
    px: [575, 700],
    source: `${TR}: за написом на мапі (Страна рек)`,
    refLabel: 'Страна рек',
  },
  {
    id: 'core:disputed-lands',
    name: 'Спірні землі',
    kind: 'country',
    px: [765, 322],
    source: `${TR}: за написом на мапі (Спорные земли)`,
    refLabel: 'Спорные земли',
  },
  {
    id: 'core:land-of-sound',
    name: 'Країна Звуку',
    kind: 'country',
    px: [860, 190],
    source: `${DOCS}; у минулому — Країна Рисових Полів (${WIKI})`,
    refLabel: 'Страна звука',
  },
  {
    id: 'core:land-of-steam',
    name: 'Країна Пари',
    kind: 'country',
    px: [925, 380],
    source: `${TR}: за написом на мапі (Страна пара)`,
    refLabel: 'Страна пара',
  },
  {
    id: 'core:land-of-frost',
    name: 'Країна Морозу',
    kind: 'country',
    px: [1040, 330],
    source: `${TR}: за написом на мапі (Страна мороза)`,
    refLabel: 'Страна мороза',
  },
];
