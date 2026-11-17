import {
  scrollPartId,
  type Boss,
  type ContentDb,
  type Enemy,
  type Item,
  type Operation,
  type SkillId,
  type Technique,
} from '@shinobi/content';
import { isCloneSlot } from '../clone.ts';
import { rebalanceShares } from '../actions.ts';
import { advance, dispatch } from '../engine.ts';
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { bossNature } from '../natures.ts';
import { createStream, createStreams, nextInt, nextUint32 } from '../rng.ts';
import type { Rules } from '../rules.ts';
import { deserialize, serialize } from '../save.ts';
import { scrollOf } from '../scrolls.ts';
import { buyPrice } from '../shop.ts';
import type { GameState } from '../state.ts';
import { bingoLevel, dropShown, isFirstWin, revealAt } from './bingo.ts';
import { voidCount } from './fight-guard.ts';
import { figure, need } from './need.ts';
import { createFight, fightAdvance, fightTimeMs } from './fight.ts';
import { encounterFor } from './fight-encounter.ts';
import { fightSim } from './fight-sim.ts';
import type { Encounter, FightState } from './fight-types.ts';
import { itemAnswers } from './fight-items.ts';
import { answersTrait, planTarget } from './loadout.ts';
import { secMs, type PlayerSnapshot } from './numbers.ts';
import { snapshotPlayer } from './snapshot.ts';
import { FIGHT_KIND, OPERATION_KIND, isCombatKind } from './system.ts';
import { approachMs, entryOf, fightTarget, opSteps } from './zones.ts';

/** What a battle analysis is asked about: a fight zone, a boss (its id or its zone's), or an operation. */
export interface AnalysisTarget {
  kind: 'zone' | 'boss' | 'operation';
  id: string;
}

export interface AnalysisOptions {
  /** Fights of the first-fight run (runs, for an operation); the balance default when absent. */
  samples?: number;
  /** Seed of the simulation; the balance default when absent. It never touches the game's streams. */
  seed?: number;
  /** A loadout to try in place of the player's (ids of techniques the player knows). */
  loadout?: readonly string[];
  /** Minutes of one session, and the fewest and most sessions; the balance defaults when absent. */
  sessionMinutes?: number;
  minSessions?: number;
  maxSessions?: number;
}

/** The marker of what the Bingo book does not show yet. It never depends on what is hidden. */
export type Unknown = 'unknown';
export const UNKNOWN: Unknown = 'unknown';

/** One answer to a known trait: a technique of the loadout or an item of the pouch. */
export interface TraitCoverage {
  /** The enemy entry the trait belongs to (an operation has several). */
  enemy: string;
  trait: string;
  answered: boolean;
  by: { kind: 'technique' | 'item'; id: string }[];
}

/** Where a technique or tool for an uncovered trait can be had. */
export type HintOption =
  | {
      kind: 'technique';
      id: string;
      skill: SkillId;
      level: number;
      /** `mentor`: taught at that skill level; `library`: a scroll of the Library; `carrier`: parts from the enemies that carry it; `scroll`: a scroll found elsewhere; `quest`: a quest line. */
      source: 'mentor' | 'library' | 'carrier' | 'scroll' | 'quest';
      ryo: number | null;
      /** Enemies that carry it, for a carrier source, as far as the Bingo book shows them. */
      carriers: string[];
    }
  | {
      kind: 'tool';
      id: string;
      /** `owned`: in the bank, to be packed; `shop`: sold; `craft`: made from the recipe. */
      source: 'owned' | 'shop' | 'craft';
      ryo: number | null;
    };

export interface Hint {
  enemy: string;
  trait: string;
  /** The cheapest first. */
  options: HintOption[];
}

/** A spread over the sessions: the tenth percentile, the median, the ninetieth, the mean and how many sessions it comes from. */
export interface Band {
  p10: number;
  median: number;
  p90: number;
  mean: number;
  n: number;
}

/** The Wilson score interval of a share, with the number of trials it comes from. Honest at small n, where a plain standard error claims certainty. */
export interface Ci {
  lo: number;
  hi: number;
  n: number;
}

/**
 * The first fight of a fresh character against the target: one fight (or one operation run) with
 * the Wounds, pouch and loadout as they are now. These are not yields: the per-hour figures here
 * assume nothing changes from one fight to the next, which Wounds and the pouch make untrue.
 */
export interface Fresh {
  samples: number;
  winRate: number;
  /** The interval of `winRate`, so that the UI can round it honestly. */
  winRateCi: Ci;
  /** Mean time of a won fight (or run), ms, and of any fight (or run). */
  meanWinMs: number;
  meanMs: number;
  /** What playing fresh fights back to back would give per hour. */
  winsPerHour: number;
  woundsPerHour: number;
  itemsPerHour: Record<string, number>;
}

/**
 * What the sessions say about the target as a whole: `stable` only when the upper bound of the
 * collapse share is under the balance threshold; `hopeless` when the median session is lost;
 * otherwise `risky`, which also covers a forecast that ran out of budget before the interval
 * could decide.
 */
export type Verdict = 'stable' | 'risky' | 'hopeless';

/** A consumable the sessions use: what it costs per hour, what the player has, and how long that lasts. */
export interface Supply {
  item: string;
  perHour: number;
  /** Units in the pouch and the bank, as the refill rule sees them. */
  stock: number;
  lastsMinutes: number;
}

/** The forecast for the time after the consumables that run out within the horizon are gone. */
export interface AfterSupplies {
  removed: string[];
  runs: number;
  winRate: Band;
  winsPerHour: Band;
  collapseShare: number;
  collapseCi: Ci;
  verdict: Verdict;
}

/**
 * The target played as sessions of the real game loop on detached copies of the state: the fight
 * action started in the slot it would take, the other slots as they are, Wounds, the pouch, the
 * regeneration and the pauses all as in play; the sessions are independent. Everything here is
 * the distribution over the sessions, and is stated for the time the supplies last:
 * `horizonMinutes` is the shortest `lastsMinutes` (null: nothing that runs out is used). What
 * comes after is in `afterSupplies`. Figures that assume the player restarts at once after a
 * defeat say so in `assumesRestart`; what happens when the player does not is in `untilDefeat`.
 * Loot figures follow the Bingo knowledge level through revealAt.
 */
