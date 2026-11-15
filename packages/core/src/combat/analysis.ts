import {
  scrollPartId,
  type Boss,
  type ContentDb,
  type Enemy,
  type Item,
  type Operation,
  type SkillId,
  type Technique,
  type TraitId,
} from '@shinobi/content';
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
import { bingoLevel, revealAt } from './bingo.ts';
import { createFight, fightAdvance, fightTimeMs } from './fight.ts';
import { encounterFor } from './fight-encounter.ts';
import { pouchUse } from './fight-items.ts';
import { simulateFights } from './fight-sim.ts';
import type { Encounter, FightState } from './fight-types.ts';
import { answersTrait, itemAnswers, planTarget } from './loadout.ts';
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
  trait: TraitId;
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
  trait: TraitId;
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

/**
 * The first fight of a fresh character against the target: one fight (or one operation run) with
 * the Wounds, pouch and loadout as they are now. These are not yields: the per-hour figures here
 * assume nothing changes from one fight to the next, which Wounds and the pouch make untrue.
 */
export interface Fresh {
  samples: number;
  winRate: number;
  /** Standard error of `winRate`, so that the UI can round it honestly. */
  winRateSe: number;
  /** Mean time of a won fight (or run), ms, and of any fight (or run). */
  meanWinMs: number;
  meanMs: number;
  /** What playing fresh fights back to back would give per hour. */
  winsPerHour: number;
  woundsPerHour: number;
  itemsPerHour: Record<string, number>;
}

/** What the sessions say about the target as a whole. */
export type Verdict = 'stable' | 'risky' | 'hopeless';

/**
 * The target played as sessions of the real game loop on detached copies of the state: the fight
 * action started in the slot it would take, the other slots as they are, Wounds, the pouch, the
 * regeneration and the pauses all as in play; the sessions are independent. Everything here is
 * the distribution over the sessions. Figures that assume the player restarts at once after a
 * defeat say so in `assumesRestart`; what happens when the player does not is in `untilDefeat`.
 * Loot figures follow the Bingo knowledge level through \`revealAt\`.
 */
export interface Session {
  minutes: number;
  /** Sessions played. */
  runs: number;
  /** The share of full speed the fight slot had (thousandths), with the other slots as they are now. */
  share: number;
  assumesRestart: true;
  /** Wins over wins, defeats and timeouts of a session (for an operation: clears over clears and defeats). */
  winRate: Band;
  winsPerHour: Band;
  /** Share of sessions whose win rate fell under the collapse threshold, and its standard error. */
  collapseShare: number;
  collapseShareSe: number;
  verdict: Verdict;
  /** Without an immediate restart: the sessions that never saw a defeat, and the minutes to the first one (a session without one counts as its length). */
  untilDefeat: { noDefeatShare: number; minutes: Band };
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
}

/** Rewards that can be had once: the first-kill bounty and the first clear of an operation. */
export interface Once {
  bounty: number | Unknown;
  clear: { ryo: number; rep: number; items: Record<string, number> } | null;
}

