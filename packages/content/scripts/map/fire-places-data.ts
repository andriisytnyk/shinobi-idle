// Interesting places of the playable part of the Land of Fire (hand-made, ours). Names and descriptions are
// Ukrainian and written by us; the sources only say that a place exists, where it lies and when. Nothing is
// copied from them. See docs/.../map/README.md for the research, the exclusions and the density reasoning.

export type FireRole =
  | 'settlement' // a village or town: shop, quest giver
  | 'outpost' // «Застава» of the slice
  | 'training' // place of training
  | 'deposit' // deposit (Lumber mill, Mine, Fishing grounds +1)
  | 'cache' // hideout, stash
  | 'vault' // sealed vault with a single prize
  | 'zone' // enemy camp: a combat zone started from the map
  | 'landmark'; // memorial place, lore entry, story anchor

export type FireKind =
  | 'hidden-village'
  | 'town'
  | 'village'
  | 'hamlet'
  | 'tea-house'
  | 'temple'
  | 'shrine'
  | 'statues'
  | 'training-ground'
  | 'forest'
  | 'castle-pass'
  | 'outpost'
  | 'camp'
  | 'lair'
  | 'ruins'
  | 'cellar'
  | 'saltworks'
  | 'house'
  | 'valley'
  | 'forest-haunted';

/** canon = the source places it in the Land of Fire in the player's era; invented = ours;
 * map-only = taken from the reference map, but the source puts it elsewhere or later (flagged for the author). */
export type FireStatus = 'canon' | 'invented' | 'map-only';

export type FireAt =
  | { ref: string } // an entry of places.json (hex already there)
  | { cell: string } // the hex of a slice cell ("forest#3")
  | { col: number; row: number }; // a fresh hex (offset coordinates of grid.ts)

export interface FirePlaceDef {
  id: string;
  name: string;
  /** Short label for the preview; absent = use the full name. */
  short?: string;
  /** false = marker only on the preview (minor place). Labels that find no free spot are dropped too. */
  label: boolean;
  kind: FireKind;
  role: FireRole;
  at: FireAt;
  description: string;
  status: FireStatus;
  era: string;
  sources: [label: string, url: string][];
  /** Remarks for the author: placement approximate, canon conflict. */
  note?: string;
}

const NP = (page: string): [string, string] => [
  `Narutopedia: ${page.replace(/_/g, ' ')}`,
  `https://naruto.fandom.com/wiki/${page}`,
];

