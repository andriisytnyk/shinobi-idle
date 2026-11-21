import {
  content as defaultContent,
  type ContentDb,
  type NatureId,
  type SkillId,
} from '@shinobi/content';
import {
  advance,
  cellLevel,
  counterValue,
  defaultRules,
  dispatch,
  killsKey,
  raidFlag,
  missionDoneKey,
  refreshUnlocks,
  xpAt,
  type Command,
  type CommandResult,
  type GameEvent,
  type GameState,
  type Rules,
} from '@shinobi/core';
import { academyBot } from './bots/academy.ts';
import { runBot } from './runner.ts';
import { grantShopBuildings, modelFood, stockFromShop } from './character.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** What a scripted playthrough of the slice leaves behind. */
export interface StoryRun {
  state: GameState;
  /** One line per beat of the story, with the game time it happened at. */
  log: string[];
  /** Quest chains in the order they were finished. */
  chainOrder: string[];
  /** Fights the character lost, by enemy id: where the scripted levels were not enough. */
  lost: Record<string, number>;
}

export interface StoryOptions {
  seed?: number;
  content?: ContentDb;
  rules?: Rules;
  /** Called with every line of the log as it is written (for a test that prints it). */
  onLog?: (line: string) => void;
}

/**
 * The levels the documents' pace gives a character at each act of the slice (Genin about the first
 * hour, Chunin between the twelfth and the fifteenth). Training them hour by hour is what the
 * balance bots measure; the story script takes them as given, raises a skill that is lower, and
 * plays everything else, the quests, the missions, the fights and the exam, through the commands.
 */
const PACE: Record<string, Partial<Record<SkillId, number>>> = {
  genin: {
    tai: 24,
    nin: 24,
    katon: 24,
    vit: 24,
    med: 20,
    ath: 30,
    cc: 20,
    herb: 20,
    alch: 20,
    scout: 12,
    prov: 10,
  },
  act3: {
    tai: 34,
    nin: 34,
    katon: 34,
    suiton: 24,
    vit: 34,
    ath: 40,
    cc: 30,
    scout: 20,
    alch: 30,
    herb: 30,
  },
  chunin: {
    tai: 42,
    nin: 42,
    katon: 42,
    doton: 42,
    suiton: 42,
    vit: 42,
    ath: 40,
    cc: 40,
    scout: 22,
    alch: 45,
    med: 40,
    herb: 40,
  },
};

/**
 * A scripted strategy that plays the whole slice from a fresh save to the Chunin vest: every
 * quest chain in the order the story opens them, with real missions, exploration, fights, the
 * operations and the exam, all through `dispatch` and `advance`. Skills are taken to the levels of
 * `PACE` (see there); village buildings the shop and the village chain ask for are written to the
 * village state, as the sim's yardstick characters do.
 */
