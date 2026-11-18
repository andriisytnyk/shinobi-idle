import type { ContentDb, Req } from '@shinobi/content';
import {
  addCurrency,
  addItem,
  addressOf,
  advance,
  blankBingo,
  bump,
  counterValue,
  dispatch as coreDispatch,
  emit,
  examFor,
  examWrittenFlag,
  gainPoolXp,
  growSlots,
  hexKey,
  isEnterable,
  learnReq,
  levelCap,
  parseHexKey,
  placeAt,
  poolCapacity,
  pointPlaces,
  rankIndex,
  raidFlag,
  rebalanceShares,
  refreshUnlocks,
  removeItem,
  scrollOf,
  seedSurvey,
  touchWorld,
  updateQuests,
  xpAt,
  type GameState,
  type Rules,
  payKey,
} from '@shinobi/core';
import { cloneCommand, type CloneDevCommand } from './clones.ts';

/*
 * The developer panel's commands. Like the game's own commands they are plain data that a pure
 * function applies to the state (no browser, no clock, no randomness), and the panel never
 * touches the state itself: it builds one of these and hands it to `game.devApply`. They change
 * the state only through the core's own helpers, so every state they leave behind is one the game
 * can reach. Exists in test builds only (see `__DEV_PANEL__`).
 */

export type DevCommand =
  /** Lets `ms` of game time pass, as waiting would. */
  | { type: 'time.advance'; ms: number }
  /** Sets a skill to a level (the level cap at most). */
  | { type: 'skill.setLevel'; skill: string; level: number }
  /** Sets the mastery of a technique or action key to a level (0 clears it). */
  | { type: 'mastery.set'; key: string; level: number }
  /** Fills the pool of a skill to a share of its capacity, in percent. */
  | { type: 'pool.set'; skill: string; pct: number }
  | { type: 'item.grant'; id: string; n: number }
  | { type: 'currency.grant'; id: string; n: number }
  | { type: 'technique.learn'; id: string }
  /** Hands out the scroll of a technique and reads it through the game's own `item.use`. */
  | { type: 'scroll.read'; technique: string }
  /** Finishes the active step of a quest chain (starting the chain if it has not begun). */
  | { type: 'story.completeStep'; quest: string }
  /** Sets a flag (`value` omitted: raised), or clears it (`value: null`). */
  | { type: 'story.flag'; id: string; value?: true | number | null }
  /** Gives the player a rank, with what it opens. */
  | { type: 'rank.set'; rank: string }
  /** Makes the checklist of the exam that grants `rank` hold (and its written part). */
  | { type: 'exam.ready'; rank: string }
  | { type: 'map.surveyAll' }
  | { type: 'map.revealPoints' }
  /** Puts the performer of `slot` (0: the character) on a hex, by key `"q,r"` or cell id. */
  | { type: 'map.teleport'; slot: number; hex: string }
  /** Sets the Bingo knowledge level bought for an enemy or boss (0..3). */
  | { type: 'fight.bingo'; enemy: string; level: number }
  | { type: 'fight.win' }
  | { type: 'fight.lose' }
  /** Calls a raid and lets it arrive now. */
  | { type: 'raid.spawn'; raid: string }
  | CloneDevCommand;

export type DevResult = { ok: true } | { ok: false; reason: string };

const ok: DevResult = { ok: true };
const fail = (reason: string): DevResult => ({ ok: false, reason });

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** What a command that moves levels, techniques or ranks leaves to settle: unlocks, slots and quests. */
export function settle(state: GameState, content: ContentDb): void {
  refreshUnlocks(state, content);
  if (growSlots(state, content)) rebalanceShares(state, content);
  updateQuests(state, content);
}

/**
 * Makes `req` hold, through the same moves a player's progress would make. A requirement that
 * cannot be made to hold this way (a building, a quest that cannot start) is refused.
 */
