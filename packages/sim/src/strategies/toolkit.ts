import type { Cell, ContentDb, Enemy, Boss, Zone } from '@shinobi/content';
import {
  bingoLevel,
  buyPrice,
  cellInfo,
  cellLevel,
  cloneSlots,
  STAND_KIND,
  counterValue,
  defeatsKey,
  killsKey,
  dispatch,
  entryOf,
  evalReq,
  examFor,
  examWrittenFlag,
  firstUnmetLeaf,
  hexDistance,
  zoneCellOf,
  learnReq,
  regionOpenReq,
  isNature,
  isSkillUnlocked,
  isAcademyRank,
  levelCap,
  listCells,
  listCourse,
  listSkillActions,
  missionBoard,
  missionStatus,
  moneyOf,
  natureStatus,
  nextTierPrice,
  nextTierReq,
  perFight,
  planPouch,
  pouchUse,
  opSteps,
  startAnalysis,
  stepAnalysis,
  rankIndex,
  scrollOf,
  shopEntries,
  skillLevel,
  skillUnlockStatus,
  slotCount,
  studyCost,
  targetOf,
  villageBuildings,
  zoneBlocked,
  zoneRequirement,
  COURSE_KIND,
  SENSEI_TEST_KIND,
  type ActionInfo,
  type BoardEntry,
  type Command,
  type Req,
  type ReqResult,
  type GameState,
} from '@shinobi/core';
import type { BotContext } from '../bot.ts';
import { combatSkills, KIND_CRAFT, KIND_FIGHT, KIND_GATHER, styleSkills } from '../constants.ts';

const MINUTE = 60_000;

/** Knobs of the policies, in one place. The toolkit names no content ids. */
export const TUNING = {
  /** Estimated win rate a zone needs before a bot fights there to train. */
  safeWinRate: 0.9,
  /** Estimated win rate a fight the story asks for needs before the bot walks into it. */
  storyWinRate: 0.5,
  /** Estimated chance (the product over its stages) from which the story player walks into an operation. */
  opWinRate: 0.25,
  estimateRuns: 12,
  /** Runs of an operation the forecast plays. */
  operationRuns: 20,
  estimateSeed: 7,
  /** A zone, boss or operation the bot lost in is left alone this long. */
  banMs: 20 * MINUTE,
  /** Each defeat in a row at the same place doubles that rest, up to this many times. */
  banDoublings: 3,
  /** Zones whose enemy is above this multiple of the player's power (plus a margin) are not estimated at all. */
  reachFactor: 1.8,
  reachMargin: 6,
  /** Wound stacks from which a bot rests (trains without fighting). */
  restFromWounds: 3,
  /** Crafts planned per round. */
  batch: 12,
  /** Ryo a bot keeps back when it shops. */
  cashFloor: 30,
  /** A shop good or build is bought only when it costs at most this share of the purse. */
  spendShare: 0.6,
  /** Share of the purse a village build is topped up with. */
  donateShare: 0.5,
  /** The cheapest paid trip is taken when it costs at most this share of the purse. */
  tripShare: 0.2,
  reviewMs: 2 * MINUTE,
  /** A skill in training is kept until it is this many levels above the lowest. */
  holdLevels: 4,
} as const;

/** What a policy remembers between decisions. One per run. */
export interface Memory {
  bans: Map<string, number>;
  estimates: Map<string, number>;
  lastDefeats: Map<string, number>;
  /** Defeats in a row at one place, for the rest it is given (each defeat doubles it: a bot that keeps losing is wrong about the odds). */
  streak: Map<string, number>;
  examTriedAt: number;
  /** The last thing the story policy could not move on, for the report. */
  blocked: string | null;
  /** Set by a plan that only trains because a fight or an operation is not yet within the character's reach. */
  waiting: boolean;
  /** The building a quest step asked for at the last look; the village builds it before any other. */
  wantBuilding: string | null;
  /** The commands of the last decision that the game refused, counted by reason (filled by the runner's observer). */
  board: { at: number; fingerprint: string; entries: BoardEntry[] } | null;
  lastNow: number;
  /** The enemies and bosses the story is about to fight: the Intel goes to their Bingo entries. */
  studyTargets: Set<string>;
}

export function createMemory(): Memory {
  return {
    bans: new Map(),
    estimates: new Map(),
    lastDefeats: new Map(),
    streak: new Map(),
    examTriedAt: -Infinity,
    blocked: null,
    waiting: false,
    wantBuilding: null,
    board: null,
    lastNow: 0,
    studyTargets: new Set(),
  };
}

/** A plan: the commands to give now; `[]` keeps what runs; null means "this policy has nothing to do". */
export type Plan = Command[] | null;

export interface Toolkit {
  ctx: BotContext;
  mem: Memory;
  /** The natures this run is played with, in the order they are taken. */
  triple: readonly string[];
  /** Whether a fight may be started to train (a peaceful player never does). */
  fightsToTrain: boolean;
}

const level = (tk: Toolkit, skill: string): number =>
  skillLevel(tk.ctx.state, skill, tk.ctx.content);
const ryo = (tk: Toolkit): number => tk.ctx.state.currencies[moneyOf(tk.ctx.content)] ?? 0;

/** Starts `kind id` in slot 0 unless it already runs there. */
export function startIn(tk: Toolkit, kind: string, id: string, slot = 0): Command[] {
  const run = tk.ctx.state.slots[slot]?.action ?? null;
  return run?.kind === kind && run.id === id ? [] : [{ type: 'action.start', slot, kind, id }];
}

// ------------------------------------------------------------ requirement trees

/**
 * The unmet leaves of a requirement result that still have to be worked on: every unmet branch of an
 * `all`, and for an `any` only the branch that is closest to done.
 */
export function unmetLeaves(r: ReqResult): ReqResult[] {
  if (r.met) return [];
  if (r.children.length === 0) return [r];
  if (r.req.t === 'any') {
    let best: ReqResult | null = null;
    let bestShare = -1;
    for (const child of r.children) {
      const share = child.target > 0 ? child.current / child.target : 0;
      if (share > bestShare) {
        bestShare = share;
        best = child;
      }
    }
    return best ? unmetLeaves(best) : [];
  }
  return r.children.flatMap(unmetLeaves);
}

// ------------------------------------------------------------ power and fights

/** The mean of the character's combat levels: the style and the combat skills. */
export function power(tk: Toolkit): number {
  const { content } = tk.ctx;
  const style = Math.max(...styleSkills(content).map((s) => level(tk, s)));
  const defence = combatSkills(content).map((s) => level(tk, s));
  return (defence.reduce((a, b) => a + b, style) / (defence.length + 1)) | 0;
}