export function playSlice(options: StoryOptions = {}): StoryRun {
  const content = options.content ?? defaultContent;
  const rules = options.rules ?? defaultRules;
  const seed = options.seed ?? 1;
  const log: string[] = [];
  const chainOrder: string[] = [];
  const lost: Record<string, number> = {};

  // Act 1: the Academy, played by the academy bot.
  const academy = runBot(academyBot, { seed, content, rules, limitMs: 3 * HOUR });
  if (academy.ended !== 'done') throw new Error(`the Academy was not finished: ${academy.ended}`);
  const state = academy.state;
  for (const m of academy.timeline) if (m.type === 'questDone') chainOrder.push(m.id);

  const note = (line: string): void => {
    const text = `${(state.now / HOUR).toFixed(2)} h  ${line}`;
    log.push(text);
    options.onLog?.(text);
  };
  const drain = (): GameEvent[] => {
    const events = state.events.splice(0);
    for (const e of events) {
      if (e.type === 'questDone') {
        chainOrder.push(e.quest);
        note(`chain done: ${e.quest}`);
      }
      if (e.type === 'rankUp') note(`rank: ${e.rank}`);
      if (e.type === 'playerDefeated') lost[e.enemy] = (lost[e.enemy] ?? 0) + 1;
    }
    return events;
  };
  const cmd = (command: Command): CommandResult => {
    const result = dispatch(state, command, content, rules);
    drain();
    return result;
  };
  const must = (command: Command): void => {
    const result = cmd(command);
    if (!result.ok) throw new Error(`${JSON.stringify(command)} refused: ${result.reason}`);
  };
  /** Moves time on in slices until the predicate holds; fails with the label when `maxMs` pass first. */
  const until = (done: () => boolean, maxMs: number, label: string, slice = 20_000): void => {
    const end = state.now + maxMs;
    while (!done()) {
      if (state.now >= end)
        throw new Error(`gave up on: ${label} (${(state.now / HOUR).toFixed(1)} h)`);
      advance(state, slice, content, rules);
      drain();
    }
  };
  const counter = (key: string): number => counterValue(state, key);
  const level = (skills: Partial<Record<SkillId, number>>): void => {
    for (const [skill, n] of Object.entries(skills) as [SkillId, number][]) {
      const entry = state.skills[skill];
      if (entry && entry.xp < xpAt(n)) entry.xp = xpAt(n);
    }
    refreshUnlocks(state, content);
  };
  const idle = (): void => {
    if (state.slots[0]?.action) must({ type: 'action.stop', slot: 0 });
  };

  // ---- places ----
  const cellOf = (id: string) => content.cells.find((c) => c.id === id);
  /**
   * Stands on the hex of the cell (the model walks there at no cost: the map is a walk, and this
   * bot measures the story, not the walk), marked as surveyed as walking would have left it.
   */
  const enterRegionOf = (id: string): void => {
    const cell = cellOf(id);
    if (!cell) throw new Error(`no cell ${id}`);
    state.world.location = cell.id;
    state.world.surveyed[`${cell.hex[0]},${cell.hex[1]}`] = true;
  };
  /** Explores a cell to level 1 (its points of interest are found then). */
  const explore = (id: string): void => {
    const cell = cellOf(id);
    if (!cell || cellLevel(state, cell, content) >= 1) return;
    enterRegionOf(id);
    must({ type: 'action.start', slot: 0, kind: 'explore', id });
    until(() => cellLevel(state, cell, content) >= 1, 8 * HOUR, `explore ${id}`);
    idle();
  };

  // ---- Intel ----
  const studyCurrency = content.currencies.find((c) => c.role === 'study')?.id ?? '';
  /** Explores cells to their first level, one Intel each, until the purse holds `n`. A cell behind a key the character lacks is skipped. */
  const intel = (n: number): void => {
    for (const cell of content.cells) {
      if ((state.currencies[studyCurrency] ?? 0) >= n) return;
      if (cell.key) continue;
      try {
        explore(cell.id);
      } catch {
        // A cell of a region that is not open yet, or one the skills do not reach: the next one.
        idle();
      }
    }
    if ((state.currencies[studyCurrency] ?? 0) < n) throw new Error(`no Intel for ${n}`);
  };

  // ---- fights ----
  /** Waits until the Wounds of lost fights have healed. */
  const rest = (): void => {
    if (state.wounds.stacks > 0)
      until(() => state.wounds.stacks === 0, 12 * HOUR, 'wounds heal', 60_000);
  };
  /** Answers the quest text names for the next fights: techniques put into the loadout and items into the pouch, as a player reading «Відповідь» would. */
  /** The kit of a prepared character: what the shop sells for the pouch, the model's meals, the loadout for the encounter, then the answers. */
  let answers: { techniques: string[]; items: string[] } = { techniques: [], items: [] };
  const equip = (encounter: string): void => {
    stockFromShop(state, content, rules);
    const food = modelFood(40, content);
    if (food) state.bank[food.item] = Math.max(state.bank[food.item] ?? 0, food.n);
    cmd({ type: 'loadout.prepare', encounter });
    if (answers.techniques.length > 0) {
      const rest = state.loadouts.active.filter((t) => !answers.techniques.includes(t));
      const want = [...answers.techniques, ...rest].slice(0, state.loadouts.active.length);
      cmd({ type: 'loadout.set', techniques: want });
    }
    answers.items.forEach((item, slot) => cmd({ type: 'pouch.set', slot, item }));
  };
  /** Fights in a zone (or against a raid at the gates, named by its id) until `done` holds; a lost fight is counted and the fight is simply started again. */
  const fight = (zone: string, done: () => boolean, maxMs = 6 * HOUR): void => {
    const raid = content.raids.find((x) => x.id === zone);
    const z =
      content.zones.find((x) => x.id === zone) ?? (raid ? { enemy: raid.enemy } : undefined);
    if (!z) throw new Error(`no zone ${zone}`);
    if (
      !raid &&
      'region' in z &&
      z.region !== 'academy' &&
      z.region !== 'boss' &&
      z.region !== 'exam'
    ) {
      const cell = content.cells.find((c) =>
        c.pois.some((p) => p.kind === 'zone' && p.zone === zone),
      );
      if (cell) explore(cell.id);
    }
    const end = state.now + maxMs;
    equip(zone);
    must({ type: 'action.start', slot: 0, kind: 'fight', id: zone });
    while (!done()) {
      if (state.now >= end)
        throw new Error(
          `gave up on: fight ${zone} (${(state.now / HOUR).toFixed(1)} h) lost ${JSON.stringify(lost)} kills ${counter(killsKey(z.enemy))}`,
        );
      advance(state, 20_000, content, rules);
      drain();
      // A fight that ends with its goal (a raid fought to the last pack) leaves the slot free and is not started again.
      if (!state.slots[0]?.action && !done()) {
        rest();
        equip(zone);
        must({ type: 'action.start', slot: 0, kind: 'fight', id: zone });
      }
    }
    idle();
  };
  /** Runs an operation until its first-clear flag stands, starting it again after a defeat. */
  const operation = (id: string, prepareFor: string, maxMs = 8 * HOUR): void => {
    const op = content.operations.find((o) => o.id === id);
    if (!op) throw new Error(`no operation ${id}`);
    const end = state.now + maxMs;
    let attempts = 0;
    while (state.flags[op.clearFlag] === undefined) {
      if (state.now >= end)
        throw new Error(
          `gave up on: operation ${id}, ${attempts} runs, lost ${JSON.stringify(lost)}`,
        );
      if (!state.slots[0]?.action) {
        attempts++;
        rest();
        // The loadout and the pouch are built for the hardest fight of the run.
        equip(prepareFor);
        must({ type: 'action.start', slot: 0, kind: 'operation', id });
      }
      advance(state, 20_000, content, rules);
      drain();
    }
    idle();
  };

  // ---- missions ----
  /** Runs missions from the list, in turn, until `done` holds. A mission the character cannot start is skipped. */
  const missions = (ids: string[], done: () => boolean, maxMs = 12 * HOUR): void => {
    const end = state.now + maxMs;
    const refused: Record<string, string> = {};
    while (!done()) {
      let progressed = false;
      for (const id of ids) {
        if (done()) break;
        const before = counter(missionDoneKey(id));
        const started = cmd({ type: 'action.start', slot: 0, kind: 'mission', id });
        if (!started.ok) {
          refused[id] = started.reason;
          continue;
        }
        // A mission that does not finish in an hour (a stage nobody can do) is left and the next one tried.
        const stuck = state.now + HOUR;
        while (counter(missionDoneKey(id)) <= before && !done() && state.now < stuck) {
          advance(state, 10_000, content, rules);
          drain();
        }
        idle();
        if (counter(missionDoneKey(id)) > before) progressed = true;
      }
      if (!progressed && !done())
        throw new Error(
          `no mission of ${ids.join(', ')} can be finished: ${JSON.stringify(refused)}`,
        );
      if (state.now >= end)
        throw new Error(
          `gave up on missions ${ids.map((i) => `${i}=${counter(missionDoneKey(i))}`).join(', ')}; ${JSON.stringify(refused)} ${JSON.stringify(state.quests)} ${JSON.stringify(Object.fromEntries(Object.entries(state.counters).filter(([k]) => k.startsWith('missions.'))))}`,
        );
    }
  };

  // ---- the story ----
  note('the Academy is done: Genin');
  grantShopBuildings(state, content);
  level(PACE.genin ?? {});
  cmd({ type: 'player.setName', name: 'Тест' });
  must({ type: 'nature.choose', nature: 'katon' satisfies NatureId });
  note('nature: katon');

  const stepOf = (quest: string): number => state.quests[quest]?.step ?? 0;
  const finished = (quest: string): boolean => state.quests[quest]?.done === true;
  /** Gathers a herb until the bank holds `n` of it. */
  const gather = (herb: string, n: number): void => {
    if ((state.bank[herb] ?? 0) >= n) return;
    must({ type: 'action.start', slot: 0, kind: 'gather', id: herb });
    until(() => (state.bank[herb] ?? 0) >= n, 4 * HOUR, `gather ${herb}`);
    idle();
  };
  /** Buys from the shop what the bank lacks. */
  const buy = (item: string, n: number): void => {
    const lack = n - (state.bank[item] ?? 0);
    if (lack <= 0) return;
    must({ type: 'shop.buy', item, n: lack });
  };
  const chain = (quest: string, steps: number, body: () => void): void => {
    body();
    if (!finished(quest) && stepOf(quest) < steps)
      throw new Error(`${quest} stopped at step ${stepOf(quest)}`);
    note(`${quest}: step ${stepOf(quest)}${finished(quest) ? ' (done)' : ''}`);
  };
  const D_MISSIONS = [
    'core:cat',
    'core:courier',
    'core:thief',
    'core:rockfall',
    'core:weed',
    'core:fire',
    'core:drought',
  ];

  // «Дошка місій»: nature, five D missions, mint, arsonists, five cells of the forest.
  chain('core:mission_board', 5, () => {
    missions(D_MISSIONS, () => stepOf('core:mission_board') >= 2);
    gather('core:mint', 20);
    fight('core:zone_arsonist', () => stepOf('core:mission_board') >= 4);
    for (const cell of [
      'core:okolytsi_sela',
      'core:rysovi_polia',
      'core:zharyshche_skladu',
      'core:uzlissia',
      'core:polihon_44_lis_smerti',
      'core:prykordonnyi_lis_okolytsia',
    ]) {
      if (finished('core:mission_board')) break;
      explore(cell);
    }
  });

  // «Вовки Північного лісу»
  chain('core:border_wolves', 6, () => {
    for (const cell of [
      'core:prykordonnyi_lis_okolytsia',
      'core:prykordonnyi_lis_khashchi',
      'core:prykordonnyi_lis_brid',
    ])
      explore(cell);
    intel(3);
    must({ type: 'quest.pay', quest: 'core:border_wolves' });
    fight('core:zone_bandit', () => stepOf('core:border_wolves') >= 3);
    gather('core:nettle', 10);
    buy('core:oil', 5);
    must({ type: 'action.start', slot: 0, kind: 'craft', id: 'core:tsiliushcha_maz' });
    until(() => (state.bank['core:tsiliushcha_maz'] ?? 0) >= 10, 4 * HOUR, 'craft ointments');
    idle();
    level({ cc: 20 });
    level(PACE.act3 ?? {});
    fight('core:zone_boss_wolf', () => finished('core:border_wolves'));
  });
  if (state.flags['missions.c.unlocked'] === undefined)
    throw new Error('the C missions did not open');

  // The parallel chains of the Genin years: the village, the rival, Gai.
  chain('core:eternal_rivalry', 4, () => {
    level({ ath: 30, vit: 24 });
    missions(['core:v_spar'], () => finished('core:eternal_rivalry'));
  });
  chain('core:rival', 2, () => {
    level({ cc: 30 });
    must({ type: 'nature.add', nature: 'doton' });
    fight('core:zone_boss_ren1', () => stepOf('core:rival') >= 2);
  });
  chain('core:outskirts', 5, () => {
    // Rubble asks Taijutsu 40 for a character without Doton; sealing asks the technique, which the Library sells as a scroll.
    level({ tai: 40 });
    const village = state.village;
    if (!village) throw new Error('no village');
    village.levels['core:library'] = Math.max(village.levels['core:library'] ?? 0, 1);
    buy('core:scroll_enclosing', 1);
    must({ type: 'item.use', id: 'core:scroll_enclosing' });
    // Building takes days of village ticks and resources the balance bots measure; the level is written, as for the shop.
    village.levels['core:store'] = Math.max(village.levels['core:store'] ?? 0, 6);
    missions(
      ['core:v_rubble', 'core:v_seal', 'core:v_clear', 'core:v_sanit'],
      () => stepOf('core:outskirts') >= 3,
    );
    // The raid of the Grey Bands is called as the step becomes the active one, comes after its lead, and is fought at the gates.
    const raid = content.raids[0];
    if (!raid) throw new Error('no raid');
    until(() => state.flags[raidFlag(raid.id, 'active')] === true, 4 * HOUR, 'the raid arrives');
    fight(raid.id, () => finished('core:outskirts'));
  });

  // «Сірі пов'язки»
  chain('core:grey_bands', 8, () => {
    missions(['core:caravan'], () => stepOf('core:grey_bands') >= 1);
    intel(5);
    must({ type: 'quest.pay', quest: 'core:grey_bands' });
    missions(['core:sealed'], () => stepOf('core:grey_bands') >= 3);
    explore('core:ruiny_prykordonnoi_fortetsi');
    fight('core:zone_boss_fighter', () => stepOf('core:grey_bands') >= 5);
    level({ ...PACE.chunin, scout: 20 });
    explore('core:pivnichnyi_trakt');
    fight('core:zone_boss_hunter', () => stepOf('core:grey_bands') >= 7);
    // The Twins poison: antidotes are brewed from mint and water before the Hideout.
    gather('core:mint', 12);
    buy('core:water', 6);
    must({ type: 'action.start', slot: 0, kind: 'craft', id: 'core:antidote' });
    until(() => (state.bank['core:antidote'] ?? 0) >= 10, 4 * HOUR, 'craft antidotes');
    idle();
    // The Twins and the Man of the Mist were not beaten by this kit at level 42 in 200 runs: the levels go to the cap (reported as a hard fight).
    level({ tai: 50, nin: 50, katon: 50, doton: 50, vit: 50, eva: 50 });
    answers = { techniques: ['core:sensing'], items: ['core:antidote'] };
    operation('core:op_hideout', 'core:zone_boss_mist');
    answers = { techniques: [], items: [] };
  });

  // «Ім'я на камені» and the Chunin exam
  chain('core:name_on_stone', 6, () => {
    level(PACE.chunin ?? {});
    const renown = content.currencies.find((c) => c.role === 'renown')?.id ?? '';
    missions(
      ['core:caravan', 'core:dig', 'core:well', 'core:mail'],
      () => (state.currencies[renown] ?? 0) >= 300 || stepOf('core:name_on_stone') >= 1,
    );
    must({ type: 'exam.start', rank: 'chunin' });
    until(
      () => state.flags['exam.core:chunin_exam.written'] !== undefined,
      2 * HOUR,
      'written test',
    );
    idle();
    operation('core:op_forest_of_death', 'core:zone_boss_nameless');
    intel(5);
    must({ type: 'quest.pay', quest: 'core:name_on_stone' });
    operation('core:op_tournament', 'core:zone_boss_ren2');
  });
  must({ type: 'exam.start', rank: 'chunin' });
  until(() => state.player.rank === 'chunin', HOUR, 'the vest');
  note('the Chunin vest');

  return { state, log, chainOrder, lost };
}

/** A helper for the test: the kills of an enemy. */
export const killsOf = (state: GameState, enemy: string): number =>
  counterValue(state, killsKey(enemy));