export function satisfy(state: GameState, req: Req, content: ContentDb, depth = 0): DevResult {
  if (depth > 8) return fail('dev.err.tooDeep');
  switch (req.t) {
    case 'skill': {
      const entry = state.skills[req.skill];
      if (!entry) return fail('dev.err.unknown');
      entry.xp = Math.max(entry.xp, xpAt(req.level));
      return ok;
    }
    case 'technique':
      return learn(state, req.id, content);
    case 'rank':
      return setRank(state, req.rank, content, true);
    case 'nature':
      if (!state.player.natures.includes(req.nature)) state.player.natures.push(req.nature);
      return ok;
    case 'item':
      if ((state.bank[req.id] ?? 0) < req.n)
        addItem(state, req.id, req.n - (state.bank[req.id] ?? 0));
      return ok;
    case 'flag':
      state.flags[req.id] = req.n ?? true;
      return ok;
    case 'currency': {
      const currency = content.currencies.find((c) => c.role === req.role)?.id;
      if (currency === undefined) return fail('dev.err.unknown');
      const have = state.currencies[currency] ?? 0;
      if (have < req.n) addCurrency(state, currency, req.n - have);
      return ok;
    }
    case 'quest': {
      const quest = content.quests.find((q) => q.id === req.id);
      if (!quest) return fail('dev.err.unknown');
      const want = req.step ?? quest.steps.length;
      for (let guard = 0; guard < 64; guard++) {
        const progress = state.quests[quest.id];
        if (progress && (progress.done || progress.step >= want)) return ok;
        const moved = completeStep(state, quest.id, content, depth + 1);
        if (!moved.ok) return moved;
      }
      return fail('dev.err.tooDeep');
    }
    case 'all':
      for (const sub of req.of) {
        const done = satisfy(state, sub, content, depth + 1);
        if (!done.ok) return done;
      }
      return ok;
    case 'any': {
      let last: DevResult = fail('dev.err.cannotSatisfy');
      for (const sub of req.of) {
        last = satisfy(state, sub, content, depth + 1);
        if (last.ok) return last;
      }
      return last;
    }
    default:
      return fail('dev.err.cannotSatisfy');
  }
}

/** Finishes the active step of a chain: its objective is made to hold and the quest system runs. */
function completeStep(state: GameState, id: string, content: ContentDb, depth = 0): DevResult {
  const quest = content.quests.find((q) => q.id === id);
  if (!quest) return fail('dev.err.unknown');
  updateQuests(state, content);
  let progress = state.quests[quest.id];
  if (!progress && quest.unlock) {
    const opened = satisfy(state, quest.unlock, content, depth + 1);
    if (!opened.ok) return opened;
    updateQuests(state, content);
    progress = state.quests[quest.id];
  }
  if (!progress) return fail('dev.err.questNotStarted');
  if (progress.done) return fail('dev.err.questDone');
  const objective = quest.steps[progress.step]?.objective;
  if (!objective) return fail('dev.err.unknown');
  if (objective.t === 'counter') {
    const counters = [objective.counter, ...(objective.also ?? [])];
    const counted = counters.reduce((sum, key) => sum + counterValue(state, key), 0);
    const need = objective.total ? objective.n - counted : objective.n - (counted - progress.base);
    if (need > 0) bump(state, objective.counter, need);
  } else if (objective.t === 'pay') {
    bump(state, payKey(quest.id, progress.step));
  } else {
    const done = satisfy(state, objective.req, content, depth + 1);
    if (!done.ok) return done;
  }
  const before = progress.step;
  updateQuests(state, content);
  const after = state.quests[quest.id];
  return after && (after.done || after.step > before) ? ok : fail('dev.err.stepStuck');
}

function learn(state: GameState, id: string, content: ContentDb): DevResult {
  if (!content.techniques.some((t) => t.id === id)) return fail('dev.err.unknown');
  if (!state.known[id]) {
    state.known[id] = true;
    emit(state, { type: 'techniqueLearned', id });
  }
  settle(state, content);
  return ok;
}