function fingerprint(tk: Toolkit): string {
  const { state, content } = tk.ctx;
  return [
    ...content.skills.map((s) => level(tk, s.id)),
    Object.keys(state.known).length,
    state.loadouts.active.join(','),
    state.pouch.slots.map((s) => s.id).join(','),
    state.wounds.stacks,
  ].join('.');
}

/**
 * How well the player knows what a target puts in front of it: the least Bingo level of its entries, as the
 * preparation screen reads it (`knowledgeOfTarget` in the web app). The screen shows a forecast from level 1.
 */
function knowledgeOf(tk: Toolkit, ids: readonly string[]): number {
  const { state, content } = tk.ctx;
  if (ids.length === 0) return 0;
  return Math.min(...ids.map((id) => bingoLevel(state, id, content)));
}

/** The entries of an operation, as its preparation screen counts them: every fight stage and every draw pool. */
function operationEntries(content: ContentDb, opId: string): string[] {
  const op = content.operations.find((o) => o.id === opId);
  const ids = new Set<string>();
  for (const step of op ? opSteps(op) : []) {
    if (step.t === 'fight') ids.add(step.enemy);
    else if (step.t === 'draw') for (const id of step.pool) ids.add(id);
  }
  return [...ids];
}

/**
 * The first-play win rate of the game's own battle analysis (the forecast the preparation screen shows), for
 * the character as the preparation leaves it, or `null` when the screen would show nothing: while an entry of
 * the target is still unknown (Bingo level 0) the game gives no forecast, and the bot has none either.
 * Cached until the character changes.
 */
function forecastRate(
  tk: Toolkit,
  target: { kind: 'zone' | 'boss' | 'operation'; id: string },
  entries: readonly string[],
  prepareFor: string,
  samples: number,
): number | null {
  const { state, content, rules } = tk.ctx;
  const known = knowledgeOf(tk, entries);
  if (known < 1) return null;
  const key = `${target.kind}|${target.id}|${known}|${fingerprint(tk)}`;
  let rate = tk.mem.estimates.get(key);
  if (rate === undefined) {
    // What the player would fight with: the loadout, the pouch and the supplies as the preparation leaves them,
    // for the character as it stands before the fight, not in the middle of another one.
    const ready = structuredClone(state) as GameState;
    ready.combat = null;
    for (const slot of ready.slots) slot.action = null;
    const tk2: Toolkit = { ...tk, ctx: { ...tk.ctx, state: ready } };
    for (const c of prepareFight(tk2, prepareFor)) dispatch(ready, c, content, rules);
    const job = startAnalysis(
      ready,
      target,
      { samples, seed: TUNING.estimateSeed },
      content,
      rules,
    );
    if (job === null) rate = 0;
    else {
      // Only the first-play part is wanted (the sessions that follow it are a forecast of hours): step until its batches are done.
      let progress = stepAnalysis(job, 1, content, rules);
      while (job.fresh.done < job.fresh.batches) progress = stepAnalysis(job, 1, content, rules);
      rate = progress.result.fresh.winRate;
    }
    if (tk.mem.estimates.size > 4000) tk.mem.estimates.clear();
    tk.mem.estimates.set(key, rate);
  }
  return rate;
}

/**
 * The forecast win rate against one enemy or boss, from the game's own battle analysis at the knowledge the
 * character has of it; `null` while the entry is unknown (Bingo level 0), when the game shows no forecast.
 */
export function winRate(tk: Toolkit, entry: Enemy | Boss): number | null {
  return forecastRate(
    tk,
    { kind: 'special' in entry ? 'boss' : 'zone', id: entry.id },
    [entry.id],
    entry.id,
    TUNING.estimateRuns,
  );
}

/**
 * Whether a player would go and look at an entry it knows little about. Only what the game shows is used: the
 * entry's level against the character's power, not how the fight would go. A boss teaches its mechanic with
 * the first fight, whatever came of it, so a first fight with one that is in reach is worth a loss.
 */
export function worthScouting(tk: Toolkit, entry: Enemy | Boss): boolean {
  const { state, content } = tk.ctx;
  return (
    'special' in entry &&
    bingoLevel(state, entry.id, content) < 2 &&
    entry.cl <= power(tk) * TUNING.reachFactor + TUNING.reachMargin
  );
}

/** The enemy of the last fight stage of an operation: the one its loadout is prepared for. */
export function lastEnemyOf(content: ContentDb, opId: string): string | null {
  const op = content.operations.find((o) => o.id === opId);
  const fights = (op?.stages ?? []).flatMap((s) => (s.t === 'fight' ? [s.enemy] : []));
  return fights[fights.length - 1] ?? null;
}

/**
 * The forecast chance to clear a whole operation in one run, from the game's own battle analysis (the forecast
 * the player has on the operation's page): the stages are fought back to back with the loadout and pouch the
 * preparation leaves, and the pools carried from one stage to the next. `null` while an entry of the operation
 * is unknown (the page shows no forecast then).
 */
export function operationRate(tk: Toolkit, opId: string): number | null {
  const { content } = tk.ctx;
  return forecastRate(
    tk,
    { kind: 'operation', id: opId },
    operationEntries(content, opId),
    lastEnemyOf(content, opId) ?? opId,
    TUNING.operationRuns,
  );
}

/**
 * Whether a target the game shows no forecast for is worth a first look: the levels of its entries (shown on the
 * combat page) against the character's power, with the same margin as a boss scouting. The first look gives the
 * Bingo level 1, and the forecast with it. This is the bot's conservative stand-in for a verdict it cannot read.
 */
export function worthLooking(tk: Toolkit, ids: readonly string[]): boolean {
  const { content } = tk.ctx;
  const reach = power(tk) * TUNING.reachFactor + TUNING.reachMargin;
  return ids.every((id) => (entryOf(content, id)?.cl ?? Infinity) <= reach);
}

/** Notes the defeats since the last look: the place the player lost in rests for a while. */
export function noteDefeats(tk: Toolkit): void {
  const { state, content } = tk.ctx;
  const { mem } = tk;
  if (state.now < mem.lastNow) {
    mem.bans.clear();
    mem.estimates.clear();
    mem.lastDefeats.clear();
    mem.streak.clear();
    mem.examTriedAt = -Infinity;
    mem.board = null;
  }
  mem.lastNow = state.now;
  const ban = (id: string): void => {
    const run = (mem.streak.get(id) ?? 0) + 1;
    mem.streak.set(id, run);
    mem.bans.set(id, state.now + TUNING.banMs * 2 ** Math.min(run - 1, TUNING.banDoublings));
  };
  for (const zone of content.zones) {
    const lost = state.counters[defeatsKey(zone.enemy)] ?? 0;
    if (lost > (mem.lastDefeats.get(zone.id) ?? 0)) ban(zone.id);
    mem.lastDefeats.set(zone.id, lost);
    if ((state.counters[killsKey(zone.enemy)] ?? 0) > 0) mem.streak.delete(zone.id);
  }
  for (const op of content.operations) {
    for (const stage of op.stages) {
      if (stage.t !== 'fight') continue;
      const lost = state.counters[defeatsKey(stage.enemy)] ?? 0;
      if (lost > (mem.lastDefeats.get(op.id) ?? 0)) ban(op.id);
      mem.lastDefeats.set(op.id, Math.max(mem.lastDefeats.get(op.id) ?? 0, lost));
    }
  }
}