export interface Session {
  minutes: number;
  /** Sessions played. */
  runs: number;
  /** The share of full speed the fight slot had (thousandths), with the other slots as they are now. */
  share: number;
  assumesRestart: true;
  /** The consumables used, the soonest to run out first, and the time until the first runs out. */
  supplies: Supply[];
  horizonMinutes: number | null;
  /** Wins over wins, defeats and timeouts of a session (for an operation: clears over clears and defeats). */
  winRate: Band;
  /** The interval of the pooled win rate over every fight of every session. */
  winRateCi: Ci;
  winsPerHour: Band;
  /** Share of sessions whose win rate fell under the collapse threshold, and its interval. */
  collapseShare: number;
  collapseCi: Ci;
  verdict: Verdict;
  /** Without an immediate restart: the sessions that never saw a defeat (with the interval), and the minutes to the first one (a session without one counts as its length). */
  untilDefeat: { noDefeatShare: number; noDefeatCi: Ci; minutes: Band };
  /** Per-hour yields, means over the sessions, without one-off rewards. */
  ryoPerHour: number | Unknown;
  bountyPerHour: number | Unknown;
  loot: Record<string, number | Unknown> | Unknown;
  /** Skill XP and mastery XP per hour, as they landed (the other slots included). */
  xpPerHour: Partial<Record<SkillId, number>>;
  masteryPerHour: Record<string, number>;
  /** Wound stacks over the sessions: the mean and the most reached; and Wounds earned per hour. */
  woundStacks: { mean: number; max: number };
  woundsPerHour: number;
  itemsPerHour: Record<string, number>;
  /** After the supplies run out; null when nothing runs out within the planning horizon. */
  afterSupplies: AfterSupplies | null;
}

/** Rewards that can be had once: the first-kill bounty and the first clear of an operation. */
export interface Once {
  bounty: number | Unknown;
  /** The first clear: ryo and reputation, and the scroll parts it may give, each as a count and a chance. */
  clear: {
    ryo: number;
    rep: number;
    parts: { item: string; count: number; chance: number }[];
  } | null;
}

export interface Analysis {
  /** Present when a hook of a pack failed during the analysis: that many fights were cut short (counted as neither a defeat nor a Wound) and the forecast is unreliable. */
  voided?: number;
  target: AnalysisTarget;
  fresh: Fresh;
  /** For each trait the player knows, what answers it; the others are only counted. */
  coverage: TraitCoverage[];
  hiddenTraits: number;
  hints: Hint[];
  /** The session forecast; null when the target cannot be started from this state (see `sessionBlocked`). */
  session: Session | null;
  /** Why there is no session: the localization key of the refusal; null when there is one. */
  sessionBlocked: string | null;
  once: Once;
}

/** How far a job is: units done of units expected so far (the sessions may stop early), and whether it is finished. */
export interface AnalysisProgress {
  done: number;
  total: number;
  finished: boolean;
}

/** The difference of two analyses of one target: B minus A. */
export interface LoadoutComparison {
  a: Analysis;
  b: Analysis;
  fresh: { winRate: number; meanWinMs: number };
  /** Differences of the session medians and means; null when either side cannot be played as a session. */
  session: {
    winRate: number;
    winsPerHour: number;
    collapseShare: number;
    woundStacksMax: number;
  } | null;
}

type Entry = Enemy | Boss;

interface Resolved {
  entries: Entry[];
  op: Operation | null;
}

function resolve(target: AnalysisTarget, content: ContentDb): Resolved | null {
  if (target.kind === 'operation') {
    const op = indexOf(content).operations.get(target.id);
    if (!op) return null;
    const ids = new Set<string>();
    for (const step of opSteps(op)) {
      if (step.t === 'fight') ids.add(step.enemy);
      else if (step.t === 'draw') for (const id of step.pool) ids.add(id);
    }
    const entries = [...ids].flatMap((id) => entryOf(content, id) ?? []);
    return { entries, op };
  }
  const entry = fightTarget(content, target.id)?.enemy ?? entryOf(content, target.id);
  return entry ? { entries: [entry], op: null } : null;
}

/** The snapshot the analysis plays with: the player as they are now, the pouch topped up from the bank as a fight start does. */
function snapshotFor(
  state: GameState,
  entries: readonly Entry[],
  opts: AnalysisOptions,
  content: ContentDb,
  rules: Rules,
): PlayerSnapshot {
  const snap = snapshotPlayer(
    state,
    content,
    rules,
    undefined,
    entries.map((e) => e.id),
  );
  const cap = content.balance.K.pouchStack;
  snap.pouch = (snap.pouch ?? []).map((s) =>
    s.id === '' ? { ...s } : { id: s.id, n: Math.min(cap, s.n + (state.bank[s.id] ?? 0)) },
  );
  if (opts.loadout) {
    const known = new Set(snap.known);
    snap.loadout = opts.loadout.filter((id, i, all) => known.has(id) && all.indexOf(id) === i);
    if (snap.signature !== undefined && !snap.loadout.includes(snap.signature)) {
      delete snap.signature;
    }
  }
  return snap;
}

const encounterOf = (state: GameState, entry: Entry, content: ContentDb): Encounter =>
  encounterFor(entry, content, [], 'special' in entry ? bossNature(state, entry) : null);

/** What a batch of plays of the target adds up to, per play (a fight, or an operation run from the first step). */
interface Figures {
  runs: number;
  wins: number;
  /** Mean time over all plays and over the won ones, ms; the pauses between enemies are in. */
  allMs: number;
  winMs: number;
  wounds: number;
  items: Record<string, number>;
}

/** A batch of plays that is advanced a few plays at a time; the figures do not depend on how it was cut. */
interface Batch {
  /** Fight time played so far, in ms. */
  simulatedMs(): number;
  /** Plays up to `plays` more; true once the batch is complete. */
  step(plays: number): boolean;
  figures(): Figures;
}

function runZone(
  snap: PlayerSnapshot,
  encounter: Encounter,
  samples: number,
  seed: number,
  content: ContentDb,
  rules: Rules,
): Batch {
  const sim = fightSim(
    snap,
    encounter,
    samples,
    seed,
    content,
    rules,
    content.balance.K.zoneHpRegen,
  );
  return {
    simulatedMs: () => sim.simulatedMs,
    step: (plays) => sim.step(plays),
    figures() {
      const sum = sim.summary();
      return {
        runs: sum.fights,
        wins: sum.wins,
        allMs: sum.timeAllMs,
        winMs: sum.timeMs.mean,
        wounds: sum.wounds,
        items: sum.items,
      };
    },
  };
}

