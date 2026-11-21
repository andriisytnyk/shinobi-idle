/**
 * `testmod`: the test pack. It adds one entity of every kind the card names, as data, to prove that
 * a second pack can extend the game without a line of code. Every id is `testmod:<slug>` and every
 * text says that it is a test. It is exported only through `@shinobi/content/testmod`: the app
 * bundle never imports it.
 */
import type { ContentPack, PackData } from '../../pack.ts';

const data = {
  // ----- vocabularies -----
  natures: [
    {
      id: 'testmod:aether',
      /** The wheel: this nature beats a nature of the core pack. */
      strongAgainst: ['katon'],
      color: '--nature-testmod-aether',
      opens: [],
      ayaNature: 'raiton',
    },
  ],
  playerRanks: [{ id: 'testmod:adept', tier: 3 }],
  /** An AI tier with its own wait: the adept (and the test boss, by its `aiTier`) wait for the moment 300 ms, shorter than any tier of the core. */
  ai: {
    visibleTraits: [],
    tiers: [
      {
        id: 'testmod:keen',
        minTier: 3,
        rules: ['heal', 'answer', 'best', 'basic'],
        waitMs: 300,
        tactical: true,
      },
    ],
  },
  missionRanks: [{ id: 'testmod:trial' }],
  currencies: [{ id: 'testmod:token' }],
  villageStages: [{ id: 'testmod:stage3', rep: 'testmod:stage3', cap: 6 }],
  states: [{ id: 'testmod:chilled' }],
  /**
   * A status with a damage over time and a stat modifier (two effects of one status), which stacks
   * to two: a technique whose state is `testmod:chilled` puts it on the body it hits.
   */
  statuses: [
    {
      id: 'testmod:chill',
      state: 'testmod:chilled',
      effects: [
        { kind: 'periodic', from: 'maxHp', amount: 'ext.testmod.chillDot' },
        { kind: 'modifier', stat: 'speed', op: 'mul', value: 'ext.testmod.chillSlow' },
      ],
      duration: 'ext.testmod.chillSecs',
      stacks: 2,
    },
  ],
  /** Its nature (skill) hitting a body that is chilled breaks the chill in a blow of `K.combo` times the hit. */
  combos: [
    {
      id: 'testmod:frostburn',
      nature: 'testmod:aether',
      onState: 'testmod:chilled',
      effect: { kind: 'burst' },
    },
  ],
  /** A role of the combat clones: it picks the single cheapest technique, and the enemies mind its clones thrice as much. */
  cloneRoles: [
    {
      id: 'testmod:role_decoy',
      threat: 3,
      hand: {
        mode: 'pick',
        size: 1,
        weights: { damage: 0, status: 0, opens: 0, cheap: 1 },
      },
    },
  ],
  /** A kind of pouch slot of the pack: one more slot, for what cures (the elixir), two units into every fight. */
  pouchKinds: [{ id: 'testmod:pk_phials', uses: ['cleanse'], perFight: 2, slots: 1 }],
  /** A tag that cracks a shell: the body takes more damage while the crack lasts and the trait stops. */
  tags: [
    {
      id: 'testmod:crack',
      onHit: [
        {
          op: 'effect',
          id: 'testmod:cracked',
          effects: [
            { kind: 'modifier', stat: 'damageTaken', op: 'mul', value: 'ext.testmod.crackMult' },
          ],
          duration: 'ext.testmod.crackSecs',
          suppresses: 'testmod:shelled',
          tally: { as: 'testmod:crackBreak', whenSuppressing: true },
        },
      ],
    },
  ],
  roles: [{ id: 'testmod:sapper' }],
  /** Armour in data: it cuts damage by `K.ext.testmod.shellArmor`; a core tool tag answers it. */
  traits: [
    {
      id: 'testmod:shelled',
      answer: 'area',
      numbers: { from: 'ext.testmod', keys: ['shellArmor'] },
      mods: [
        {
          stat: 'damageTaken',
          op: 'mul',
          value: { path: 'ext.testmod.shellArmor', oneMinus: true },
        },
      ],
      priority: 5,
    },
  ],

  // ----- skill, technique, seal -----
  skills: [
    {
      id: 'testmod:forge',
      group: 'craft',
      /** `recipe` is an activity that the existing crafting action runs. */
      activity: 'recipe',
      unlockReq: { t: 'rank', rank: 'genin' },
    },
    {
      /** The skill of the test nature: a nature trains through the skill that has its id. */
      id: 'testmod:aether',
      group: 'nin',
      activity: 'tech',
      unlockReq: { t: 'nature', nature: 'testmod:aether' },
    },
  ],
  seals: [{ id: 'testmod:glyph', glyph: 'Т', romaji: 'Test', kind: 'special' }],
  techniques: [
    {
      id: 'testmod:ember_pulse',
      skill: 'testmod:aether',
      level: 3,
      rank: 'D',
      rankCanon: false,
      role: 'testmod:sapper',
      tags: ['testmod:crack'],
      state: 'testmod:chilled',
      /** Carried by the test boss: a scroll part of it drops. */
      src: 'O',
      mentor: null,
      sealSeq: ['testmod:glyph'],
      sealsCanon: false,
      tier: 0,
      noDamage: false,
      cast: 1.5,
      /** The combo fires whenever its rule is met (a chilled body), without a roll. */
      combat: { effect: { kind: 'damage' }, guaranteedCombo: 'testmod:frostburn' },
    },
    {
      /** A trainer technique of the test nature: the player practises it to train the skill. */
      id: 'testmod:aether_touch',
      skill: 'testmod:aether',
      level: 1,
      rank: 'E',
      rankCanon: false,
      role: 'testmod:sapper',
      tags: [],
      state: null,
      src: 'N',
      mentor: 'academy',
      sealSeq: ['testmod:glyph'],
      sealsCanon: false,
      tier: 0,
      noDamage: false,
      /** A cast of its own, whatever its rank, role and seals say. */
      cast: 3,
      combat: { effect: { kind: 'damage' } },
    },
    {
      /** A defensive technique of a pack: passive, it adds to the evasion rating by its mastery and is never in the hand. */
      id: 'testmod:glass_veil',
      skill: 'testmod:aether',
      level: 1,
      rank: 'E',
      rankCanon: false,
      role: 'testmod:sapper',
      tags: [],
      state: null,
      src: 'N',
      mentor: 'academy',
      sealSeq: ['testmod:glyph'],
      sealsCanon: false,
      tier: 0,
      noDamage: true,
      cast: 1,
      combat: { effect: { kind: 'none' }, passive: { fx: 'testmod:veil' } },
    },
    {
      /** An attack with the interrupt tag: when it hits a fighter that is casting, the cast is broken. */
      id: 'testmod:shatter_pulse',
      skill: 'testmod:aether',
      level: 4,
      rank: 'D',
      rankCanon: false,
      role: 'testmod:sapper',
      tags: ['interrupt'],
      state: null,
      src: 'N',
      mentor: 'academy',
      sealSeq: ['testmod:glyph'],
      sealsCanon: false,
      tier: 0,
      noDamage: false,
      cast: 0.8,
      combat: { effect: { kind: 'damage' } },
    },
  ],

  // ----- items, recipe, gear -----
  items: [
    { id: 'testmod:pellet', kind: 'ingredient', tags: [], extraSources: [], madeFrom: [] },
    {
      id: 'testmod:charm',
      kind: 'tool',
      tags: ['testmod:crack'],
      extraSources: [],
      madeFrom: [{ item: 'testmod:pellet', n: 2 }],
      /** Sold for tokens: the price is `K.goods['testmod:charm']`. */
      buy: 'testmod:charm',
    },
    {
      id: 'testmod:scrollpart_ember_pulse',
      kind: 'misc',
      tags: [],
      extraSources: [],
      madeFrom: [],
      part: { technique: 'testmod:ember_pulse' },
    },
    {
      id: 'testmod:elixir',
      kind: 'consumable',
      tags: [],
      extraSources: [],
      madeFrom: [],
      /** An explicit rule of its own: shown fully only once the test skill reaches level 2. */
      reveal: { full: [{ req: { t: 'skill', skill: 'testmod:forge', level: 2 } }] },
      /** Removes the test status: the status is referenced, so the closure validator checks it. */
      fx: { kind: 'cleanse', statuses: ['testmod:chill'] },
    },
  ],
  recipes: [
    {
      id: 'testmod:elixir_brew',
      skill: 'testmod:forge',
      level: 1,
      ingredients: [{ item: 'testmod:pellet', n: 2 }],
      output: { item: 'testmod:elixir', n: 1 },
      tags: [],
    },
  ],
  /** A work of another skill than the first scouting one: a pack may let any skill work a found point. */
  fieldworks: [
    {
      id: 'testmod:scrap_sifting',
      point: 'core:war_fort_ruins',
      skill: 'testmod:forge',
      level: 1,
      cycle: 5,
      xp: 3,
      drops: [{ chance: 0.5, payout: { items: [{ item: 'testmod:pellet', n: 1 }] } }],
    },
  ],
  gear: [
    {
      id: 'testmod:anvil',
      skill: 'testmod:forge',
      tiers: [{ tier: 'I', level: 5, building: null }],
      fx: { key: 'xp.skill.testmod:forge', perTier: 'sickle', effect: 'bonus' },
    },
  ],

  // ----- enemy, boss -----
  enemies: [
    {
      id: 'testmod:shellback',
      region: 'forest',
      cl: 5,
      traits: ['testmod:shelled'],
      nature: 'testmod:aether',
      carries: null,
      hp: 100,
      dmg: 5,
      style: 'melee',
      /** The second row is rare (under `K.bingo.rareBelow`): the Bingo book hides it until the entry is studied. */
      drops: [
        { item: 'testmod:pellet', chance: 0.2 },
        { item: 'testmod:charm', chance: 0.005 },
      ],
      ryo: [20, 30],
      bounty: null,
      scrollPart: null,
    },
  ],
  bosses: [
    {
      id: 'testmod:boss_shell',
      cl: 8,
      aiTier: 'testmod:keen',
      traits: ['testmod:shelled'],
      nature: 'testmod:aether',
      carries: 'testmod:ember_pulse',
      hp: 300,
      dmg: 9,
      style: 'melee',
      drops: [{ item: 'testmod:elixir', chance: 0.5 }],
      ryo: [60, 90],
      bounty: { first: 100, repeatShare: 0.2 },
      scrollPart: {
        item: 'testmod:scrollpart_ember_pulse',
        technique: 'testmod:ember_pulse',
        count: 2,
      },
      /** Every third attack is a heavy one: a hook the pack's `rules` registers. */
      special: {
        kind: 'testmod:thirdStrike',
        fx: 'testmod:third',
        hook: 'testmod:thirdStrike',
        numbers: ['mult'],
      },
    },
  ],

  // ----- world -----
  /** The places where the pack's enemy and boss are fought. */
  zones: [
    { id: 'testmod:zone_shellback', enemy: 'testmod:shellback', region: 'academy', unlock: null },
    { id: 'testmod:zone_boss_shell', enemy: 'testmod:boss_shell', region: 'boss', unlock: null },
  ],
  /**
   * A raid of the pack on the village: called by a flag a test sets, defended by the pack's hut, damaging
   * the hut. It proves that a pack's raid is announced in its own words, and that its state survives
   * a load without the pack.
   */
  raids: [
    {
      id: 'testmod:raid_probe',
      trigger: { t: 'flag', id: 'testmod.raid.call' },
      enemy: 'testmod:shellback',
      packs: 2,
      lead: 1,
      hold: 2,
      defence: [{ t: 'building', id: 'testmod:hut', per: 10 }],
      perPack: 10,
      autoShare: 0.5,
      targets: ['testmod:hut'],
      repair: 3,
      reward: { ryo: 20, rep: 1 },
    },
  ],
  /**
   * A two-hex island off the south-east coast of the Land of Fire. The grid is full, so the pack makes
   * two hexes of open sea its own land with `patches` (below), and a ferry (a `link`) joins the coast
   * to the island: the island can be surveyed from the coast and walked to.
   */
  countries: [{ id: 'testmod:isle' }],
  links: [{ id: 'testmod:ferry', a: [15, 17], b: [18, 17], minutes: 5, kind: 'ferry' }],
  /**
   * The pack's own points of interest, as data on its places: a beacon that gives a bonus of a key the
   * pack declares while a performer stands there, and a watch that joins it in a travel group of the pack.
   */
  places: [
    {
      id: 'testmod:isle_beacon',
      hex: [17, 17],
      kind: 'beacon',
      role: 'landmark',
      point: {
        reward: { currencies: { 'testmod:token': 2 } },
        power: [{ key: 'testmod:forge.bonus', op: 'add', value: 0.1 }],
        travel: 'testmod:beacons',
      },
    },
    {
      id: 'testmod:isle_watch',
      hex: [18, 17],
      kind: 'tower',
      role: 'landmark',
      point: { reward: { ryo: 7 }, travel: 'testmod:beacons' },
    },
  ],
  regions: [{ id: 'testmod:grove', scout: 1, cells: ['testmod:grove_edge'] }],
  cells: [
    {
      id: 'testmod:grove_edge',
      region: 'testmod:grove',
      hex: [17, 17],
      index: 0,
      key: null,
      story: false,
      pois: [
        { id: 'testmod:poi_grove_edge_outpost', kind: 'outpost' },
        {
          id: 'testmod:poi_grove_cache',
          kind: 'cache',
          items: [],
          ryo: 0,
          /** A cache that pays tokens. */
          currencies: { 'testmod:token': 3 },
        },
      ],
    },
  ],
  buildings: [
    {
      id: 'testmod:hut',
      tier6: null,
      role: 'bonus',
      effects: [{ key: 'testmod:forge.bonus', op: 'add', value: 0.01 }],
      capstone: [],
      produces: [],
      /** Can be built only from the village stage of the pack. */
      stage: 'testmod:stage3',
    },
  ],

  // ----- missions and quests -----
  missions: [
    {
      id: 'testmod:test_run',
      rank: 'testmod:trial',
      team: false,
      minutes: 2,
      stages: [{ t: 'skill', skill: 'testmod:forge', min: 1, label: true }],
      pay: [{ kind: 'currency', currency: 'testmod:token', n: 2 }],
      resource: null,
      ryo: 10,
      rep: 0,
      /** Opens at the rank of the pack. */
      unlock: { t: 'rank', rank: 'testmod:adept' },
      shares: [1],
      slow: [[]],
      skip: [0],
      resourceMod: null,
      board: true,
      rateCap: 20,
    },
  ],
  shop: [
    {
      /** Opens at the rank of the pack and is paid in the currency of the pack. */
      item: 'testmod:charm',
      req: { t: 'rank', rank: 'testmod:adept' },
      currency: 'testmod:token',
    },
  ],
  renownRanks: [
    {
      id: 'testmod:renown_pellet',
      renown: 150,
      rewards: {
        items: [{ item: 'testmod:pellet', n: 1 }],
        flags: ['testmod.renown'],
        mods: [],
        opens: [{ kind: 'item', id: 'testmod:pellet' }],
      },
    },
  ],
  exams: [
    {
      id: 'testmod:adept_exam',
      rank: 'testmod:adept',
      checklist: {
        t: 'all',
        of: [
          { t: 'rank', rank: 'chunin' },
          { t: 'skill', skill: 'testmod:forge', level: 2 },
        ],
      },
      reduceBy: ['testmod:forge'],
      rewards: { items: [{ item: 'testmod:pellet', n: 5 }], goal: null },
    },
  ],
  quests: [
    {
      id: 'testmod:test_chain',
      chain: 'testmod:test_chain',
      unlock: null,
      steps: [
        {
          textKey: 'quest.testmod:test_chain.step.1',
          objective: { t: 'req', req: { t: 'skill', skill: 'testmod:forge', level: 2 } },
        },
      ],
      rewards: {
        items: [{ item: 'testmod:pellet', n: 1 }],
        ryo: 0,
        rep: 0,
        currencies: { 'testmod:token': 3 },
        flags: [],
        rank: null,
      },
    },
  ],
} satisfies Record<string, unknown>;