const banned = (tk: Toolkit, id: string): boolean => (tk.mem.bans.get(id) ?? 0) > tk.ctx.state.now;
const wounded = (tk: Toolkit): boolean => tk.ctx.state.wounds.stacks >= TUNING.restFromWounds;

/**
 * What a player does before a fight: buys the supplies for the enemy in the shop, then lets the game's own
 * preparation set the loadout and pack the pouch (it packs everything the bank holds, so the buying comes first).
 */
export function prepareFight(
  tk: Toolkit,
  encounter: string,
  loadoutFor: string = encounter,
): Command[] {
  return [...buySupplies(tk, encounter), { type: 'loadout.prepare', encounter: loadoutFor }];
}

/** The shop purchases that fill the pouch stacks the plan for this enemy wants. */
function buySupplies(tk: Toolkit, encounter: string): Command[] {
  const { state, content } = tk.ctx;
  const out: Command[] = [];
  const kinds = state.pouch.slots.map((s) => s.kind);
  const most = Math.max(0, ...content.pouchKinds.map((k) => k.perFight));
  const target = targetOf(state, encounter, content);
  const offered = shopEntries(content).flatMap((s) => {
    const item = content.items.find((i) => i.id === s.item);
    return item && pouchUse(item, content) !== null && evalReq(state, s.req, content).met
      ? [item.id]
      : [];
  });
  const hypothetical = { ...state.bank };
  for (const id of offered) hypothetical[id] = Math.max(hypothetical[id] ?? 0, most);
  const plan = planPouch(
    {
      bank: hypothetical,
      slots: kinds,
      traits: target?.traits ?? [],
      loadout: state.loadouts.active,
    },
    content,
  );
  let purse = ryo(tk);
  for (const [i, { id }] of plan.entries()) {
    if (id === '' || !offered.includes(id)) continue;
    const held = state.pouch.slots.find((s) => s.id === id)?.n ?? 0;
    const need = perFight(content, kinds[i] ?? '') - held - (state.bank[id] ?? 0);
    const price = buyPrice(id, content) ?? 0;
    const n = price > 0 ? Math.min(need, Math.floor(purse / price)) : 0;
    if (n < 1) continue;
    purse -= n * price;
    out.push({ type: 'shop.buy', item: id, n });
  }
  return out;
}

/** Starts a fight in `zone` (with the preparations), or null when it cannot be started now. */
function fightPlan(tk: Toolkit, zone: Zone): Plan {
  const { state, content } = tk.ctx;
  if (zoneBlocked(state, zone, content)) return null;
  const req = zoneRequirement(zone);
  if (req && !evalReq(state, req, content).met) return null;
  const run = state.slots[0]?.action ?? null;
  if (run?.kind === KIND_FIGHT && run.id === zone.id) return [];
  return [
    ...(state.combat ? [{ type: 'action.stop', slot: 0 } as Command] : []),
    ...prepareFight(tk, zone.enemy, zone.id),
    { type: 'action.start', slot: 0, kind: KIND_FIGHT, id: zone.id },
  ];
}

/** The highest open zone whose estimated win rate is at least `min`, as a fight plan. */
export function fightBest(tk: Toolkit, min: number = TUNING.safeWinRate): Plan {
  const { content } = tk.ctx;
  if (wounded(tk)) return null;
  const reach = power(tk) * TUNING.reachFactor + TUNING.reachMargin;
  const candidates = content.zones
    .flatMap((zone) => {
      const entry = entryOf(content, zone.enemy);
      return entry ? [{ zone, entry }] : [];
    })
    .sort((a, b) => b.entry.cl - a.entry.cl);
  for (const c of candidates) {
    if (c.entry.cl > reach || banned(tk, c.zone.id)) continue;
    if (fightPlan(tk, c.zone) === null) continue;
    // No forecast yet (the entry is unknown): a plain enemy is walked up to only when it is no stronger than the
    // character's power (no margin), the conservative stand-in for a verdict the bot cannot read; the sighting
    // gives the Bingo level 1 and the forecast with it.
    const rate = winRate(tk, c.entry);
    if (rate === null ? c.entry.cl <= power(tk) : rate >= min) return fightPlan(tk, c.zone);
  }
  return null;
}

// ------------------------------------------------------------ the map

const cellOf = (content: ContentDb, id: string): Cell | undefined =>
  content.cells.find((c) => c.id === id);

/**
 * Gets to a cell the player can explore: starts exploring it when it is in reach, otherwise walks
 * (or pays) towards the reachable cell nearest to it. Null when there is no way now.
 */
export function exploreCell(tk: Toolkit, cellId: string): Plan {
  const { state, content, rules } = tk.ctx;
  const cell = cellOf(content, cellId);
  if (!cell) return null;
  const info = cellInfo(state, cellId, content, rules);
  if (!info || info.nextLevelNeed === null) return null;
  if (info.explorable) return startIn(tk, 'explore', cellId);
  if (info.why === 'error.regionClosed' || info.keyReq?.met === false) return null;
  // Not in range: go to the reachable cell nearest to the target.
  const here = state.world.location;
  let best: { cell: Cell; d: number } | null = null;
  for (const c of listCells(state, content, rules)) {
    if (!c.reachable || c.id === here) continue;
    const other = cellOf(content, c.id);
    if (!other) continue;
    const d = hexDistance({ q: other.hex[0], r: other.hex[1] }, { q: cell.hex[0], r: cell.hex[1] });
    if (!best || d < best.d) best = { cell: other, d };
  }
  const nearest = info.reachable ? cell : best?.cell;
  if (!nearest) return null;
  return travelTo(tk, nearest.id);
}

/** Goes to a cell: the paid trip when it is cheap, the walk otherwise. */
export function travelTo(tk: Toolkit, cellId: string): Plan {
  const { state } = tk.ctx;
  const run = state.slots[0]?.action ?? null;
  if (run?.kind === 'walk' && run.id === cellId) return [];
  if (state.world.location === cellId) return null;
  const mode = ryo(tk) * TUNING.tripShare >= 1 ? 'paid' : 'walk';
  return [{ type: 'world.travel', cell: cellId, mode }];
}