/** Plays the operation `runs` times from the first step: pools carry over with the partial recovery, the pouch is not refilled, a lost fight ends the run. */
function runOperation(
  snap: PlayerSnapshot,
  op: Operation,
  encounters: Readonly<Record<string, Encounter>>,
  approach: number,
  runs: number,
  seed: number,
  content: ContentDb,
  rules: Rules,
): Batch {
  const K = content.balance.K;
  const steps = opSteps(op);
  const rng = createStream(seed, 'analysis.pick');
  const total: Figures = { runs, wins: 0, allMs: 0, winMs: 0, wounds: 0, items: {} };
  const respawn = secMs(K.respawn);
  let played = 0;
  let simulatedMs = 0;
  const play = (r: number): void => {
    let pools: { hp?: number; chakra?: number; stamina?: number } = {};
    let pouch = (snap.pouch ?? []).map((s) => ({ ...s }));
    let wounds = snap.wounds ?? 0;
    let ms = 0;
    let won = true;
    for (const [i, step] of steps.entries()) {
      if (step.t === 'approach') {
        ms += approach;
        continue;
      }
      const id = step.t === 'fight' ? step.enemy : step.pool[nextIntFrom(rng, step.pool.length)];
      const encounter = id === undefined ? undefined : encounters[id];
      if (!encounter) {
        won = false;
        break;
      }
      const seedOf = nextUint32(createStream(seed, `analysis.${r}.${i}`));
      const fight: FightState = createFight(
        { ...snap, ...pools, pouch, wounds },
        encounter,
        seedOf,
        content,
        rules,
      );
      fight.log = null;
      fightAdvance(fight, fight.cap + 1, content, rules);
      ms += fightTimeMs(fight);
      snap.pouch?.forEach((slot, k) => {
        const spent = (pouch[k]?.n ?? slot.n) - (fight.pouch[k]?.n ?? slot.n);
        if (slot.id !== '' && spent > 0)
          total.items[slot.id] = (total.items[slot.id] ?? 0) + spent / runs;
      });
      const victory = fight.result === 'victory' || fight.result === 'fled';
      total.wounds +=
        ((victory ? 0 : 1) +
          (victory && fight.player.data.low === 1 ? 1 : 0) +
          fight.tally.wounds) /
        runs;
      if (!victory) {
        won = false;
        break;
      }
      wounds = Math.min(
        K.wound.max,
        wounds + fight.tally.wounds + (fight.player.data.low === 1 ? 1 : 0),
      );
      pouch = fight.pouch.map((s) => ({ ...s }));
      const p = fight.player;
      pools = {
        hp: Math.min(p.maxHp, p.hp + K[op.regen] * p.maxHp),
        chakra: Math.min(p.maxChakra, p.chakra + K[op.regen] * p.maxChakra),
        stamina: Math.min(p.maxStamina, p.stamina + K[op.regen] * p.maxStamina),
      };
      if (i < steps.length - 1) ms += respawn;
    }
    simulatedMs += ms;
    total.allMs += ms / runs;
    if (won) {
      total.wins++;
      total.winMs += ms;
    }
  };
  return {
    simulatedMs: () => simulatedMs,
    step(plays) {
      for (let k = 0; k < plays && played < runs; k++) play(played++);
      return played >= runs;
    },
    figures: () => ({ ...total, winMs: total.wins === 0 ? 0 : total.winMs / total.wins }),
  };
}

function nextIntFrom(rng: ReturnType<typeof createStream>, n: number): number {
  return nextInt({ r: rng }, 'r', n);
}

// ---------- coverage and hints ----------

function coverageOf(
  snap: PlayerSnapshot,
  entries: readonly Entry[],
  state: GameState,
  content: ContentDb,
): { coverage: TraitCoverage[]; hidden: number } {
  const index = indexOf(content);
  const coverage: TraitCoverage[] = [];
  let hidden = 0;
  const first = state.player.natures[0];
  const carried = (snap.loadout ?? snap.known).flatMap((id) => index.techniques.get(id) ?? []);
  const packed = (snap.pouch ?? []).flatMap((s) => {
    const item = s.id !== '' && s.n > 0 ? index.items.get(s.id) : undefined;
    return item ? [item] : [];
  });
  for (const entry of entries) {
    const known = snap.knowledge?.[entry.id] ?? [];
    const { traits } = planTarget(entry, known, first, content);
    hidden += entry.traits.filter((t) => !known.includes(t)).length;
    for (const trait of traits) {
      const by: TraitCoverage['by'] = [
        ...carried
          .filter((t) => answersTrait(t, trait, content))
          .map((t) => ({ kind: 'technique' as const, id: t.id })),
        ...packed
          .filter((i) => itemAnswers(i, trait, content))
          .map((i) => ({ kind: 'item' as const, id: i.id })),
      ];
      coverage.push({ enemy: entry.id, trait, answered: by.length > 0, by });
    }
  }
  return { coverage, hidden };
}