export const FIRE_PLACES: FirePlaceDef[] = [
  // ---- canonical ---------------------------------------------------------------------------------
  {
    id: 'core:hidden-leaf',
    name: 'Селище Прихованого Листя (Коноха)',
    label: true,
    kind: 'hidden-village',
    role: 'settlement',
    at: { ref: 'core:hidden-leaf' },
    description:
      'Твоє село: Академія, Бюро місій, ринок і Вежа Каґе. Усе, що лежить на мапі довкола, починається від його брам.',
    status: 'canon',
    era: 'Засноване за життя Першого Хокаґе, тобто за кілька десятиліть до гри; існує всю гру.',
    sources: [NP('Konohagakure'), NP('Land_of_Fire')],
  },
  {
    id: 'core:tanzaku',
    name: 'Місто Танзаку',
    label: true,
    kind: 'town',
    role: 'settlement',
    at: { ref: 'core:tanzaku' },
    description:
      'Галасливе місто азарту й забав на заході, куди їдуть розважитися. Над ним стоїть старий замок, улюблена пам’ятка мандрівників.',
    status: 'canon',
    era: 'Місто й замок Танзаку діють у першій частині серії; замок гине вже після іспиту на Чуніна.',
    sources: [NP('Tanzaku_Quarters')],
    note: 'Замок Танзаку входить у це місце, окремого гекса не має (щоб не роздувати щільність). Джерело ставить місто «на південний захід» від Листя; на мапі воно на заході.',
  },
  {
    id: 'core:shukuba',
    name: 'Місто Сюкуба',
    label: true,
    kind: 'town',
    role: 'settlement',
    at: { ref: 'core:shukuba' },
    description:
      'Станційне містечко за кілька годин ходу від Листя: готелі, харчевні й чутки. Тут охоче зупиняються всі, хто прямує на захід.',
    status: 'canon',
    era: 'Діє в першій частині серії (його відвідують, шукаючи Цунаде); отже, існує вже в епоху гри.',
    sources: [NP('Shukuba_Town')],
    note: 'Назва «Містечко на рівнинах» клітинки plains#2 збігається з Сюкубою (рішення кроку 1).',
  },
  {
    id: 'core:valley-of-the-end',
    name: 'Долина Завершення',
    label: true,
    kind: 'valley',
    role: 'training',
    at: { ref: 'core:valley-of-the-end' },
    description:
      'Глибока розколина на північному кордоні, прорізана поєдинком двох засновників. Над водоспадом стоять статуї; тут добре тренувати удар.',
    status: 'canon',
    era: 'Утворилася невдовзі після заснування Листя, задовго до епохи гри.',
    sources: [NP('Valley_of_the_End'), NP('Land_of_Fire')],
  },
  {
    id: 'core:fire-temple',
    name: 'Храм Вогню',
    short: 'Храм Вогню',
    label: true,
    kind: 'temple',
    role: 'training',
    at: { cell: 'plains#3' },
    description:
      'Монастир ченців-шинобі, оточений лісами; про нього знає вся країна. Монахи охоче вчать тих, хто приходить із повагою.',
    status: 'canon',
    era: 'Діє до другої частини серії (ченці й настоятель живі); у першій частині — давно діючий монастир.',
    sources: [NP('Fire_Temple')],
    note: 'Джерело не називає відстані від Листя; на цей гекс його ставить клітинка plains#3 зрізу.',
  },
  {
    id: 'core:training-ground-44',
    name: 'Полігон №44 «Ліс смерті»',
    short: 'Полігон №44',
    label: true,
    kind: 'training-ground',
    role: 'training',
    at: { cell: 'forest#5' },
    description:
      'Обгороджений ліс на околиці села, повний отруйних рослин і великих звірів. Саме тут перевіряють генінів перед званням Чуніна.',
    status: 'canon',
    era: 'Полігон і вежа діють уже до іспиту на Чуніна, на якому його вперше показано.',
    sources: [NP('Forty-Fourth_Training_Ground')],
    note: 'Джерело ставить полігон на околиці села, північніше Полігону №43.',
  },
  {
    id: 'core:nara-forest',
    name: 'Ліс клану Нара',
    short: 'Ліс Нара',
    label: true,
    kind: 'forest',
    role: 'landmark',
    at: { cell: 'forest#3' },
    description:
      'Заповідний ліс клану Нара край села: олені, яких тут доглядають, і правило, що чужим без дозволу вхід заборонено. Згарище складу стоїть на самій його межі.',
    status: 'canon',
    era: 'Земля клану Нара, давніша за гру; змін до іспиту на Чуніна не зазнає.',
    sources: [NP('Nara_Clan_Forest')],
    note: 'Лише назва й заборона входу взяті з джерела; клітинка «Згарище складу» лишається з власним змістом.',
  },
  {
    id: 'core:kikyo-pass',
    name: 'Перевал і замок Кікьо',
    short: 'Перевал Кікьо',
    label: true,
    kind: 'castle-pass',
    role: 'landmark',
    at: { cell: 'valley#10' },
    description:
      'Гірський перевал, де наприкінці Третьої війни Листя зазнало важкої битви. Поряд на пагорбі стоїть старий замок з дахами у формі риб.',
    status: 'canon',
    era: 'Битва — кінець Третьої війни (до гри), замок діє в першій частині серії.',
    sources: [NP('Kikyō_Pass'), NP('Kikyō_Castle')],
    note: 'Джерело каже лише «біля кордону Листя»; клітинка «Старе поле бою» (старовинні монети) дає місце. Перевал і замок об’єднано в одне місце.',
  },
  {
    id: 'core:jofuku-forest',
    name: 'Ліс Джофуку',
    short: 'Ліс Джофуку',
    label: true,
    kind: 'forest-haunted',
    role: 'landmark',
    at: { cell: 'valley#7' },
    description:
      'Туманний гірський ліс на межі країни, де ростуть лікувальні квіти. Місцеві кажуть, що там водяться привиди, і без потреби туди не ходять.',
    status: 'canon',
    era: 'Гора й ліс — природні об’єкти, які показано в аніме-вставках; жодних подій, що змінюють їх, до іспиту немає.',
    sources: [NP('Jofuku_Forest'), NP('Mount_Jofuku')],
    note: 'Лише аніме; положення «на межі країни» наближене до північного кордону. Якщо автор не бере аніме-контент — прибрати.',
  },
  // ---- from the reference map; the canon puts them elsewhere -----------------------------------
  {
    id: 'core:bamboo-village',
    name: 'Бамбукове село',
    label: true,
    kind: 'village',
    role: 'settlement',
    at: { ref: 'core:bamboo-village' },
    description:
      'Тихе село на гирлі річки, де ставлять бамбукові хатини й сушать рибу. Звідси йде східний тракт до скелястого берега.',
    status: 'map-only',
    era: 'Не встановлено: у каноні Бамбукове село лежить у Країні Гарячої Води й показане в романі, написаному після війни.',
    sources: [NP('Bamboo_Village')],
    note: 'Залишено, бо автор прийняв гекс; назва й опис — мапи-орієнтира й наші. Автору вирішити: лишити вигадане село під цією назвою чи перейменувати.',
  },
  {
    id: 'core:hell-valley',
    name: 'Пекельна долина',
    label: true,
    kind: 'valley',
    role: 'landmark',
    at: { ref: 'core:hell-valley' },
    description:
      'Скеляста улоговина біля берега, де з-під землі б’є гаряча каламутна вода. Пахне сіркою, а місцеві обходять її стороною.',
    status: 'map-only',
    era: 'Не встановлено: у каноні Пекельна долина лежить на острові Нанакуса на схід від Країни Вогню.',
    sources: [NP('Hell_Valley')],
    note: 'Залишено, бо автор прийняв гекс; опис наш. Автору вирішити: лишити як вигадане місце чи перейменувати.',
  },
  // ---- invented, on slice cells (name and story of the hex) -------------------------------------
  {
    id: 'core:west-gate-post',
    name: 'Західна застава',
    label: false,
    kind: 'outpost',
    role: 'outpost',
    at: { cell: 'forest#1' },
    description:
      'Дерев’яна будка вартових на західному тракті за кілька кроків від брами. Тут перевіряють вози й записують тих, хто йде до Сюкуби.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:rice-hamlet',
    name: 'Рисарський хутір',
    label: false,
    kind: 'hamlet',
    role: 'landmark',
    at: { cell: 'forest#2' },
    description:
      'Кілька хат серед терасних полів, що годують село. Господарі щовесни просять шинобі відігнати птахів і щурів.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:charcoal-camp',
    name: 'Табір вуглярів',
    short: 'Табір вуглярів',
    label: true,
    kind: 'camp',
    role: 'deposit',
    at: { cell: 'forest#10' },
    description:
      'Курені, де випалюють деревне вугілля для кузень села. Серед повалених дубів нишпорять розбійники, що вигадують собі сховки.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:fishers-camp',
    name: 'Рибальська стоянка',
    label: false,
    kind: 'camp',
    role: 'deposit',
    at: { cell: 'forest#11' },
    description:
      'Кілька човнів і сітки на лісовому озері. Рибалки знають кожну яму, де береться найкраща риба.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:caravan-yard',
    name: 'Караванний двір',
    short: 'Караванний двір',
    label: true,
    kind: 'camp',
    role: 'zone',
    at: { cell: 'plains#4' },
    description:
      'Колодязь і вигін, де торговці стають на ніч. Найманці в сірих пов’язках стежать за кожним возом, що рушає далі.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:mercenary-den',
    name: 'Табір найманців',
    short: 'Табір найманців',
    label: true,
    kind: 'lair',
    role: 'zone',
    at: { cell: 'plains#5' },
    description:
      'Табір важких найманців у степових заростях, подалі від доріг. Вони служать тому, хто платить, а село до них не належить.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:war-fort-ruins',
    name: 'Руїни фортеці Другої війни',
    short: 'Руїни фортеці',
    label: true,
    kind: 'ruins',
    role: 'landmark',
    at: { cell: 'plains#7' },
    description:
      'Розбита прикордонна фортеця з часів Другої війни. Мури обвалилися, а вцілілі підвали досі бережуть те, що забули евакуювати.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:fort-cellar',
    name: 'Підвали фортеці',
    label: false,
    kind: 'cellar',
    role: 'vault',
    at: { cell: 'plains#8' },
    description: 'Засипаний хід під валом веде до комори, де військові ховали цінні сувої.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:salt-pans',
    name: 'Соляні промисли',
    short: 'Соляні промисли',
    label: true,
    kind: 'saltworks',
    role: 'deposit',
    at: { cell: 'plains#9' },
    description:
      'Неглибокі басейни на березі, де вода випаровується до солі. Усю країну забезпечують сіллю з цього берега.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:deserted-farm',
    name: 'Покинутий хутір',
    label: false,
    kind: 'house',
    role: 'landmark',
    at: { cell: 'plains#12' },
    description:
      'Господарі виїхали ще до війни, а хата стоїть, як стояла. Двері хитаються, а в дворі хтось раз у раз розпалює багаття.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:hunter-lodge',
    name: 'Хатина мисливця',
    label: false,
    kind: 'house',
    role: 'landmark',
    at: { cell: 'valley#4' },
    description:
      'Самотня хатина над стежкою на північ. Мисливець за головами обирає її для засідок: вікна дивляться на всю стежку.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  {
    id: 'core:waterfall-shrine',
    name: 'Руїни святилища біля водоспаду',
    short: 'Руїни святилища',
    label: true,
    kind: 'shrine',
    role: 'training',
    at: { cell: 'valley#6' },
    description:
      'Напівзруйноване святилище під стіною води: дах провалився, а камінь для сидіння лишився. Тут добре сидіти нерухомо, доки вода шумить.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
  },
  // ---- invented, on fresh hexes ------------------------------------------------------------------
  {
    id: 'core:wayside-teahouse',
    name: 'Чайний будинок на розвилці',
    short: 'Чайний будинок',
    label: true,
    kind: 'tea-house',
    role: 'settlement',
    at: { col: 21, row: 15 },
    description:
      'Хатина з навісом там, де східний тракт розходиться до узбережжя. Господиня подає чай мандрівникам і знає всі новини з обох боків лісу.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
    note: 'Закриває порожній відтинок довжиною 4 гекси східного тракту.',
  },
  {
    id: 'core:fishing-village',
    name: 'Рибальське село Хамабе',
    short: 'Село Хамабе',
    label: true,
    kind: 'village',
    role: 'settlement',
    at: { col: 23, row: 17 },
    description:
      'Кілька хат і сушарок для риби на самому березі. У штормову погоду всі човни витягнуті на пісок, а чоловіки сидять по хатах.',
    status: 'invented',
    era: 'Вигадане; діє від початку гри.',
    sources: [],
    note: 'Дає східному узбережжю, де шість гексів поспіль без жодного місця, чим зацікавитися.',
  },
];