function setRank(state: GameState, rank: string, content: ContentDb, onlyUp = false): DevResult {
  const to = rankIndex(content, rank);
  if (to < 0) return fail('dev.err.unknown');
  const from = rankIndex(content, state.player.rank);
  if (onlyUp && to <= from) return ok;
  state.player.rank = rank;
  if (to > from) emit(state, { type: 'rankUp', rank });
  settle(state, content);
  return ok;
}

function surveyAll(state: GameState, content: ContentDb): void {
  const keys = content.hexes.map((h) => hexKey(h.q, h.r));
  seedSurvey(state.world, content, keys);
  const top = content.balance.K.cellExplores.at(-1) ?? 0;
  for (const cell of content.cells)
    state.world.explores[cell.id] = Math.max(state.world.explores[cell.id] ?? 0, top);
  touchWorld(state);
}

function revealPoints(state: GameState, content: ContentDb): void {
  for (const place of pointPlaces(content)) state.world.pois[place.id] = true;
  for (const cell of content.cells) for (const poi of cell.pois) state.world.pois[poi.id] = true;
  touchWorld(state);
}

function teleport(state: GameState, slot: number, where: string, content: ContentDb): DevResult {
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.slots.length)
    return fail('dev.err.noSlot');
  const cell = content.cells.find((c) => c.id === where);
  const at = cell ? { q: cell.hex[0], r: cell.hex[1] } : parseHexKey(where);
  const hex = at ? content.hexes.find((h) => h.q === at.q && h.r === at.r) : undefined;
  if (!at || !hex || !isEnterable(content, hex)) return fail('dev.err.badHex');
  placeAt(state, slot, addressOf(content, at));
  touchWorld(state);
  return ok;
}

function spawnRaid(state: GameState, id: string, content: ContentDb): DevResult {
  const raid = content.raids.find((r) => r.id === id);
  if (!raid) return fail('dev.err.unknown');
  const opened = satisfy(state, raid.trigger, content);
  if (!opened.ok) return opened;
  updateQuests(state, content);
  const run = state.village?.raids[raid.id];
  if (!run) return fail('dev.err.noVillage');
  if (run.phase === 'warned') {
    Object.assign(run, { phase: 'active', ticks: raid.hold });
    state.flags[raidFlag(raid.id, 'active')] = true;
    emit(state, { type: 'raidArrived', raid: raid.id });
  }
  return ok;
}