const byCost = (a: HintOption, b: HintOption): number =>
  (a.ryo ?? Infinity) - (b.ryo ?? Infinity) ||
  (a.kind === 'technique' ? a.level : 0) - (b.kind === 'technique' ? b.level : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A way to learn a technique. A technique that only enemies carry is offered only when the Bingo
 * book already shows the player one that carries it; otherwise it is not offered at all, so a hint
 * cannot name a carrier the book hides.
 */
function techniqueOption(tech: Technique, state: GameState, content: ContentDb): HintOption | null {
  const index = indexOf(content);
  const carriers = [...content.enemies, ...content.bosses]
    .filter((e) => e.carries === tech.id && revealAt(bingoLevel(state, e.id, content)).carries)
    .map((e) => e.id);
  const base = { kind: 'technique' as const, id: tech.id, skill: tech.skill, level: tech.level };
  if (tech.src === 'N') return { ...base, source: 'mentor', ryo: 0, carriers: [] };
  if (tech.src === 'Q') return { ...base, source: 'quest', ryo: null, carriers: [] };
  const scroll = scrollOf(tech.id, content);
  const def = scroll ? index.items.get(scroll) : undefined;
  if (def?.scroll?.source.t === 'library') {
    return { ...base, source: 'library', ryo: buyPrice(def.id, content), carriers: [] };
  }
  if (carriers.length > 0) return { ...base, source: 'carrier', ryo: null, carriers };
  if (def && def.scroll?.source.t !== 'parts')
    return { ...base, source: 'scroll', ryo: null, carriers: [] };
  return null;
}

function toolOption(state: GameState, item: Item, content: ContentDb): HintOption | null {
  if ((state.bank[item.id] ?? 0) > 0) return { kind: 'tool', id: item.id, source: 'owned', ryo: 0 };
  const price = buyPrice(item.id, content);
  if (price !== null && indexOf(content).shop.has(item.id)) {
    return { kind: 'tool', id: item.id, source: 'shop', ryo: price };
  }
  const recipe = indexOf(content).recipeByOutput.get(item.id);
  if (recipe) {
    let ryo: number | null = 0;
    for (const ing of recipe.ingredients) {
      const unit = buyPrice(ing.item, content);
      ryo = ryo === null || unit === null ? null : ryo + unit * ing.n;
    }
    return { kind: 'tool', id: item.id, source: 'craft', ryo };
  }
  return null;
}

/** For every known trait nothing answers, the cheapest ways to answer it, from techniques not yet known and tools. */
function hintsFor(
  coverage: readonly TraitCoverage[],
  state: GameState,
  content: ContentDb,
): Hint[] {
  const K = content.balance.K;
  const hints: Hint[] = [];
  const done = new Set<string>();
  for (const c of coverage) {
    if (c.answered || done.has(`${c.enemy}.${c.trait}`)) continue;
    done.add(`${c.enemy}.${c.trait}`);
    const options: HintOption[] = [];
    for (const tech of content.techniques) {
      if (tech.rank === null || state.known[tech.id] || !answersTrait(tech, c.trait, content))
        continue;
      const o = techniqueOption(tech, state, content);
      if (o) options.push(o);
    }
    for (const item of content.items) {
      if (!itemAnswers(item, c.trait, content)) continue;
      const o = toolOption(state, item, content);
      if (o) options.push(o);
    }
    options.sort((a, b) => byCost(a, b));
    hints.push({
      enemy: c.enemy,
      trait: c.trait,
      options: options.slice(0, K.analysis.hintOptions),
    });
  }
  return hints;
}

// ---------- the job ----------

/** What one played session leaves behind; plain JSON. */
interface SessionRecord {
  wins: number;
  fights: number;
  /** Game ms of the first defeat, or null for a session without one. */
  firstDefeatMs: number | null;
  ryo: number;
  bounty: number;
  gained: Record<string, number>;
  xp: Partial<Record<SkillId, number>>;
  mastery: Record<string, number>;
  used: Record<string, number>;
  wounds: number;
  stackSum: number;
  stackMax: number;
  steps: number;
}

/** The first-fight run, summed over its batches. */
interface FreshTotals {
  batches: number;
  done: number;
  n: number;
  wins: number;
  allMs: number;
  winMs: number;
  wounds: number;
  items: Record<string, number>;
}

/**
 * An analysis under way, as plain JSON: it holds the state as saved text and the numbers worked
 * out at the start, so it can be run in slices, between which the game may change freely. The
 * result does not depend on how the slices were cut.
 */
export interface AnalysisJob {
  /** Fights a failing hook of a pack cut short while the job ran; the figures are unreliable when there are any. */
  voided?: number;
  target: AnalysisTarget;
  seed: number;
  samples: number;
  minutes: number;
  minSessions: number;
  maxSessions: number;
  loadout: string[] | null;
  stateText: string;
  snap: PlayerSnapshot;
  encounters: Record<string, Encounter>;
  approach: number;
  /** Bingo levels of the target's entries as they were at the start, and which of them still owe a first-kill bounty. */
  levels: Record<string, number>;
  owed: Record<string, boolean>;
  /** Units of each item in the pouch and the bank at the start, as the refill rule sees them. */
  stock: Record<string, number>;
  coverage: TraitCoverage[];
  hidden: number;
  hints: Hint[];
  once: Once;
  fresh: FreshTotals;
  sessions: SessionRecord[];
  /** The sessions of the forecast for after the supplies, the items taken away in it (null until known), and their most. */
  after: SessionRecord[];
  removed: string[] | null;
  maxAfter: number;
  /** The share the fight slot had at the first session; null before it. */
  share: number | null;
  /** The refusal that kept the target from starting in a session, if it did not start. */
  blockedReason: string | null;
  stopped: boolean;
  /** Game time played by the job so far, in ms: the fights of the first-fight run and the sessions. */
  simulatedMs: number;
}

/** The middle of the unit interval. */
const MEDIAN = 1 / 2;

/** Quantile of a sorted list by linear interpolation. */
function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (at - low);
}

function bandOf(values: readonly number[]): Band {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    p10: quantile(sorted, 0.1),
    median: quantile(sorted, MEDIAN),
    p90: quantile(sorted, 0.9),
    mean: n === 0 ? 0 : sorted.reduce((a, b) => a + b, 0) / n,
    n,
  };
}

/** The item ids a target can leave, with the enemies that carry each and whether it is a scroll part. */
function lootSources(found: Resolved): Map<string, { enemies: string[]; part: boolean }> {
  const sources = new Map<string, { enemies: string[]; part: boolean }>();
  for (const e of found.entries) {
    for (const d of e.drops) {
      const row = sources.get(d.item) ?? { enemies: [], part: false };
      row.enemies.push(e.id);
      sources.set(d.item, row);
    }
    if (e.scrollPart) {
      const row = sources.get(e.scrollPart.item) ?? { enemies: [], part: true };
      row.enemies.push(e.id);
      row.part = true;
      sources.set(e.scrollPart.item, row);
    }
  }
  return sources;
}

/** The rewards that can be had once, gated like the Bingo view. */
function onceOf(
  state: GameState,
  found: Resolved,
  levels: Readonly<Record<string, number>>,
  content: ContentDb,
): Once {
  const shown = found.entries.every((e) => revealAt(levels[e.id] ?? 0).bounty);
  let bounty = 0;
  for (const e of found.entries) {
    if (e.bounty && isFirstWin(state, e.id)) bounty += e.bounty.first;
  }
  const rewards = found.op?.rewards;
  const clear =
    found.op && rewards && state.flags[found.op.clearFlag] === undefined
      ? {
          ryo: rewards.first.ryo,
          rep: rewards.first.rep,
          parts: rewards.first.parts.map((p) => ({
            item: scrollPartId(p.technique),
            count: 1,
            chance: need(content.balance.K.partDrop[p.chance], `partDrop.${p.chance}`),
          })),
        }
      : null;
  return { bounty: shown ? bounty : UNKNOWN, clear };
}

/**
 * Starts an analysis of the target for the player as they are now: the loadout, the pouch, the
 * Wounds, the modifiers, the other slots and what the Bingo book lets the tactics know. The state
 * is read once; nothing in it or in the game's random streams is touched. A player in the middle
 * of a fight is analysed as one who starts the target now: the fight itself is not carried, but
 * the Wounds, the pouch and the slots are. Null for a target that does not exist.
 */