/** Explores whichever cell can be explored now, the one with the fewest explorations first (Scouting XP and Intel). */
export function exploreAny(tk: Toolkit): Plan {
  const { state, content, rules } = tk.ctx;
  const open = listCells(state, content, rules)
    .filter((c) => c.explorable && c.nextLevelNeed !== null)
    .sort((a, b) => a.level - b.level || a.explores - b.explores);
  const pick = open[0];
  if (pick) return startIn(tk, 'explore', pick.id);
  const closed = listCells(state, content, rules).filter(
    (c) => c.nextLevelNeed !== null && c.level < 1 && c.why !== 'error.regionClosed',
  );
  for (const c of closed) {
    const plan = exploreCell(tk, c.id);
    if (plan) return plan;
  }
  return null;
}

/** The cell that holds a place (a point of interest) by its id. */
function cellOfPlace(content: ContentDb, placeId: string): Cell | undefined {
  const place = content.places.find((p) => p.id === placeId);
  if (!place) return undefined;
  return content.cells.find((c) => c.pois.some((p) => p.id === placeId));
}

// ------------------------------------------------------------ training

/** The skills a bot can train now: unlocked, and a nature only when the character owns it. */
export function trainableSkills(tk: Toolkit): string[] {
  const { state, content } = tk.ctx;
  return content.skills
    .filter((s) => isSkillUnlocked(state, s.id, content))
    .filter((s) => !isNature(content, s.id) || state.player.natures.includes(s.id))
    .map((s) => s.id);
}

/** The best available non-combat action for a skill by XP per hour; crafts need their goods. */
function bestAction(tk: Toolkit, skill: string, allowCraft: boolean): ActionInfo | null {
  const { state, content, rules } = tk.ctx;
  let best: ActionInfo | null = null;
  for (const a of listSkillActions(state, skill, content, rules)) {
    if (!a.available) continue;
    if (a.kind === COURSE_KIND && Object.keys(state.course).length === 0) continue;
    if (a.kind === KIND_CRAFT && !allowCraft) continue;
    if (!best || a.xpPerHour > best.xpPerHour) best = a;
  }
  return best;
}

/** The item a recipe or herb makes, as something the bank can be asked for: gather it, or craft it. */
function supplyPlan(tk: Toolkit, item: string, n: number): Plan {
  const { state, content, rules } = tk.ctx;
  if ((state.bank[item] ?? 0) >= n) return [];
  const gather = listSkillActions(state, 'herb', content, rules).find(
    (a) => a.kind === KIND_GATHER && a.id === item && a.available,
  );
  if (gather) return startIn(tk, KIND_GATHER, item);
  const entry = shopEntries(content).find((s) => s.item === item);
  if (entry && evalReq(state, entry.req, content).met) {
    const price = buyPrice(item, content) ?? Infinity;
    const afford = Math.floor((ryo(tk) - TUNING.cashFloor) / price);
    if (afford >= n - (state.bank[item] ?? 0)) {
      return [{ type: 'shop.buy', item, n: n - (state.bank[item] ?? 0) }];
    }
    return null;
  }
  const recipe = content.recipes.find((r) => r.output.item === item);
  if (recipe) return craftPlan(tk, recipe.id, Math.ceil(n / recipe.output.n));
  return null;
}

/** Crafts a recipe `times` over: the goods first (bought or gathered), then the craft. */
function craftPlan(tk: Toolkit, recipeId: string, times: number): Plan {
  const { state, content } = tk.ctx;
  const recipe = content.recipes.find((r) => r.id === recipeId);
  if (!recipe) return null;
  if (!isSkillUnlocked(state, recipe.skill, content)) return trainSkill(tk, recipe.skill);
  // A recipe the character cannot make yet: work on what it asks for.
  const info = listSkillActions(state, recipe.skill, content, tk.ctx.rules).find(
    (a) => a.kind === KIND_CRAFT && a.id === recipeId,
  );
  if (!info) return null;
  // What the recipe asks besides the goods (rank, skill level, building) is worked on first; the goods come next.
  const missing = info.req ? unmetLeaves(info.req).filter((l) => l.req.t !== 'item') : [];
  for (const leaf of missing) {
    const plan = leafPlan(tk, leaf, 3);
    if (plan !== null) return plan;
  }
  if (missing.length > 0) return null;
  const buys: Command[] = [];
  for (const i of recipe.ingredients) {
    const need = i.n * times - (state.bank[i.item] ?? 0);
    if (need <= 0) continue;
    const gather = supplyPlan(tk, i.item, i.n * times);
    if (gather === null) return null;
    if (gather.length === 0) continue;
    if (gather.some((c) => c.type === 'shop.buy')) {
      buys.push(...gather);
      continue;
    }
    return gather;
  }
  return [...buys, ...startIn(tk, KIND_CRAFT, recipeId)];
}

/**
 * Trains one skill with the action that pays the most XP; a craft skill gathers and buys the goods
 * for a batch. Athletics builds the free obstacle first. Combat-only skills (Vitality) are trained
 * by fighting, when the policy may fight.
 */
export function trainSkill(tk: Toolkit, skill: string): Plan {
  const { state, content, rules } = tk.ctx;
  if (!isSkillUnlocked(state, skill, content)) {
    // A closed skill opens when its requirement is met: work on that.
    const open = skillUnlockStatus(state, skill, content);
    for (const leaf of open ? unmetLeaves(open) : []) {
      const plan = leafPlan(tk, leaf, 3);
      if (plan !== null) return plan;
    }
    return null;
  }
  if (isNature(content, skill) && !state.player.natures.includes(skill)) return null;
  const def = content.skills.find((s) => s.id === skill);
  if (!def) return null;
  if (def.group === 'combat') {
    // A fight trains it fastest; without one (a peaceful player, or nothing safe to fight) the bodily drills do.
    const fight = tk.fightsToTrain ? fightBest(tk) : null;
    if (fight) return fight;
  }
  if (def.activity === 'course' && Object.keys(state.course).length === 0) {
    const free = content.obstacles.find((o) => o.slot === content.balance.K.athletics.freeSlot);
    if (free) {
      return [
        { type: 'athletics.build', slot: free.slot, obstacle: free.id },
        ...startIn(tk, COURSE_KIND, skill),
      ];
    }
  }
  // Scouting grows by exploring the map.
  if (def.activity === 'map') return exploreAny(tk);
  if (def.activity === 'station' || def.activity === 'recipe') {
    // A craft skill: the recipe with the best XP whose goods can be had.
    const list = listSkillActions(state, skill, content, rules)
      .filter((a) => a.kind === KIND_CRAFT && a.level <= level(tk, skill))
      .sort((a, b) => b.xpPerHour - a.xpPerHour);
    for (const a of list) {
      const plan = craftPlan(tk, a.id, TUNING.batch);
      if (plan) return plan;
    }
    return null;
  }
  const best = bestAction(tk, skill, false);
  return best ? startIn(tk, best.kind, best.id) : null;
}