/** Applies a developer command to `state`. Refusals change nothing the caller must undo. */
export function runDev(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  command: DevCommand,
): DevResult {
  switch (command.type) {
    case 'time.advance':
      if (!Number.isInteger(command.ms) || command.ms < 0) return fail('dev.err.badNumber');
      advance(state, command.ms, content, rules);
      return ok;
    case 'skill.setLevel': {
      const entry = state.skills[command.skill];
      // Levels start at 1: `xpAt(0)` throws, and a throw here would stop the game.
      if (!entry || !isCount(command.level) || command.level < 1) return fail('dev.err.badNumber');
      entry.xp = xpAt(Math.min(command.level, levelCap(content)));
      settle(state, content);
      return ok;
    }
    case 'mastery.set': {
      if (!isCount(command.level) || command.key === '') return fail('dev.err.badNumber');
      const level = Math.min(command.level, content.balance.K.masteryCap);
      if (level === 0) delete state.mastery[command.key];
      else state.mastery[command.key] = { xp: xpAt(level) };
      return ok;
    }
    case 'pool.set': {
      const capacity = poolCapacity(command.skill, content);
      const entry = state.pools[command.skill];
      if (!entry || capacity <= 0) return fail('dev.err.noPool');
      if (!(command.pct >= 0 && command.pct <= 100)) return fail('dev.err.badNumber');
      const target = Math.round((capacity * command.pct) / 100);
      if (target > entry.xp) gainPoolXp(state, command.skill, target - entry.xp, content);
      else entry.xp = target;
      return ok;
    }
    case 'item.grant': {
      if (!content.items.some((i) => i.id === command.id)) return fail('dev.err.unknown');
      if (!isCount(command.n) || command.n === 0) return fail('dev.err.badNumber');
      addItem(state, command.id, command.n);
      emit(state, { type: 'itemGained', id: command.id, n: command.n });
      return ok;
    }
    case 'currency.grant':
      if (!isCount(command.n) || command.n === 0) return fail('dev.err.badNumber');
      return addCurrency(state, command.id, command.n) ? ok : fail('dev.err.unknown');
    case 'technique.learn':
      return learn(state, command.id, content);
    case 'scroll.read': {
      const scroll = scrollOf(command.technique, content);
      const tech = content.techniques.find((x) => x.id === command.technique);
      if (scroll === null || !tech) return fail('dev.err.noScroll');
      // Reading needs what the technique asks for; the panel makes it hold, as it does for an exam.
      if (!state.known[tech.id]) {
        const ready = satisfy(state, learnReq(tech, content), content);
        if (!ready.ok) return ready;
      }
      const had = state.bank[scroll] ?? 0;
      addItem(state, scroll, 1);
      const result = coreDispatch(
        state,
        { type: 'item.use', id: scroll, target: command.technique },
        content,
        rules,
      );
      if (!result.ok) {
        // The scroll was handed out for the reading only: a refused reading takes it back.
        removeItem(state, scroll, (state.bank[scroll] ?? 0) - had);
        return fail(result.reason);
      }
      return ok;
    }
    case 'story.completeStep':
      return completeStep(state, command.quest, content);
    case 'story.flag':
      if (command.id === '') return fail('dev.err.unknown');
      if (command.value === null) delete state.flags[command.id];
      else state.flags[command.id] = command.value ?? true;
      updateQuests(state, content);
      return ok;
    case 'rank.set':
      return setRank(state, command.rank, content);
    case 'exam.ready': {
      const exam = examFor(content, command.rank);
      if (!exam) return fail('dev.err.unknown');
      const checklist = satisfy(state, exam.checklist, content);
      if (!checklist.ok) return checklist;
      if (exam.then) {
        state.flags[examWrittenFlag(exam)] = true;
        const then = satisfy(state, exam.then, content);
        if (!then.ok) return then;
      }
      settle(state, content);
      return ok;
    }
    case 'map.surveyAll':
      surveyAll(state, content);
      return ok;
    case 'map.revealPoints':
      revealPoints(state, content);
      return ok;
    case 'map.teleport':
      return teleport(state, command.slot, command.hex, content);
    case 'fight.bingo': {
      const known =
        content.enemies.some((e) => e.id === command.enemy) ||
        content.bosses.some((b) => b.id === command.enemy);
      if (!known || !isCount(command.level) || command.level > 3) return fail('dev.err.badNumber');
      const entry = (state.bingo[command.enemy] ??= blankBingo());
      entry.bought = command.level;
      if (command.level >= 1) entry.seen = Math.max(1, entry.seen);
      return ok;
    }
    case 'fight.win':
    case 'fight.lose': {
      const combat = state.combat;
      if (!combat || combat.phase !== 'fight' || combat.fight.result !== 'ongoing')
        return fail('dev.err.noFight');
      if (command.type === 'fight.win') {
        for (const e of combat.fight.enemies) e.hp = 0;
        combat.fight.result = 'victory';
      } else {
        combat.fight.player.hp = 0;
        combat.fight.result = 'defeat';
      }
      // The combat system settles the ended fight (loot, wounds, the book) at the next moment.
      advance(state, 1, content, rules);
      return ok;
    }
    case 'raid.spawn':
      return spawnRaid(state, command.raid, content);
    case 'clone.create':
    case 'clone.clearFatigue':
      return cloneCommand(state, content, command, { learn });
  }
}