export function startAnalysis(
  state: GameState,
  target: AnalysisTarget,
  opts: AnalysisOptions,
  content: ContentDb,
  rules: Rules,
): AnalysisJob | null {
  const K = content.balance.K;
  const found = resolve(target, content);
  if (!found || found.entries.length === 0) return null;
  const snap = snapshotFor(state, found.entries, opts, content, rules);
  const samples = opts.samples ?? (found.op ? K.analysis.opSamples : K.analysis.samples);
  const size = figure(K.analysis.batch, found.op ? 'operation' : 'zone', 'analysis.batch');
  const minutes =
    opts.sessionMinutes ??
    figure(K.analysis.sessionMinutes, target.kind, 'analysis.sessionMinutes');
  const minSessions = opts.minSessions ?? K.analysis.minSessions;
  const hours = figure(K.analysis.sessionHours, target.kind, 'analysis.sessionHours');
  const maxSessions = Math.max(
    minSessions,
    opts.maxSessions ??
      Math.floor((hours * MS_PER_HOUR) / Math.max(MS_PER_MINUTE, minutes * MS_PER_MINUTE)),
  );
  const levels: Record<string, number> = {};
  const owed: Record<string, boolean> = {};
  const encounters: Record<string, Encounter> = {};
  for (const e of found.entries) {
    levels[e.id] = bingoLevel(state, e.id, content);
    owed[e.id] = isFirstWin(state, e.id);
    encounters[e.id] = encounterOf(state, e, content);
  }
  const { coverage, hidden } = coverageOf(snap, found.entries, state, content);
  return {
    target,
    seed: opts.seed ?? K.analysis.seed,
    samples,
    minutes,
    minSessions,
    maxSessions,
    loadout: opts.loadout ? [...opts.loadout] : null,
    stateText: serialize(state, 0),
    snap,
    encounters,
    approach: found.op ? approachMs(state, found.op, content) : 0,
    levels,
    owed,
    stock: stockOf(state),
    coverage,
    hidden,
    hints: hintsFor(coverage, state, content),
    once: onceOf(state, found, levels, content),
    fresh: {
      batches: Math.ceil(samples / Math.max(1, size)),
      done: 0,
      n: 0,
      wins: 0,
      allMs: 0,
      winMs: 0,
      wounds: 0,
      items: {},
    },
    sessions: [],
    after: [],
    removed: null,
    maxAfter: Math.max(2, Math.floor(maxSessions * K.analysis.afterShare)),
    share: null,
    blockedReason: null,
    stopped: false,
    simulatedMs: 0,
  };
}

/** Units of every item in the pouch and the bank: what the refill rule has to draw on. */
function stockOf(state: GameState): Record<string, number> {
  const stock: Record<string, number> = { ...state.bank };
  for (const slot of state.pouch.slots) {
    if (slot.id !== '') stock[slot.id] = (stock[slot.id] ?? 0) + slot.n;
  }
  return stock;
}

/** A session being played on its detached copy of the state, a slice of game time at a time. */
interface SessionRun {
  /** Plays up to `ms` of game time more (whole seconds); true once the session is over. */
  step(ms: number): boolean;
  /** Game time played so far, in ms. */
  simulatedMs(): number;
  /** The record of the session; complete once `step` has returned true. */
  record(): SessionRecord;
}

/**
 * Opens one session on a detached copy of the state, with a stream set of its own. The text of a
 * refusal when the target cannot start in it. `advance` is split-invariant, so the session gives
 * the same record however its game time is cut into steps.
 */
function openSession(
  job: AnalysisJob,
  found: Resolved,
  label: string,
  removed: readonly string[],
  content: ContentDb,
  rules: Rules,
): SessionRun | string {
  const clone = deserialize(job.stateText, content, rules);
  clone.rng = createStreams(nextUint32(createStream(job.seed, label)));
  // The forecast for after the supplies: the consumables that ran out are not there.
  for (const item of removed) {
    delete clone.bank[item];
    for (const slot of clone.pouch.slots) {
      if (slot.id === item) {
        slot.id = '';
        slot.n = 0;
      }
    }
  }
  clone.events = [];
  clone.report = {};
  clone.combat = null;
  // The target takes the slot the fight is in, or the first free one that may fight (never a clone's);
  // the other slots go on as they are.
  const running = clone.slots.findIndex((s) => s.action !== null && isCombatKind(s.action.kind));
  const free = clone.slots.findIndex(
    (s, i) => s.action === null && !isCloneSlot(clone, content, i),
  );
  const at = running >= 0 ? running : free >= 0 ? free : 0;
  for (const [i, slot] of clone.slots.entries()) {
    if (i === at || (slot.action !== null && isCombatKind(slot.action.kind))) {
      slot.action = null;
      slot.progress = 0;
      slot.data = null;
    }
  }
  rebalanceShares(clone, content);
  if (job.loadout) {
    const known = new Set(Object.keys(clone.known));
    clone.loadouts.active = job.loadout.filter(
      (id, i, all) => known.has(id) && all.indexOf(id) === i,
    );
    clone.loadouts.auto = false;
    if (clone.loadouts.signature && !clone.loadouts.active.includes(clone.loadouts.signature)) {
      clone.loadouts.signature = null;
    }
  }
  const id = found.op
    ? found.op.id
    : indexOf(content).zones.has(job.target.id)
      ? job.target.id
      : (indexOf(content).zoneByEnemy.get(job.target.id)?.id ?? job.target.id);
  const kind = found.op ? OPERATION_KIND : FIGHT_KIND;
  let refusal = '';
  const start = (): boolean => {
    const result = dispatch(clone, { type: 'action.start', slot: at, kind, id }, content, rules);
    if (!result.ok) refusal = result.reason;
    return result.ok;
  };
  if (!start()) return refusal;
  job.share ??= clone.slots[at]?.share ?? 0;

  const skills = Object.keys(clone.skills) as SkillId[];
  const xp0 = Object.fromEntries(skills.map((k) => [k, clone.skills[k]?.xp ?? 0]));
  const mastery0 = Object.fromEntries(Object.entries(clone.mastery).map(([k, v]) => [k, v.xp]));
  const rec: SessionRecord = {
    wins: 0,
    fights: 0,
    firstDefeatMs: null,
    ryo: 0,
    bounty: 0,
    gained: {},
    xp: {},
    mastery: {},
    used: {},
    wounds: 0,
    stackSum: 0,
    stackMax: 0,
    steps: 0,
  };
  const win = found.op ? 'operationCleared' : 'enemyDefeated';
  const firstKill = new Set<string>();
  const gain = (items: readonly { id: string; n: number }[]): void => {
    for (const it of items) rec.gained[it.id] = (rec.gained[it.id] ?? 0) + it.n;
  };
  const length = job.minutes * MS_PER_MINUTE;
  let t = 0;
  let over = false;
  const tick = (): void => {
    advance(clone, MS_PER_SECOND, content, rules);
    for (const e of clone.events) {
      if (e.type === win) {
        rec.wins++;
        rec.fights++;
      } else if (e.type === 'playerDefeated') {
        rec.fights++;
        rec.firstDefeatMs ??= t + MS_PER_SECOND;
      } else if (e.type === 'loot') {
        rec.ryo += e.ryo;
        // The first-kill bounty is a one-off; the share paid for repeats is a yield.
        if (e.bounty > 0 && job.owed[e.enemy] && !firstKill.has(e.enemy)) {
          firstKill.add(e.enemy);
        } else rec.bounty += e.bounty;
        gain(e.items);
      } else if (e.type === 'operationPaid' && !e.first) {
        rec.ryo += e.ryo;
        gain(e.items);
      }
    }
    clone.events = [];
    rec.steps++;
    rec.stackSum += clone.wounds.stacks;
    rec.stackMax = Math.max(rec.stackMax, clone.wounds.stacks);
    t += MS_PER_SECOND;
    // A defeat (or a finished operation) ends the action; this forecast restarts it at once.
    if (!clone.slots[at]?.action && !start()) over = true;
  };
  const finish = (): void => {
    const r = clone.report[id];
    if (!found.op) rec.fights += r?.timeouts ?? 0;
    rec.wounds = r?.wounds ?? 0;
    rec.used = { ...(r?.items ?? {}) };
    for (const k of skills) {
      const d = (clone.skills[k]?.xp ?? 0) - (xp0[k] ?? 0);
      if (d > 0) rec.xp[k] = d;
    }
    for (const [k, v] of Object.entries(clone.mastery)) {
      const d = v.xp - (mastery0[k] ?? 0);
      if (d > 0) rec.mastery[k] = d;
    }
  };
  let finished = false;
  return {
    step(ms) {
      const until = Math.min(length, t + ms);
      while (!over && t < until) tick();
      if ((over || t >= length) && !finished) {
        finished = true;
        finish();
      }
      return finished;
    },
    simulatedMs: () => t,
    record: () => rec,
  };
}