/** Whether every skill the character can train is at the cap: nothing is left to prepare with. */
export const maxed = (tk: Toolkit): boolean =>
  trainableSkills(tk).every((s) => level(tk, s) >= levelCap(tk.ctx.content));

/** Trains the lowest-level skill among `skills` that can be trained now. */
export function trainLowestOf(tk: Toolkit, skills: readonly string[]): Plan {
  const order = [...skills].sort((a, b) => level(tk, a) - level(tk, b));
  const cap = levelCap(tk.ctx.content);
  // Stay with the skill in training while it is within a few levels of the lowest: no churn.
  const current = skillOfRunning(tk);
  const lowest = order[0];
  if (
    current !== null &&
    lowest !== undefined &&
    order.includes(current) &&
    level(tk, current) < cap &&
    level(tk, current) <= level(tk, lowest) + TUNING.holdLevels
  ) {
    const plan = trainSkill(tk, current);
    if (plan) return plan;
  }
  for (const skill of order) {
    if (level(tk, skill) >= cap) continue;
    const plan = trainSkill(tk, skill);
    if (plan) return plan;
  }
  return null;
}

/** Trains the lowest skill of all that can be trained. */
export function trainAny(tk: Toolkit): Plan {
  return trainLowestOf(tk, trainableSkills(tk));
}

/**
 * What a player does when a fight the story asks for is too hard: it trains what makes it stronger (the
 * style skills and the combat ones), the lowest of them first, not every skill in turn. With nothing of that
 * to train it trains whatever is lowest.
 */
export function trainForFight(tk: Toolkit): Plan {
  const { content } = tk.ctx;
  const fighting = trainableSkills(tk).filter((s) => {
    const def = content.skills.find((d) => d.id === s);
    return def !== undefined && (def.group === 'combat' || def.activity === 'tech');
  });
  return trainLowestOf(tk, fighting) ?? trainAny(tk);
}

// ------------------------------------------------------------ missions

function board(tk: Toolkit): BoardEntry[] {
  const { state, content, rules } = tk.ctx;
  const fp = fingerprint(tk);
  const cached = tk.mem.board;
  if (cached && cached.fingerprint === fp && state.now - cached.at < 10 * MINUTE) {
    return cached.entries;
  }
  const entries = missionBoard(state, content, rules);
  tk.mem.board = { at: state.now, fingerprint: fp, entries };
  return entries;
}

const mission = (tk: Toolkit, id: string): Plan => {
  const entry = board(tk).find((m) => m.id === id);
  if (!entry) return null;
  const run = tk.ctx.state.slots[0]?.action ?? null;
  if (run?.kind === 'mission' && run.id === id) return [];
  // The board is refreshed at a coarse rate; the game's own answer is read now, so a refused start is never repeated.
  if (!entry.startable) return null;
  const { state, content, rules } = tk.ctx;
  return missionStatus(state, id, 0, content, rules).startable
    ? [{ type: 'action.start', slot: 0, kind: 'mission', id }]
    : null;
};

/** The mission that pays the most per hour (ryo, plus the XP of the skills it certainly trains), optionally limited. */
export function bestMission(
  tk: Toolkit,
  pick: (m: BoardEntry) => boolean = () => true,
  allowFight = false,
): Plan {
  const { content } = tk.ctx;
  let best: { id: string; value: number } | null = null;
  for (const m of board(tk)) {
    if (!m.startable || !m.forecast.doable || !pick(m)) continue;
    const def = content.missions.find((x) => x.id === m.id);
    if (!allowFight && def?.stages.some((s) => s.t === 'combat')) continue;
    const xp = Object.values(m.forecast.xpPerHour).reduce((a, b) => a + b, 0);
    const value = m.forecast.ryoPerHour * 10 + xp;
    if (!best || value > best.value) best = { id: m.id, value };
  }
  return best ? mission(tk, best.id) : null;
}

/** The shortest mission of a rank (the one a counter step wants a number of). */
function shortestMission(tk: Toolkit, rank: string, allowFight: boolean, elemental = false): Plan {
  const { content } = tk.ctx;
  const pick = board(tk)
    .filter((m) => m.rank === rank && m.startable && m.forecast.doable)
    .filter(
      (m) =>
        !elemental ||
        m.forecast.stages.some((s) => s.path !== null && isNature(content, s.path.skill ?? '')),
    )
    .filter(
      (m) =>
        allowFight ||
        !content.missions.find((x) => x.id === m.id)?.stages.some((s) => s.t === 'combat'),
    )
    .sort((a, b) => a.forecast.expectedMs - b.forecast.expectedMs)[0];
  return pick ? mission(tk, pick.id) : null;
}

// ------------------------------------------------------------ the story

/** Whether the unmet part of the requirement is a fight the bot may not yet walk into. */
function fightFor(tk: Toolkit, enemy: string): Plan {
  const { state, content } = tk.ctx;
  const zone = content.zones.find((z) => z.enemy === enemy);
  if (!zone) return null;
  const entry = entryOf(content, enemy);
  if (!entry) return null;
  // The zone's cell has to be explored first.
  const cellId = zoneCellOf(zone.id, content);
  if (cellId && cellLevel(state, content.cells.find((c) => c.id === cellId) as Cell, content) < 1) {
    return exploreCell(tk, cellId);
  }
  if (zoneBlocked(state, zone, content)) {
    tk.mem.blocked = `zone ${zone.id}: ${zoneBlocked(state, zone, content)}`;
    return null;
  }
  const req = zoneRequirement(zone);
  if (req && !evalReq(state, req, content).met) {
    tk.mem.blocked = `zone ${zone.id}: requirement`;
    return null;
  }
  tk.mem.studyTargets.add(enemy);
  const rate = winRate(tk, entry);
  // The first fight with a boss teaches its mechanic whatever comes of it: go and look when it is in reach.
  const scouting = worthScouting(tk, entry);
  // Unknown entry (no forecast shown): go and look when it is in reach by level, as worthLooking states.
  const looking = rate === null && worthLooking(tk, [entry.id]);
  const strong =
    !banned(tk, zone.id) &&
    !wounded(tk) &&
    ((rate !== null && rate >= TUNING.storyWinRate) || scouting || looking || maxed(tk));
  if (strong) return fightPlan(tk, zone);
  tk.mem.blocked = `fight ${enemy}: win rate ${rate === null ? 'unknown' : rate.toFixed(2)}`;
  tk.mem.waiting = true;
  return trainForFight(tk);
}