export const testmodPack: ContentPack = {
  manifest: {
    id: 'testmod',
    version: '0.1.0',
    dependsOn: ['core'],
    loadAfter: [],
    /** The pack's own default for its items: shown only once the player holds one (no name stage, no marking). */
    reveal: { item: { full: ['owned'] } },
  },
  data: data as unknown as PackData,
  balance: {
    K: {
      ryoPerMin: { 'testmod:trial': 5 },
      repPerMission: { 'testmod:trial': 0 },
      missionRateCap: { 'testmod:trial': 20 },
      role: { 'testmod:sapper': { m: 0.5, cd: 8, c: 1 } },
      combo: { 'testmod:frostburn': 0.3 },
      bossFx: { 'testmod:third': { mult: 2.5, hp: 1, dmg: 1 } },
      passiveFx: { 'testmod:veil': { evasion: 25 } },
      rep: { 'testmod:stage3': 500 },
      goods: { 'testmod:charm': 10 },
      ext: {
        testmod: {
          shellArmor: 0.2,
          chillDot: 0.01,
          chillSlow: 0.8,
          chillSecs: 6,
          crackMult: 1.25,
          crackSecs: 8,
        },
      },
    },
    pace: {
      'testmod:forge': [3, 7, 11, 17, 25],
      'testmod:aether': [3, 7, 11, 17, 25],
    },
  },
  locales: {
    uk: {
      'fieldwork.testmod:scrap_sifting.name': 'Тестове перебирання брухту',
      'fieldwork.testmod:scrap_sifting.desc':
        'Тестова робота пакета: доводить, що мод додає роботу на місці даними.',
      'skill.testmod:forge.name': 'Тестова кузня',
      'skill.testmod:forge.desc':
        'Тестова навичка пакета перевірки: вона лише доводить, що мод додає навички даними.',
      'nature.testmod:aether.name': 'Тестовий ефір',
      'skill.testmod:aether.name': 'Тестовий ефір (навичка)',
      'skill.testmod:aether.desc':
        'Навичка тестової природи: доводить, що природу мода тренує власна навичка.',
      'technique.testmod:aether_touch.name': 'Тестовий дотик ефіру',
      'technique.testmod:aether_touch.desc':
        'Тестова техніка наставника: її тренування розвиває тестову навичку ефіру.',
      'technique.testmod:glass_veil.name': 'Скляна завіса',
      'technique.testmod:glass_veil.desc':
        'Тестова пасивна техніка: додає до ухилення тим більше, чим вища Майстерність.',
      'technique.testmod:shatter_pulse.name': 'Розбивний імпульс',
      'technique.testmod:shatter_pulse.desc':
        'Тестова атака з тегом переривання: ламає каст того, у кого влучає.',
      'exam.testmod:adept_exam.name': 'Тестовий іспит адепта',
      'exam.testmod:adept_exam.desc': 'Тестовий іспит пакета: він дає тестовий ранг адепта.',
      'rank.testmod:adept': 'Тестовий адепт',
      'renownRank.testmod:renown_pellet.name': 'Тестова слава',
      'renownRank.testmod:renown_pellet.desc': 'Тестовий ранг Репутації, який додає пакет.',
      'renownRank.testmod:renown_pellet.reward': 'Тестова кулька.',
      'currency.testmod:token': 'Тестовий жетон',
      'state.testmod:chilled.name': 'Тестове охолодження',
      'status.testmod:chill.name': 'Тестовий холод',
      'status.testmod:chill.desc': 'Тестовий стан, що показує: мод додає власні стани бою.',
      'pouchKind.testmod:pk_phials.name': 'Тестові флакони',
      'pouchKind.testmod:pk_phials.desc': 'Тестовий вид слота підсумка, який додає пакет.',
      'cloneRole.testmod:role_decoy.name': 'Тестова приманка',
      'cloneRole.testmod:role_decoy.desc':
        'Тестова роль клонів: найдешевша техніка й потрійна увага ворогів.',
      'combo.testmod:frostburn.name': 'Тестовий морозний опік',
      'combo.testmod:frostburn.desc':
        'Тестове поєднання, яке мод додає даними без жодного рядка коду.',
      'tag.testmod:crack.name': 'Тестова тріщина',
      'role.testmod:sapper.name': 'Тестовий сапер',
      'trait.testmod:shelled.name': 'Тестовий панцир',
      'trait.testmod:shelled.desc':
        'Тестова риса ворога, відповідь на яку дає тестова мітка тріщини.',
      'seal.testmod:glyph.name': 'Тестовий знак',
      'seal.testmod:glyph.desc': 'Тестова печатка, що доводить: мод додає й печатки для технік.',
      'technique.testmod:ember_pulse.name': 'Тестовий імпульс жару',
      'technique.testmod:ember_pulse.desc':
        'Тестова техніка мода, яку можна вивчити, як і будь-яку іншу.',
      'technique.testmod:ember_pulse.home': 'Тестовий пакет',
      'technique.testmod:ember_pulse.note': 'Лише для перевірки модів.',
      'item.testmod:pellet.name': 'Тестова кулька',
      'item.testmod:pellet.desc': 'Тестовий інгредієнт, який мод додає разом із власним рецептом.',
      'item.testmod:charm.name': 'Тестовий оберіг',
      'item.testmod:charm.desc': 'Тестове знаряддя, що відповідає на тестову рису панцира ворога.',
      'item.testmod:scrollpart_ember_pulse.name': 'Тестова частина сувою',
      'item.testmod:scrollpart_ember_pulse.desc':
        'Тестова частина сувою, яку лишає тестовий бос: кілька частин складаються в сувій.',
      'item.testmod:elixir.name': 'Тестовий еліксир',
      'item.testmod:elixir.desc': 'Тестовий витратний предмет, який знімає тестовий стан холоду.',
      'recipe.testmod:elixir_brew.name': 'Тестове варіння еліксиру',
      'recipe.testmod:elixir_brew.desc':
        'Тестовий рецепт нової навички мода: з кульок виходить еліксир.',
      'gear.testmod:anvil.name': 'Тестова ковадла',
      'gear.testmod:anvil.desc':
        'Тестове спорядження нової навички: воно трохи прискорює її розвиток.',
      'enemy.testmod:shellback.name': 'Тестовий панцирник',
      'enemy.testmod:shellback.desc': 'Тестовий ворог мода з тестовою рисою та тестовою природою.',
      'boss.testmod:boss_shell.name': 'Тестовий вартовий',
      'boss.testmod:boss_shell.desc':
        'Тестовий бос мода зі своїм особливим ударом і власними числами.',
      'boss.testmod:boss_shell.place': 'Тестовий гай',
      'country.testmod:isle.name': 'Тестовий острів',
      'region.testmod:grove.name': 'Тестовий гай',
      'region.testmod:grove.desc':
        'Тестовий регіон мода з однією клітинкою на острові: до неї йде переправа з узбережжя.',
      'place.testmod:isle_beacon.name': 'Тестовий маяк',
      'place.testmod:isle_beacon.desc':
        'Маяк тестового острова: дає тестовий бонус, поки біля нього хтось стоїть.',
      'place.testmod:isle_watch.name': 'Тестова вартова вежа',
      'place.testmod:isle_watch.desc':
        'Вежа на другому гексі острова; сполучена з маяком вільною дорогою.',
      'cell.testmod:grove_edge.name': 'Край тестового гаю',
      'cell.testmod:grove_edge.note': 'Єдина клітинка тестового регіону.',
      'poi.testmod:poi_grove_cache.name': 'Тестовий тайник',
      'poi.testmod:poi_grove_cache.desc': 'Тестова схованка, що платить тестовими жетонами.',
      'poi.testmod:poi_grove_edge_outpost.name': 'Тестова застава',
      'poi.testmod:poi_grove_edge_outpost.desc':
        'Тестова точка інтересу відомого виду: застава, з якої видно трохи далі.',
      'building.testmod:hut.name': 'Тестова хатина',
      'building.testmod:hut.desc': 'Тестова будівля мода з одним власним модифікатором за рівень.',
      'mission.testmod:test_run.name': 'Тестове доручення',
      'mission.testmod:test_run.desc':
        'Тестове доручення нового рангу, яке виконує нова навичка мода.',
      'mission.testmod:test_run.client': 'Тестовий замовник',
      'mission.testmod:test_run.stage.0.label': 'Тестова робота',
      'quest.testmod:test_chain.name': 'Тестовий ланцюжок',
      'quest.testmod:test_chain.step.1': 'Досягни другого рівня тестової кузні.',
      'quest.testmod:test_chain.desc':
        'Тестовий ланцюжок доручень мода: одна ціль для перевірки журналу.',
      'nature.testmod:aether.desc':
        'Тестова природа мода: вона лише доводить, що мод додає природи даними.',
      'missionRank.testmod:trial.name': 'Тестове випробування',
      'missionRank.testmod:trial.desc':
        'Тестовий ранг доручень мода: доручення цього рангу лише для перевірки.',
      'missionRank.testmod:trial.stamp': 'Т',
      'raid.testmod:raid_probe.name': 'Тестовий напад мода',
      'raid.testmod:raid_probe.desc':
        'Тестовий напад мода на село: він лише доводить, що напад мода говорить своїми словами.',
      'stage.testmod:stage3.name': 'Тестовий етап села',
      'stage.testmod:stage3.desc': 'Тестовий етап села, який мод додає після відомих.',
      'state.testmod:chilled.desc': 'Тестовий стан охолодження, на який діє тестове комбо.',
      'tag.testmod:crack.desc': 'Тестова мітка техніки: відповідь на тестову рису панцира.',
      'role.testmod:sapper.desc': 'Тестова роль техніки мода.',
      'modifier.testmod:forge.bonus': 'Тестовий бонус кузні',
    },
  },
  icons: { skill: { 'testmod:forge': 'anvil' } },
  modifierKeys: {
    'testmod:forge.bonus': {
      desc: 'A test bonus that only the test pack declares',
      flat: false,
      wired: false,
    },
  },
  patches: [
    {
      /** Open sea becomes the forest of the island: a pack can make a hex outside the playable land playable. */
      target: { kind: 'hexes', id: '17,17' },
      set: { country: 'testmod:isle', terrain: 'forest' },
    },
    { target: { kind: 'hexes', id: '18,17' }, set: { country: 'testmod:isle', terrain: 'plains' } },
    {
      /** The wheel both ways: a core nature beats the test nature, which beats another core one. */
      target: { kind: 'natures', id: 'doton' },
      append: { strongAgainst: ['testmod:aether'] },
    },
    {
      /** A new drop row on a core enemy: the pack changes another pack's entity explicitly. */
      target: { kind: 'enemies', id: 'core:wolf' },
      append: { drops: [{ item: 'testmod:pellet', chance: 0.05 }] },
    },
  ],
  ui: 'testmod',
};