const rateOf = (r: SessionRecord): number => (r.fights === 0 ? 0 : r.wins / r.fights);

/** The Wilson score interval of `k` successes in `n` trials. */
function wilson(k: number, n: number, z: number): Ci {
  if (n === 0) return { lo: 0, hi: 1, n: 0 };
  const p = k / n;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const c = (p + z2 / (n + n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / ((n + n) * (n + n)))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h), n };
}

/** How many of the sessions collapsed. */
const collapsedIn = (records: readonly SessionRecord[], content: ContentDb): number =>
  records.filter((r) => rateOf(r) < content.balance.K.analysis.verdict.collapseBelow).length;

/**
 * Whether the sessions so far settle the question: the interval of the collapse share is wholly
 * under the stable threshold or wholly over its complement; or the budget is spent.
 */
function decided(
  records: readonly SessionRecord[],
  most: number,
  least: number,
  content: ContentDb,
): boolean {
  const n = records.length;
  if (n >= most) return true;
  if (n < least) return false;
  const A = content.balance.K.analysis;
  const ci = wilson(collapsedIn(records, content), n, A.confidenceZ);
  return ci.hi < A.verdict.stableCollapse || ci.lo > 1 - A.verdict.stableCollapse;
}

/** The consumables the sessions use, with what they cost per hour and how long the stock lasts. */
function suppliesOf(job: AnalysisJob): Supply[] {
  const hours = (job.minutes * job.sessions.length * MS_PER_MINUTE) / MS_PER_HOUR;
  if (hours === 0) return [];
  const used: Record<string, number> = {};
  for (const r of job.sessions) {
    for (const [item, n] of Object.entries(r.used)) used[item] = (used[item] ?? 0) + n;
  }
  return Object.entries(used)
    .filter(([, n]) => n > 0)
    .map(([item, n]) => {
      const perHour = n / hours;
      const stock = job.stock[item] ?? 0;
      return {
        item,
        perHour,
        stock,
        lastsMinutes: (stock / perHour) * (MS_PER_HOUR / MS_PER_MINUTE),
      };
    })
    .sort((a, b) => a.lastsMinutes - b.lastsMinutes || (a.item < b.item ? -1 : 1));
}

/** Runs one unit of work: a batch of the first-fight run, a session, or a session of the after-supplies forecast. Returns false when there is nothing left. */
/**
 * The rules an analysis plays with: a copy whose fight hooks have a disabled set of their own, so a hook
 * that fails here is not switched off for the live game and the game is told nothing. One per job.
 */
const detached = new WeakMap<AnalysisJob, Rules>();
function ownRules(job: AnalysisJob, live: Rules): Rules {
  let own = detached.get(job);
  if (!own) detached.set(job, (own = { ...live, fightHooks: [...live.fightHooks] }));
  return own;
}

function unit(job: AnalysisJob, found: Resolved, content: ContentDb, live: Rules): boolean {
  const rules = ownRules(job, live);
  try {
    return step(job, found, content, rules);
  } finally {
    job.voided = voidCount(rules.fightHooks);
  }
}

/**
 * The game time one step of a session plays, in ms. A unit of work is never longer than this
 * (a step of the first-fight run is one fight, and a fight is a few milliseconds of work), so a slice
 * of the forecast stays near its budget whatever the size of the session.
 */
export const SESSION_STEP_MS = 30 * MS_PER_SECOND;

/** The fights (or runs of an operation) of a first-fight batch one step plays. */
const BATCH_STEP = 1;

/**
 * Work that is under way between two steps: a batch of the first-fight run or a session. It lives next
 * to the job, not in it (the job is plain JSON); a job that was stored and loaded again plays the
 * unfinished one from its start, which gives the same figures.
 */
interface Open {
  batch?: Batch;
  session?: { run: SessionRun; into: 'sessions' | 'after' };
}
const open = new WeakMap<AnalysisJob, Open>();