/** Runs the operation until its clear flag stands. */
function operationPlan(tk: Toolkit, opId: string): Plan {
  const { state, content } = tk.ctx;
  const op = content.operations.find((o) => o.id === opId);
  if (!op) return null;
  if (op.unlock && !evalReq(state, op.unlock, content).met) return null;
  const run = state.slots[0]?.action ?? null;
  if (run?.kind === 'operation' && run.id === opId) return [];
  if (banned(tk, opId) || wounded(tk)) {
    tk.mem.blocked = `operation ${opId}: resting after a defeat`;
    tk.mem.waiting = true;
    return trainForFight(tk);
  }
  const hardest = op.stages
    .flatMap((s) => (s.t === 'fight' ? [entryOf(content, s.enemy)] : []))
    .flatMap((e) => (e ? [e] : []));
  for (const e of hardest) tk.mem.studyTargets.add(e.id);
  // The stages are fought back to back, so the chance is that of the whole run, not of the weakest stage.
  const rate = operationRate(tk, opId);
  // A character with every skill at the cap has nothing left to train: it goes in and takes what comes.
  // No forecast (an entry is unknown): the first look is taken when the levels are in reach, as worthLooking states.
  if (
    rate === null ? !worthLooking(tk, operationEntries(content, opId)) : rate < TUNING.opWinRate
  ) {
    tk.mem.blocked = `operation ${opId}: win rate of a run ${rate === null ? 'unknown' : rate.toFixed(2)}${maxed(tk) ? ' with every skill at the cap' : ''}`;
    if (!maxed(tk)) {
      tk.mem.waiting = true;
      return trainForFight(tk);
    }
  }
  return [
    ...(state.combat ? [{ type: 'action.stop', slot: 0 } as Command] : []),
    ...prepareFight(tk, lastEnemyOf(content, opId) ?? opId),
    { type: 'action.start', slot: 0, kind: 'operation', id: opId },
  ];
}