export interface Analysis {
  target: AnalysisTarget;
  fresh: Fresh;
  /** For each trait the player knows, what answers it; the others are only counted. */
  coverage: TraitCoverage[];
  hiddenTraits: number;
  hints: Hint[];
  /** The session forecast; null when the target cannot be started from this state. */
  session: Session | null;
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

function runZone(
  snap: PlayerSnapshot,
  encounter: Encounter,
  samples: number,
  seed: number,
  content: ContentDb,
  rules: Rules,
): Figures {
  const sum = simulateFights(
    snap,
    encounter,
    samples,
    seed,
    content,
    rules,
    content.balance.K.zoneHpRegen,
  );
  return {
    runs: sum.fights,
    wins: sum.wins,
    allMs: sum.timeAllMs,
    winMs: sum.timeMs.mean,
    wounds: sum.wounds,
    items: sum.items,
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
): Figures {
  const K = content.balance.K;
  const steps = opSteps(op);
  const rng = createStream(seed, 'analysis.pick');
  const total: Figures = { runs, wins: 0, allMs: 0, winMs: 0, wounds: 0, items: {} };
  const respawn = secMs(K.respawn);
  for (let r = 0; r < runs; r++) {
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
    total.allMs += ms / runs;
    if (won) {
      total.wins++;
      total.winMs += ms;
    }
  }
  total.winMs = total.wins === 0 ? 0 : total.winMs / total.wins;
  return total;
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
    const { traits } = planTarget(entry, known, first);
    hidden += entry.traits.filter((t) => !known.includes(t)).length;
    for (const trait of traits) {
      const by: TraitCoverage['by'] = [
        ...carried
          .filter((t) => answersTrait(t, trait))
          .map((t) => ({ kind: 'technique' as const, id: t.id })),
        ...packed
          .filter((i) => itemAnswers(i, trait))
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
      if (tech.rank === null || state.known[tech.id] || !answersTrait(tech, c.trait)) continue;
      const o = techniqueOption(tech, state, content);
      if (o) options.push(o);
    }
    for (const item of content.items) {
      if (!itemAnswers(item, c.trait) || pouchUse(item) === 'sleep') continue;
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
  /** Bingo levels of the target's entries and their wins, as they were at the start. */
  levels: Record<string, number>;
  wins: Record<string, number>;
  coverage: TraitCoverage[];
  hidden: number;
  hints: Hint[];
  once: Once;
  fresh: FreshTotals;
  sessions: SessionRecord[];
  /** The share the fight slot had at the first session; null before it. */
  share: number | null;
  /** True when the target could not be started in a session. */
  blocked: boolean;
  stopped: boolean;
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
    if (e.bounty && (state.bingo[e.id]?.wins ?? 0) === 0) bounty += e.bounty.first;
  }
  const rewards = found.op?.rewards;
  const clear =
    found.op && rewards && state.flags[found.op.clearFlag] === undefined
      ? {
          ryo: rewards.first.ryo,
          rep: rewards.first.rep,
          items: Object.fromEntries(
            rewards.first.parts.map((p) => [
              scrollPartId(p.technique),
              content.balance.K.partDrop[p.chance],
            ]),
          ),
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
  const size = found.op ? K.analysis.batch.operation : K.analysis.batch.zone;
  const minutes = opts.sessionMinutes ?? K.analysis.sessionMinutes;
  const minSessions = opts.minSessions ?? K.analysis.minSessions;
  const hours = K.analysis.sessionHours[target.kind];
  const maxSessions = Math.max(
    minSessions,
    opts.maxSessions ??
      Math.floor((hours * MS_PER_HOUR) / Math.max(MS_PER_MINUTE, minutes * MS_PER_MINUTE)),
  );
  const levels: Record<string, number> = {};
  const wins: Record<string, number> = {};
  const encounters: Record<string, Encounter> = {};
  for (const e of found.entries) {
    levels[e.id] = bingoLevel(state, e.id, content);
    wins[e.id] = state.bingo[e.id]?.wins ?? 0;
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
    wins,
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
    share: null,
    blocked: false,
    stopped: false,
  };
}

/** Plays one session on a detached copy of the state, with a stream set of its own. */
function playSession(
  job: AnalysisJob,
  found: Resolved,
  index: number,
  content: ContentDb,
  rules: Rules,
): SessionRecord | null {
  const clone = deserialize(job.stateText, content, rules);
  clone.rng = createStreams(nextUint32(createStream(job.seed, `session.${index}`)));
  clone.events = [];
  clone.report = {};
  clone.combat = null;
  // The target takes the slot the fight is in, or the first free one; the other slots go on as they are.
  const running = clone.slots.findIndex((s) => s.action !== null && isCombatKind(s.action.kind));
  const free = clone.slots.findIndex((s) => s.action === null);
  const at = running >= 0 ? running : free >= 0 ? free : 0;
  for (const [i, slot] of clone.slots.entries()) {
    if (i === at || (slot.action !== null && isCombatKind(slot.action.kind))) {
      slot.action = null;
      slot.progress = 0;
      slot.data = null;
    }
  }
  rebalanceShares(clone);
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
  const start = (): boolean =>
    dispatch(clone, { type: 'action.start', slot: at, kind, id }, content, rules).ok;
  if (!start()) return null;
  job.share ??= clone.slots[at]?.share ?? 0;

  const skills = Object.keys(clone.skills) as SkillId[];
  const xp0 = Object.fromEntries(skills.map((k) => [k, clone.skills[k].xp]));
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
  for (let t = 0; t < job.minutes * MS_PER_MINUTE; t += MS_PER_SECOND) {
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
        if (e.bounty > 0 && (job.wins[e.enemy] ?? 0) === 0 && !firstKill.has(e.enemy)) {
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
    // A defeat (or a finished operation) ends the action; this forecast restarts it at once.
    if (!clone.slots[at]?.action && !start()) break;
  }
  const r = clone.report[id];
  if (!found.op) rec.fights += r?.timeouts ?? 0;
  rec.wounds = r?.wounds ?? 0;
  rec.used = { ...(r?.items ?? {}) };
  for (const k of skills) {
    const d = clone.skills[k].xp - (xp0[k] ?? 0);
    if (d > 0) rec.xp[k] = d;
  }
  for (const [k, v] of Object.entries(clone.mastery)) {
    const d = v.xp - (mastery0[k] ?? 0);
    if (d > 0) rec.mastery[k] = d;
  }
  return rec;
}

const rateOf = (r: SessionRecord): number => (r.fights === 0 ? 0 : r.wins / r.fights);

/** Whether the sessions so far are enough. */
function enough(job: AnalysisJob, content: ContentDb): boolean {
  const K = content.balance.K.analysis;
  const n = job.sessions.length;
  if (job.blocked || n >= job.maxSessions) return true;
  if (n < job.minSessions) return false;
  // A target that is surely won or surely lost needs the sessions to agree; a marginal one gets them all.
  const fresh = job.fresh.n === 0 ? MEDIAN : job.fresh.wins / job.fresh.n;
  if (fresh > K.stopFresh && fresh < 1 - K.stopFresh) return false;
  const rates = job.sessions.map(rateOf);
  return Math.max(...rates) - Math.min(...rates) <= K.agree;
}

/** Runs one unit of work: a batch of the first-fight run, or one session. Returns false when there is nothing left. */
function unit(job: AnalysisJob, found: Resolved, content: ContentDb, rules: Rules): boolean {
  const f = job.fresh;
  if (f.done < f.batches) {
    const K = content.balance.K.analysis;
    const size = found.op ? K.batch.operation : K.batch.zone;
    const n = Math.min(size, job.samples - f.done * size);
    const seed = nextUint32(createStream(job.seed, `fresh.${f.done}`));
    const fig = found.op
      ? runOperation(job.snap, found.op, job.encounters, job.approach, n, seed, content, rules)
      : runZone(
          job.snap,
          job.encounters[found.entries[0]?.id ?? ''] as Encounter,
          n,
          seed,
          content,
          rules,
        );
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
  if (enough(job, content)) {
    job.stopped = true;
    return false;
  }
  const rec = playSession(job, found, job.sessions.length, content, rules);
  if (!rec) {
    job.blocked = true;
    job.stopped = true;
    return false;
  }
  job.sessions.push(rec);
  if (enough(job, content)) job.stopped = true;
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
    winRateSe: f.n === 0 ? 0 : Math.sqrt((winRate * (1 - winRate)) / f.n),
    meanWinMs: f.wins === 0 ? 0 : f.winMs / f.wins,
    meanMs,
    winsPerHour: winRate * perHour,
    woundsPerHour: (f.n === 0 ? 0 : f.wounds / f.n) * perHour,
    itemsPerHour,
  };
  return {
    target: job.target,
    fresh,
    coverage: job.coverage,
    hiddenTraits: job.hidden,
    hints: job.hints,
    session: job.sessions.length === 0 || job.blocked ? null : sessionOf(job, found, content),
    once: job.once,
  };
}

function sessionOf(job: AnalysisJob, found: Resolved, content: ContentDb): Session {
  const V = content.balance.K.analysis.verdict;
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
  const winRate = bandOf(rates);
  const perHourEach = MS_PER_HOUR / (job.minutes * MS_PER_MINUTE);
  const collapsed = rates.filter((r) => r < V.collapseBelow).length / runs;
  const steps = sum((r) => r.steps);
  const levels = found.entries.map((e) => revealAt(job.levels[e.id] ?? 0));
  const loot = (() => {
    // Loot is shown from the level the book admits it exists; below that one constant says so.
    if (!levels.every((l) => l.carries && l.drops)) return UNKNOWN;
    const gained = merge((r) => r.gained);
    const rows: Record<string, number | Unknown> = {};
    const exact = levels.every((l) => l.chances);
    for (const item of lootSources(found).keys())
      rows[item] = exact ? (gained[item] ?? 0) : UNKNOWN;
    for (const part of found.op?.rewards?.repeat.parts ?? []) {
      rows[scrollPartId(part.technique)] = gained[scrollPartId(part.technique)] ?? 0;
    }
    return rows;
  })();
  const ryoShown = levels.every((l) => l.ryo);
  const bountyShown = levels.every((l) => l.bounty);
  const verdict: Verdict =
    winRate.median < V.hopelessBelow
      ? 'hopeless'
      : winRate.median >= V.stableMedian && collapsed <= V.stableCollapse
        ? 'stable'
        : 'risky';
  return {
    minutes: job.minutes,
    runs,
    share: job.share ?? 0,
    assumesRestart: true,
    winRate,
    winsPerHour: bandOf(job.sessions.map((r) => r.wins * perHourEach)),
    collapseShare: collapsed,
    collapseShareSe: Math.sqrt((collapsed * (1 - collapsed)) / runs),
    verdict,
    untilDefeat: {
      noDefeatShare: job.sessions.filter((r) => r.firstDefeatMs === null).length / runs,
      minutes: bandOf(
        job.sessions.map((r) => (r.firstDefeatMs ?? job.minutes * MS_PER_MINUTE) / MS_PER_MINUTE),
      ),
    },
    ryoPerHour: ryoShown ? sum((r) => r.ryo) / hours : UNKNOWN,
    bountyPerHour: bountyShown ? sum((r) => r.bounty) / hours : UNKNOWN,
    loot,
    xpPerHour: merge((r) => r.xp) as Partial<Record<SkillId, number>>,
    masteryPerHour: merge((r) => r.mastery),
    woundStacks: {
      mean: steps === 0 ? 0 : sum((r) => r.stackSum) / steps,
      max: Math.max(0, ...job.sessions.map((r) => r.stackMax)),
    },
    woundsPerHour: sum((r) => r.wounds) / hours,
    itemsPerHour: merge((r) => r.used),
  };
}

/** The job's progress: units done of the units expected so far (the sessions may stop early). */
export function analysisProgress(job: AnalysisJob, content: ContentDb): AnalysisProgress {
  const finished = job.fresh.done >= job.fresh.batches && job.stopped;
  const sessionsLeft = finished
    ? 0
    : Math.max(0, (enoughNow(job, content) ? 0 : job.maxSessions) - job.sessions.length);
  const done = job.fresh.done + job.sessions.length;
  return {
    done,
    total: done + (finished ? 0 : job.fresh.batches - job.fresh.done + sessionsLeft),
    finished,
  };
}

const enoughNow = (job: AnalysisJob, content: ContentDb): boolean =>
  job.fresh.done >= job.fresh.batches && enough(job, content);

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
  return { progress: analysisProgress(job, content), result: assemble(job, found, content) };
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