function step(job: AnalysisJob, found: Resolved, content: ContentDb, rules: Rules): boolean {
  const f = job.fresh;
  const A = content.balance.K.analysis;
  const under = open.get(job) ?? {};
  open.set(job, under);
  if (under.session) return stepSession(job, under.session);
  if (f.done < f.batches) {
    if (!under.batch) {
      const size = figure(A.batch, found.op ? 'operation' : 'zone', 'analysis.batch');
      const n = Math.min(size, job.samples - f.done * size);
      const seed = nextUint32(createStream(job.seed, `fresh.${f.done}`));
      under.batch = found.op
        ? runOperation(job.snap, found.op, job.encounters, job.approach, n, seed, content, rules)
        : runZone(
            job.snap,
            job.encounters[found.entries[0]?.id ?? ''] as Encounter,
            n,
            seed,
            content,
            rules,
          );
    }
    const batch = under.batch;
    const before = batch.simulatedMs();
    const complete = batch.step(BATCH_STEP);
    job.simulatedMs += batch.simulatedMs() - before;
    if (!complete) return true;
    const fig = batch.figures();
    under.batch = undefined;
    f.done++;
    f.n += fig.runs;
    f.wins += fig.wins;
    f.allMs += fig.allMs * fig.runs;
    f.winMs += fig.winMs * fig.wins;
    f.wounds += fig.wounds * fig.runs;
    for (const [id, v] of Object.entries(fig.items))
      f.items[id] = (f.items[id] ?? 0) + v * fig.runs;
    return true;
  }
  if (job.stopped) return false;
  if (!decided(job.sessions, job.maxSessions, job.minSessions, content)) {
    return beginSession(
      job,
      under,
      'sessions',
      `session.${job.sessions.length}`,
      [],
      found,
      content,
      rules,
    );
  }
  // The main forecast is done: what runs out within the planning horizon is taken away for the second one.
  job.removed ??= suppliesOf(job)
    .filter((x) => x.lastsMinutes <= A.horizonMinutes)
    .map((x) => x.item);
  const least = Math.min(job.minSessions, job.maxAfter);
  if (job.removed.length > 0 && !decided(job.after, job.maxAfter, least, content)) {
    return beginSession(
      job,
      under,
      'after',
      `after.${job.after.length}`,
      job.removed,
      found,
      content,
      rules,
    );
  }
  job.stopped = true;
  return false;
}

/** Opens the next session of the forecast and plays its first step. */
function beginSession(
  job: AnalysisJob,
  under: Open,
  into: 'sessions' | 'after',
  label: string,
  removed: readonly string[],
  found: Resolved,
  content: ContentDb,
  rules: Rules,
): boolean {
  const run = openSession(job, found, label, removed, content, rules);
  if (typeof run === 'string') {
    if (into === 'sessions') job.blockedReason = run;
    job.stopped = true;
    return false;
  }
  under.session = { run, into };
  return stepSession(job, under.session);
}

/** Plays one step of the session under way; its record is kept when it is over. */
function stepSession(job: AnalysisJob, session: NonNullable<Open['session']>): boolean {
  const before = session.run.simulatedMs();
  const over = session.run.step(SESSION_STEP_MS);
  job.simulatedMs += session.run.simulatedMs() - before;
  if (over) {
    job[session.into].push(session.run.record());
    open.set(job, {});
  }
  return true;
}

/** The result so far, complete once the job is finished. Gated by the Bingo levels the job started with. */
function assemble(job: AnalysisJob, found: Resolved, content: ContentDb): Analysis {
  const K = content.balance.K;
  const f = job.fresh;
  const winRate = f.n === 0 ? 0 : f.wins / f.n;
  const respawn = found.op ? 0 : secMs(K.respawn);
  const meanMs = f.n === 0 ? 0 : f.allMs / f.n;
  const perHour = meanMs + respawn > 0 ? MS_PER_HOUR / (meanMs + respawn) : 0;
  const itemsPerHour: Record<string, number> = {};
  for (const [id, v] of Object.entries(f.items))
    itemsPerHour[id] = (v / Math.max(1, f.n)) * perHour;
  const fresh: Fresh = {
    samples: f.n,
    winRate,
    winRateCi: wilson(f.wins, f.n, K.analysis.confidenceZ),
    meanWinMs: f.wins === 0 ? 0 : f.winMs / f.wins,
    meanMs,
    winsPerHour: winRate * perHour,
    woundsPerHour: (f.n === 0 ? 0 : f.wounds / f.n) * perHour,
    itemsPerHour,
  };
  const played = job.sessions.length > 0 && job.blockedReason === null;
  return {
    target: job.target,
    fresh,
    coverage: job.coverage,
    hiddenTraits: job.hidden,
    hints: job.hints,
    session: played ? sessionOf(job, found, content) : null,
    sessionBlocked: job.blockedReason,
    once: job.once,
    ...(job.voided ? { voided: job.voided } : {}),
  };
}

/** The verdict of a set of sessions. */
function verdictOf(rates: readonly number[], ci: Ci, content: ContentDb): Verdict {
  const V = content.balance.K.analysis.verdict;
  const median = bandOf(rates).median;
  if (median < V.hopelessBelow) return 'hopeless';
  return median >= V.stableMedian && ci.hi < V.stableCollapse ? 'stable' : 'risky';
}