/** What the unmet leaf of a requirement asks the player to do, as a plan. */
function leafPlan(tk: Toolkit, leaf: ReqResult, depth: number): Plan {
  const { state, content } = tk.ctx;
  const req = leaf.req;
  switch (req.t) {
    case 'skill':
      return trainSkill(tk, req.skill) ?? (isNature(content, req.skill) ? null : trainAny(tk));
    case 'technique': {
      const scroll = scrollOf(req.id, content);
      const tech = content.techniques.find((t) => t.id === req.id);
      // A scroll in the bank is read once the technique's own requirements hold; before that the game refuses it.
      if (
        scroll !== null &&
        (state.bank[scroll] ?? 0) > 0 &&
        (!tech || evalReq(state, learnReq(tech, content), content).met)
      )
        return [{ type: 'item.use', id: scroll }];
      if (scroll !== null) {
        const entry = shopEntries(content).find((s) => s.item === scroll);
        const open = entry ? evalReq(state, entry.req, content) : null;
        if (open?.met) {
          const price = buyPrice(scroll, content) ?? Infinity;
          if (ryo(tk) >= price) return [{ type: 'shop.buy', item: scroll, n: 1 }];
          return bestMission(tk) ?? trainAny(tk);
        }
        // The shop does not sell it yet (a building): work on what opens it.
        for (const u of open && depth < 5 ? unmetLeaves(open) : []) {
          const plan = leafPlan(tk, u, depth + 1);
          if (plan) return plan;
        }
      }
      if (tech && depth < 4) {
        const unmet = unmetLeaves(evalReq(state, learnReq(tech, content), content));
        for (const u of unmet) {
          const plan = leafPlan(tk, u, depth + 1);
          if (plan) return plan;
        }
      }
      return null;
    }
    case 'item':
      return supplyPlan(tk, req.id, req.n);
    case 'rank': {
      const exam = examFor(content, req.rank);
      if (!exam || depth > 4) return null;
      for (const u of unmetLeaves(evalReq(state, exam.checklist, content))) {
        const plan = leafPlan(tk, u, depth + 1);
        if (plan) return plan;
      }
      return null;
    }
    case 'nature': {
      const status = natureStatus(state, content);
      if (status.needCc !== null && status.cc < status.needCc) return trainSkill(tk, 'cc');
      return null;
    }
    case 'quest': {
      const quest = content.quests.find((q) => q.id === req.id);
      const progress = state.quests[req.id];
      if (!quest || !progress || progress.done || depth > 4) return null;
      const step = quest.steps[progress.step];
      return step ? objectivePlan(tk, step.objective, depth + 1) : null;
    }
    case 'currency': {
      const role = req.role;
      if (role === 'study') return exploreAny(tk);
      if (role === 'renown') {
        return bestMission(tk, (m) => m.rank !== 'V' && m.forecast.repPerHour > 0, true);
      }
      return null;
    }
    case 'building': {
      return buildPlan(tk, req.id);
    }
    case 'flag': {
      const id = req.id;
      if (id.startsWith('poi.')) {
        const cell = cellOfPlace(content, id.slice(4));
        const poiCell = cell ?? content.cells.find((c) => c.pois.some((p) => `poi.${p.id}` === id));
        if (!poiCell) return null;
        return exploreCell(tk, poiCell.id);
      }
      const op = content.operations.find((o) => o.clearFlag === id);
      if (op) return operationPlan(tk, op.id) ?? null;
      const region = id.match(/^region\.(.+)\.unlocked$/)?.[1];
      if (region) {
        const r = content.regions.find((x) => x.id.endsWith(region));
        if (!r) return null;
        const info = evalReq(state, regionOpenReq(r, content), content);
        for (const u of unmetLeaves(info)) {
          const plan = depth < 4 ? leafPlan(tk, u, depth + 1) : null;
          if (plan) return plan;
        }
        return null;
      }
      if (id.startsWith('exam.') && id.endsWith('.written')) {
        const exam = content.exams.find((e) => examWrittenFlag(e) === id);
        return exam ? examPlan(tk, exam.rank) : null;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Starts the exam when its checklist holds; otherwise null. */
function examPlan(tk: Toolkit, rank: string): Plan {
  const { state, content } = tk.ctx;
  const exam = examFor(content, rank);
  if (!exam) return null;
  const run = state.slots[0]?.action ?? null;
  if (run?.kind === SENSEI_TEST_KIND) return [];
  if (!evalReq(state, exam.checklist, content).met) return null;
  return [{ type: 'exam.start', rank }];
}

/** Builds a village building level: the build when affordable, the missions that bring the goods otherwise. */
function buildPlan(tk: Toolkit, building: string): Plan {
  const { state, content } = tk.ctx;
  const info = villageBuildings(state, content).find((b) => b.id === building);
  if (!info || info.nextLevel === null) return null;
  tk.mem.wantBuilding = building;
  // One build at a time: while one is under way (the housekeeping spends the workforce on it) there is nothing to start.
  if (state.village?.job) return null;
  if (info.build.ok) return [{ type: 'village.build', building }];
  // Missions bring what a build lacks (ryo, the village's resources); a wait for a stage or the queue is not theirs to shorten.
  const lacking = info.needs.filter((n) => !n.met);
  if (lacking.length > 0 && lacking.every((n) => n.kind === 'stage' || n.kind === 'queue'))
    return null;
  // Earning for a build is steady work, not a step the story is waiting on: it takes turns with the other waiting plans.
  const plan = bestMission(tk, (m) => m.rank === 'V' || m.forecast.ryoPerHour > 0, true);
  if (plan !== null) tk.mem.waiting = true;
  return plan;
}

/** The plan for one quest objective. */
export function objectivePlan(
  tk: Toolkit,
  objective: { t: string } & Record<string, unknown>,
  depth = 0,
): Plan {
  const { state, content } = tk.ctx;
  if (objective.t === 'req') {
    const result = evalReq(state, objective.req as Req, content);
    // Renown is earned by missions, which train skills as fast as practice does: it is worked on first, not last.
    const leaves = unmetLeaves(result).sort(
      (a, b) => Number(b.req.t === 'currency') - Number(a.req.t === 'currency'),
    );
    for (const leaf of leaves) {
      const plan = leafPlan(tk, leaf, depth);
      if (plan !== null) return plan;
    }
    return null;
  }
  if (objective.t === 'pay') {
    // Intel comes from exploring; the payment itself is housekeeping.
    return exploreAny(tk);
  }
  if (objective.t === 'counter') {
    const key = objective.counter as string;
    const n = (objective.n as number) ?? 1;
    if (key.startsWith('kills.')) {
      const enemies = [
        key.slice('kills.'.length),
        ...((objective.also as string[] | undefined) ?? []).map((k) => k.slice('kills.'.length)),
      ];
      const missing = enemies.filter((e) => counterValue(state, `kills.${e}`) < n);
      for (const enemy of missing.length > 0 ? missing : enemies) {
        const plan = fightFor(tk, enemy);
        if (plan !== null) return plan;
      }
      return null;
    }
    if (key.startsWith('explored.')) {
      const region = key.slice('explored.'.length);
      const cells = content.cells.filter((c) => c.region === region);
      const open = cells
        .filter((c) => cellLevel(state, c, content) < 1)
        .sort((a, b) => a.index - b.index);
      for (const c of open) {
        const plan = exploreCell(tk, c.id);
        if (plan) return plan;
      }
      return null;
    }
    if (key.startsWith('missions.done.')) {
      const id = key.slice('missions.done.'.length);
      const plan = mission(tk, id);
      if (plan) return plan;
      const entry = board(tk).find((m) => m.id === id);
      const first = entry?.blocker ? firstUnmetLeaf(entry.blocker.result) : null;
      if (first && depth < 4) return leafPlan(tk, first, depth + 1);
      return null;
    }
    if (key.startsWith('missions.rank.') || key.startsWith('missions.elemental.')) {
      const rank = key.slice(key.lastIndexOf('.') + 1);
      return shortestMission(
        tk,
        rank,
        tk.fightsToTrain || key.startsWith('missions.elemental.'),
        key.startsWith('missions.elemental.'),
      );
    }
    if (key === 'natures.gained') {
      const status = natureStatus(state, content);
      if (status.needCc !== null && status.cc < status.needCc) return trainSkill(tk, 'cc');
      return null;
    }
    return null;
  }
  return null;
}

/** The story policy: the active quest steps in the order of the content, the first that can be worked on. */
export function storyPlan(tk: Toolkit): Plan {
  const { state, content } = tk.ctx;
  tk.mem.blocked = null;
  tk.mem.wantBuilding = null;
  const stuck: string[] = [];
  // A step that is a fight or an operation the character is not yet ready for only has it train: the other
  // quests' steps that can move on now come first, and the waiting one gets the time when nothing else can.
  const waiting: { plan: Command[]; blocked: string | null }[] = [];
  for (const quest of content.quests) {
    const progress = state.quests[quest.id];
    if (!progress || progress.done) continue;
    const step = quest.steps[progress.step];
    if (!step) continue;
    tk.mem.waiting = false;
    tk.mem.blocked = null;
    const plan = objectivePlan(
      tk,
      step.objective as unknown as { t: string } & Record<string, unknown>,
    );
    if (plan !== null && !tk.mem.waiting) return plan;
    if (plan !== null) waiting.push({ plan, blocked: tk.mem.blocked });
    else stuck.push(`${quest.id} step ${progress.step + 1}`);
  }
  tk.mem.waiting = false;
  // The waiting plans take turns by the half hour (training for a fight, earning for a build), as a player rotates.
  const turn = waiting[Math.floor(state.now / (30 * MINUTE)) % Math.max(1, waiting.length)];
  if (turn) {
    tk.mem.blocked = turn.blocked;
    return turn.plan;
  }
  tk.mem.blocked = stuck.length > 0 ? `no way to work on: ${stuck.join(', ')}` : null;
  return null;
}

// ------------------------------------------------------------ housekeeping

/** What the open quest steps still ask to be paid in the currency of `role`. */
function openPayment(tk: Toolkit, role: string): number {
  const { state, content } = tk.ctx;
  let owed = 0;
  for (const quest of content.quests) {
    const progress = state.quests[quest.id];
    const step = progress && !progress.done ? quest.steps[progress.step] : undefined;
    if (step?.objective.t === 'pay' && step.objective.role === role) owed += step.objective.n;
  }
  return owed;
}

/** Everything a player does between actions: nature, exam, scrolls, payments, shopping, building. Always on. */
export function housekeeping(tk: Toolkit): Command[] {
  const { state, content, rules } = tk.ctx;
  const out: Command[] = [];
  const purse = ryo(tk);

  if (!state.player.name) out.push({ type: 'player.setName', name: 'Bot' });

  // Natures: the native one at the paper test, then the others of the triple as Chakra Control allows.
  const status = natureStatus(state, content);
  if (status.stage === 'test' && tk.triple[0]) {
    out.push({ type: 'nature.choose', nature: tk.triple[0] });
  } else if (status.canChoose) {
    const next = tk.triple.find((n) => !state.player.natures.includes(n));
    if (next) out.push({ type: 'nature.add', nature: next });
  }

  // Scrolls in the bank are read.
  for (const t of content.techniques) {
    const scroll = scrollOf(t.id, content);
    if (
      scroll !== null &&
      !state.known[t.id] &&
      (state.bank[scroll] ?? 0) > 0 &&
      evalReq(state, learnReq(t, content), content).met
    ) {
      out.push({ type: 'item.use', id: scroll });
    }
  }

  // The rank exam, when its checklist holds (and the second part, once the written test is passed).
  const run = state.slots[0]?.action ?? null;
  if (run?.kind !== SENSEI_TEST_KIND && state.now - tk.mem.examTriedAt >= 5 * MINUTE) {
    for (const exam of content.exams) {
      const target = rankIndex(content, exam.rank);
      if (target !== rankIndex(content, state.player.rank) + 1) continue;
      // An exam in two parts: once the written test is passed, the second part waits for its requirement.
      const second = exam.then && state.flags[examWrittenFlag(exam)] !== undefined;
      const ready = second
        ? evalReq(state, exam.then as Req, content).met
        : evalReq(state, exam.checklist, content).met;
      if (ready) {
        out.push({ type: 'exam.start', rank: exam.rank });
        tk.mem.examTriedAt = state.now;
      }
    }
  }

  // Quest payments (Intel) as soon as the purse holds them.
  for (const quest of content.quests) {
    const progress = state.quests[quest.id];
    const step = progress && !progress.done ? quest.steps[progress.step] : undefined;
    if (step?.objective.t === 'pay') {
      const role = step.objective.role;
      const currency = content.currencies.find((c) => c.role === role)?.id;
      if (currency && (state.currencies[currency] ?? 0) >= step.objective.n) {
        out.push({ type: 'quest.pay', quest: quest.id });
      }
    }
  }

  // Intel buys the Bingo levels of the entries the story is about to fight (the level between is earned by a fight).
  const intelId = content.currencies.find((c) => c.role === 'study')?.id;
  if (intelId) {
    let intel = state.currencies[intelId] ?? 0;
    const owed = openPayment(tk, 'study');
    for (const id of tk.mem.studyTargets) {
      const level = bingoLevel(state, id, content);
      if (level === 1 || level >= 3 || level === 0) continue;
      if (intel - studyCost(content) < owed) break;
      out.push({ type: 'bingo.study', enemy: id });
      intel -= studyCost(content);
    }
  }

  // Caches and vaults next to the player.
  for (const c of listCells(state, content, rules)) {
    for (const p of c.pois) if (p.claimable) out.push({ type: 'world.claim', poi: p.id });
  }

  // Gear lines: the next tier when it is open and cheap enough.
  let budget = purse * TUNING.spendShare;
  for (const line of content.gear) {
    const req = nextTierReq(state, line, content);
    const price = nextTierPrice(state, line, content);
    if (!req || price === null || price > budget) continue;
    if (!evalReq(state, req, content).met) continue;
    out.push({ type: 'gear.buy', line: line.id });
    budget -= price;
  }

  // Athletics: the cheapest obstacle of every open slot that has none.
  const obstacles = listCourse(state, content, rules);
  for (const slot of obstacles) {
    if (!slot.open || slot.built !== null) continue;
    const option = slot.options
      .filter((o) => o.blocked === null && o.cost <= budget)
      .sort((a, b) => a.cost - b.cost)[0];
    if (option) {
      out.push({ type: 'athletics.build', slot: slot.slot, obstacle: option.id });
      budget -= option.cost;
    }
  }

  // The village: the building that is ready is built; the treasury is topped up for the one that lacks only ryo.
  const village = state.village;
  if (village) {
    if (village.job) {
      if (village.workforce > 0) out.push({ type: 'village.workforce' });
    } else {
      const all = villageBuildings(state, content).filter((b) => b.nextLevel !== null);
      // The building the story asked for goes first; the others only while nothing is wanted.
      const wanted = all.filter((b) => b.id === tk.mem.wantBuilding);
      const infos = wanted.length > 0 ? wanted : all;
      const ready = infos.find((b) => b.build.ok);
      if (ready) out.push({ type: 'village.build', building: ready.id });
      else {
        const lackTreasury = infos.find(
          (b) =>
            b.needs.every((n) => n.met || n.kind === 'treasury') &&
            b.needs.some((n) => n.kind === 'treasury' && !n.met),
        );
        const need = lackTreasury?.needs.find((n) => n.kind === 'treasury');
        if (need) {
          const gap = need.target - need.current;
          const give = Math.min(gap, Math.floor(purse * TUNING.donateShare));
          if (give >= 1) out.push({ type: 'village.donate', ryo: give });
        }
      }
    }
  }
  return out;
}

/** The slot the clone works in, when the character has one: a skill the main slot does not train. */
export function clonePlan(tk: Toolkit, mainSkill: string | null): Command[] {
  const { state, content, rules } = tk.ctx;
  if (slotCount(state, content) < 2 || cloneSlots(state, content).length === 0) return [];
  const slot = 1;
  const current = state.slots[slot]?.action ?? null;
  // A clone is a burst: one that has nothing left to do is dispelled (its knowledge goes to the character),
  // and a tired mind makes none.
  if (current?.kind === STAND_KIND) return [{ type: 'clone.dispel', slot }];
  if (!state.clones[slot] && state.fatigue > 0) return [];
  const main = state.slots[0]?.action ?? null;
  const skills = trainableSkills(tk)
    .filter((s) => s !== mainSkill)
    .filter((s) => content.skills.find((d) => d.id === s)?.group !== 'combat')
    .sort((a, b) => level(tk, a) - level(tk, b));
  // A craft in the main slot is fed by a gatherer in the clone.
  if (main?.kind === KIND_CRAFT) {
    const recipe = content.recipes.find((r) => r.id === main.id);
    const herb = recipe?.ingredients.find((i) =>
      listSkillActions(state, 'herb', content, rules).some(
        (a) => a.kind === KIND_GATHER && a.id === i.item && a.available,
      ),
    );
    if (herb) {
      return current?.kind === KIND_GATHER && current.id === herb.item
        ? []
        : [{ type: 'action.start', slot, kind: KIND_GATHER, id: herb.item }];
    }
  }
  if (current && current.kind !== KIND_CRAFT) {
    const info = skills.some((s) =>
      listSkillActions(state, s, content, rules).some(
        (a) => a.kind === current.kind && a.id === current.id,
      ),
    );
    if (info) return [];
  }
  for (const skill of skills) {
    const best = bestAction(tk, skill, false);
    if (!best || (main && main.kind === best.kind && main.id === best.id)) continue;
    if (current?.kind === best.kind && current.id === best.id) return [];
    return [{ type: 'action.start', slot, kind: best.kind, id: best.id }];
  }
  return [];
}

/** The skill the action running in `slot` trains, or null. */
export function skillOfRunning(tk: Toolkit, slot = 0): string | null {
  const { state, content, rules } = tk.ctx;
  const run = state.slots[slot]?.action;
  if (!run) return null;
  for (const s of content.skills) {
    if (
      listSkillActions(state, s.id, content, rules).some(
        (a) => a.kind === run.kind && a.id === run.id,
      )
    ) {
      return s.id;
    }
  }
  return null;
}

export { isAcademyRank };