function sessionOf(job: AnalysisJob, found: Resolved, content: ContentDb): Session {
  const K = content.balance.K.analysis;
  const runs = job.sessions.length;
  const hours = (job.minutes * runs * MS_PER_MINUTE) / MS_PER_HOUR;
  const sum = (pick: (r: SessionRecord) => number): number =>
    job.sessions.reduce((n, r) => n + pick(r), 0);
  const merge = (pick: (r: SessionRecord) => Record<string, number | undefined>) => {
    const out: Record<string, number> = {};
    for (const r of job.sessions) {
      for (const [k, v] of Object.entries(pick(r))) out[k] = (out[k] ?? 0) + (v ?? 0) / hours;
    }
    return out;
  };
  const rates = job.sessions.map(rateOf);
  const perHourEach = MS_PER_HOUR / (job.minutes * MS_PER_MINUTE);
  const collapseCi = wilson(collapsedIn(job.sessions, content), runs, K.confidenceZ);
  const steps = sum((r) => r.steps);
  const levels = found.entries.map((e) => ({ at: job.levels[e.id] ?? 0, e }));
  const reveal = levels.map(({ at }) => revealAt(at));
  const loot = (() => {
    // Loot is shown from the level the book admits it exists; below that one constant says so.
    if (!reveal.every((l) => l.carries && l.drops)) return UNKNOWN;
    const gained = merge((r) => r.gained);
    const rows: Record<string, number | Unknown> = {};
    for (const [item, source] of lootSources(found)) {
      // A scroll part shows with the carried technique (level 2); a trophy by its chance: common at level 2, rare at level 3.
      const shown = levels
        .filter(({ e }) => source.enemies.includes(e.id))
        .every(({ at, e }) =>
          source.part
            ? revealAt(at).carries
            : dropShown(at, e.drops.find((d) => d.item === item)?.chance ?? 1, content),
        );
      if (!shown) continue;
      rows[item] = levels.every(({ at }) => revealAt(at).chances) ? (gained[item] ?? 0) : UNKNOWN;
    }
    for (const part of found.op?.rewards?.repeat.parts ?? []) {
      rows[scrollPartId(part.technique)] = gained[scrollPartId(part.technique)] ?? 0;
    }
    return rows;
  })();
  const supplies = suppliesOf(job);
  const noDefeat = job.sessions.filter((r) => r.firstDefeatMs === null).length;
  const pooled = wilson(
    sum((r) => r.wins),
    sum((r) => r.fights),
    K.confidenceZ,
  );
  let after: AfterSupplies | null = null;
  if (job.after.length > 0 && job.removed) {
    const afterRates = job.after.map(rateOf);
    const ci = wilson(collapsedIn(job.after, content), job.after.length, K.confidenceZ);
    after = {
      removed: job.removed,
      runs: job.after.length,
      winRate: bandOf(afterRates),
      winsPerHour: bandOf(job.after.map((r) => r.wins * perHourEach)),
      collapseShare: ci.n === 0 ? 0 : collapsedIn(job.after, content) / job.after.length,
      collapseCi: ci,
      verdict: verdictOf(afterRates, ci, content),
    };
  }
  return {
    minutes: job.minutes,
    runs,
    share: job.share ?? 0,
    assumesRestart: true,
    supplies,
    horizonMinutes: supplies[0]?.lastsMinutes ?? null,
    winRate: bandOf(rates),
    winRateCi: pooled,
    winsPerHour: bandOf(job.sessions.map((r) => r.wins * perHourEach)),
    collapseShare: collapsedIn(job.sessions, content) / runs,
    collapseCi,
    verdict: verdictOf(rates, collapseCi, content),
    untilDefeat: {
      noDefeatShare: noDefeat / runs,
      noDefeatCi: wilson(noDefeat, runs, K.confidenceZ),
      minutes: bandOf(
        job.sessions.map((r) => (r.firstDefeatMs ?? job.minutes * MS_PER_MINUTE) / MS_PER_MINUTE),
      ),
    },
    ryoPerHour: reveal.every((l) => l.ryo) ? sum((r) => r.ryo) / hours : UNKNOWN,
    bountyPerHour: reveal.every((l) => l.bounty) ? sum((r) => r.bounty) / hours : UNKNOWN,
    loot,
    xpPerHour: merge((r) => r.xp) as Partial<Record<SkillId, number>>,
    masteryPerHour: merge((r) => r.mastery),
    woundStacks: {
      mean: steps === 0 ? 0 : sum((r) => r.stackSum) / steps,
      max: Math.max(0, ...job.sessions.map((r) => r.stackMax)),
    },
    woundsPerHour: sum((r) => r.wounds) / hours,
    itemsPerHour: merge((r) => r.used),
    afterSupplies: after,
  };
}

/** The job's progress: units done of the units expected so far (the sessions may stop early). */
export function analysisProgress(job: AnalysisJob, content: ContentDb): AnalysisProgress {
  const finished = job.fresh.done >= job.fresh.batches && job.stopped;
  const sessionsLeft = finished
    ? 0
    : Math.max(0, job.maxSessions + job.maxAfter - job.sessions.length - job.after.length);
  void content;
  const done = job.fresh.done + job.sessions.length + job.after.length;
  return {
    done,
    total: done + (finished ? 0 : job.fresh.batches - job.fresh.done + sessionsLeft),
    finished,
  };
}

/**
 * Runs `n` units of the job (batches of the first-fight run, then sessions) and returns how far
 * it got and the result so far. It reads no clock; a unit is the same whatever the slice.
 */
export function stepAnalysis(
  job: AnalysisJob,
  n: number,
  content: ContentDb,
  rules: Rules,
): { progress: AnalysisProgress; result: Analysis } {
  const found = resolve(job.target, content);
  if (!found) throw new Error(`analysis target ${job.target.id} is gone`);
  for (let i = 0; i < n && unit(job, found, content, rules); i++);
  // The result is worked out when it is read, so a caller that steps in small slices and reads it at the end pays for it once.
  return {
    progress: analysisProgress(job, content),
    get result(): Analysis {
      return assemble(job, found, content);
    },
  };
}

/**
 * Analyses the target to the end in one go: `startAnalysis` and `stepAnalysis` until finished.
 * Null for a target that does not exist.
 */
export function analyzeFight(
  state: GameState,
  target: AnalysisTarget,
  opts: AnalysisOptions,
  content: ContentDb,
  rules: Rules,
): Analysis | null {
  const job = startAnalysis(state, target, opts, content, rules);
  if (!job) return null;
  for (;;) {
    const { progress, result } = stepAnalysis(job, Number.MAX_SAFE_INTEGER, content, rules);
    if (progress.finished) return result;
  }
}

/** A loadout to compare: the techniques of its slots. */
export type LoadoutChoice = readonly string[];

/**
 * Plays the target with each of two loadouts (same seeds, so the same dice) and returns the
 * differences, second minus first, of the first-fight win rate and of the session figures.
 */
export function compareLoadouts(
  state: GameState,
  target: AnalysisTarget,
  a: LoadoutChoice,
  b: LoadoutChoice,
  opts: Omit<AnalysisOptions, 'loadout'>,
  content: ContentDb,
  rules: Rules,
): LoadoutComparison | null {
  const first = analyzeFight(state, target, { ...opts, loadout: a }, content, rules);
  const second = analyzeFight(state, target, { ...opts, loadout: b }, content, rules);
  if (!first || !second) return null;
  const x = first.session;
  const y = second.session;
  return {
    a: first,
    b: second,
    fresh: {
      winRate: second.fresh.winRate - first.fresh.winRate,
      meanWinMs: second.fresh.meanWinMs - first.fresh.meanWinMs,
    },
    session:
      x && y
        ? {
            winRate: y.winRate.median - x.winRate.median,
            winsPerHour: y.winsPerHour.mean - x.winsPerHour.mean,
            collapseShare: y.collapseShare - x.collapseShare,
            woundStacksMax: y.woundStacks.max - x.woundStacks.max,
          }
        : null,
  };
}
