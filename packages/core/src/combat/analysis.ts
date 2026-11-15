import type {
  Boss,
  ContentDb,
  Enemy,
  Item,
  Operation,
  SkillId,
  Technique,
  TraitId,
} from '@shinobi/content';
import { MS_PER_HOUR, rate } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { getMod } from '../mod.ts';
import { bossNature } from '../natures.ts';
import { createStream, nextInt, nextUint32 } from '../rng.ts';
import type { Rules } from '../rules.ts';
import { buyPrice } from '../shop.ts';
import { scrollOf } from '../scrolls.ts';
import type { GameState } from '../state.ts';
import { createFight, fightAdvance, fightTimeMs } from './fight.ts';
import { encounterFor } from './fight-encounter.ts';
import { pouchUse } from './fight-items.ts';
import { simulateFights } from './fight-sim.ts';
import type { FightState } from './fight-types.ts';
import { answersTrait, itemAnswers, planTarget } from './loadout.ts';
import { secMs, type PlayerSnapshot } from './numbers.ts';
import { snapshotPlayer } from './snapshot.ts';
import { WORK_PER_MS } from './units.ts';
import { approachMs, entryOf, fightTarget, opSteps } from './zones.ts';

/** What a battle analysis is asked about: a fight zone, a boss (its id or its zone's), or an operation. */
export interface AnalysisTarget {
  kind: 'zone' | 'boss' | 'operation';
  id: string;
}

export interface AnalysisOptions {
  /** Fights per run of a zone or boss, or runs of an operation; the balance default when absent. */
  samples?: number;
  /** Seed of the simulation; the balance default when absent. It never touches the game's streams. */
  seed?: number;
  /** A loadout to try in place of the player's (ids of techniques the player knows). */
  loadout?: readonly string[];
}

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
      /** Enemies that carry it, for a carrier source. */
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

export interface Analysis {
  target: AnalysisTarget;
  samples: number;
  /** Share of fights (or operation runs) won, 0 to 1. */
  winRate: number;
  /** Mean time of a won fight (or run), ms, and of any fight (or run). */
  meanWinMs: number;
  meanMs: number;
  /** Wins (or clears) per hour of playing the target over and over. */
  winsPerHour: number;
  /** Skill XP per hour, modifiers counted; and mastery XP per hour by technique. */
  xpPerHour: Partial<Record<SkillId, number>>;
  masteryPerHour: Record<string, number>;
  /** Expected ryo per hour (bounty at the repeat share), and expected items per hour (trophies, scroll parts). */
  ryoPerHour: number;
  lootPerHour: Record<string, number>;
  woundsPerHour: number;
  /** Pouch units used per hour, by item id. */
  itemsPerHour: Record<string, number>;
  /** For each trait the player knows, what answers it; the others are only counted. */
  coverage: TraitCoverage[];
  hiddenTraits: number;
  hints: Hint[];
}

/** The difference of two analyses of one target: B minus A. */
export interface LoadoutComparison {
  a: Analysis;
  b: Analysis;
  winRate: number;
  meanWinMs: number;
  winsPerHour: number;
  ryoPerHour: number;
  woundsPerHour: number;
  xpPerHour: Partial<Record<SkillId, number>>;
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

const encounterOf = (state: GameState, entry: Entry, content: ContentDb) =>
  encounterFor(entry, content, [], 'special' in entry ? bossNature(state, entry) : null);

/** What many plays of the target add up to, per play (a fight, or an operation run from the first step). */
interface Figures {
  runs: number;
  wins: number;
  /** Mean time over all plays and over the won ones, ms; the pauses between enemies are in. */
  allMs: number;
  winMs: number;
  wounds: number;
  items: Record<string, number>;
  masteryWork: Record<string, number>;
  /** Enemies defeated per play, by entry id. */
  defeated: Record<string, number>;
}

function addTo(into: Record<string, number>, from: Readonly<Record<string, number>>, n: number) {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value / n;
}

function runZone(
  snap: PlayerSnapshot,
  entry: Entry,
  state: GameState,
  samples: number,
  seed: number,
  content: ContentDb,
  rules: Rules,
): Figures {
  const sum = simulateFights(
    snap,
    encounterOf(state, entry, content),
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
    masteryWork: sum.masteryWork,
    defeated: { [entry.id]: sum.winRate },
  };
}

/** Plays the operation `runs` times from the first step: pools carry over with the partial recovery, the pouch is not refilled, a lost fight ends the run. */
function runOperation(
  snap: PlayerSnapshot,
  op: Operation,
  state: GameState,
  runs: number,
  seed: number,
  content: ContentDb,
  rules: Rules,
): Figures {
  const K = content.balance.K;
  const steps = opSteps(op);
  const rng = createStream(seed, 'analysis.pick');
  const total: Figures = {
    runs,
    wins: 0,
    allMs: 0,
    winMs: 0,
    wounds: 0,
    items: {},
    masteryWork: {},
    defeated: {},
  };
  const respawn = secMs(K.respawn);
  for (let r = 0; r < runs; r++) {
    let pools: { hp?: number; chakra?: number; stamina?: number } = {};
    let pouch = (snap.pouch ?? []).map((s) => ({ ...s }));
    let wounds = snap.wounds ?? 0;
    let ms = 0;
    let won = true;
    for (const [i, step] of steps.entries()) {
      if (step.t === 'approach') {
        ms += approachMs(state, op, content);
        continue;
      }
      const id = step.t === 'fight' ? step.enemy : step.pool[nextIntFrom(rng, step.pool.length)];
      const entry = id === undefined ? undefined : entryOf(content, id);
      if (!entry) {
        won = false;
        break;
      }
      const seedOf = nextUint32(createStream(seed, `analysis.${r}.${i}`));
      const fight: FightState = createFight(
        { ...snap, ...pools, pouch, wounds },
        encounterOf(state, entry, content),
        seedOf,
        content,
        rules,
      );
      fight.log = null;
      fightAdvance(fight, fight.cap + 1, content, rules);
      ms += fightTimeMs(fight);
      addTo(total.masteryWork, fight.tally.masteryWork, runs);
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
      total.defeated[entry.id] = (total.defeated[entry.id] ?? 0) + 1 / runs;
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

/** Expected loot of one win over an entry: ryo (bounty at the repeat share) and items. */
function lootOf(entry: Entry): { ryo: number; items: Record<string, number> } {
  const items: Record<string, number> = {};
  for (const d of entry.drops) items[d.item] = (items[d.item] ?? 0) + d.chance;
  const part = entry.scrollPart;
  if (part)
    items[part.item] = (items[part.item] ?? 0) + ('count' in part ? part.count : part.chance);
  const bounty = entry.bounty ? entry.bounty.first * entry.bounty.repeatShare : 0;
  return { ryo: (entry.ryo[0] + entry.ryo[1]) / 2 + bounty, items };
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

function techniqueOption(tech: Technique, content: ContentDb): HintOption | null {
  const index = indexOf(content);
  const carriers = [...content.enemies, ...content.bosses]
    .filter((e) => e.carries === tech.id)
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
  if (def) return { ...base, source: 'scroll', ryo: null, carriers: [] };
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
      const o = techniqueOption(tech, content);
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

// ---------- the analysis ----------

/**
 * A quick simulation of the target with the player as they are now: the loadout, the pouch, the
 * Wounds, the modifiers and what the Bingo book lets the tactics know. It runs on a snapshot with
 * a seed of its own and never reads or moves the game's random streams or any part of the state.
 * Returns null for a target that does not exist.
 */
export function analyzeFight(
  state: GameState,
  target: AnalysisTarget,
  opts: AnalysisOptions,
  content: ContentDb,
  rules: Rules,
): Analysis | null {
  const K = content.balance.K;
  const found = resolve(target, content);
  if (!found || found.entries.length === 0) return null;
  const snap = snapshotFor(state, found.entries, opts, content, rules);
  const seed = opts.seed ?? K.analysis.seed;
  const fig = found.op
    ? runOperation(
        snap,
        found.op,
        state,
        opts.samples ?? K.analysis.opSamples,
        seed,
        content,
        rules,
      )
    : runZone(
        snap,
        found.entries[0] as Entry,
        state,
        opts.samples ?? K.analysis.samples,
        seed,
        content,
        rules,
      );
  const samples = fig.runs;
  // One cycle: a play of the target and the pause before the next (zones; an operation run holds its own).
  const cycleMs = fig.allMs + (found.op ? 0 : secMs(K.respawn));
  const perHour = cycleMs > 0 ? MS_PER_HOUR / cycleMs : 0;
  const winRate = samples === 0 ? 0 : fig.wins / samples;

  // Combat XP follows slot time: every tick pays the style skill, Vitality and Evasion by the level of the enemy.
  let ryo = 0;
  const loot: Record<string, number> = {};
  let defeatedTotal = 0;
  let levelWeight = 0;
  for (const [id, n] of Object.entries(fig.defeated)) {
    const entry = entryOf(content, id);
    if (!entry) continue;
    const l = lootOf(entry);
    ryo += l.ryo * n * perHour;
    for (const [item, chance] of Object.entries(l.items)) {
      loot[item] = (loot[item] ?? 0) + chance * n * perHour;
    }
    defeatedTotal += n;
    levelWeight += entry.cl * n;
  }
  const level = defeatedTotal > 0 ? levelWeight / defeatedTotal : (found.entries[0]?.cl ?? 1);
  if (found.op?.rewards) {
    const pay = found.op.rewards.repeat;
    ryo += pay.ryo * winRate * perHour;
    for (const part of pay.parts) {
      const id = content.items.find((i) => i.part?.technique === part.technique)?.id;
      if (id) loot[id] = (loot[id] ?? 0) + K.partDrop[part.chance] * winRate * perHour;
    }
  }
  const mod = (key: string): number => getMod(state, key, content, rules).total;
  const xpPerHour: Partial<Record<SkillId, number>> = {};
  const perSkill = (skill: SkillId, share: number): void => {
    if (!(share > 0)) return;
    xpPerHour[skill] =
      (xpPerHour[skill] ?? 0) +
      share * rate(level, content) * mod('xp.all') * mod(`xp.skill.${skill}`);
  };
  perSkill('vit', K.combatXp.vit);
  perSkill('eva', K.combatXp.eva);
  const index = indexOf(content);
  const cycleWork = Math.max(1, cycleMs * WORK_PER_MS);
  const masteryPerHour: Record<string, number> = {};
  let styled = 0;
  for (const [id, work] of Object.entries(fig.masteryWork)) {
    const tech = index.techniques.get(id);
    if (!tech) continue;
    const share = Math.min(1, work / cycleWork);
    const bonus = snap.signature === id ? 1 + K.signature.xpBonus : 1;
    masteryPerHour[id] = bonus * K.masteryPerHour * share;
    perSkill(tech.skill, K.combatXp.style * share);
    styled += share;
  }
  perSkill('tai', K.combatXp.style * Math.max(0, 1 - styled));

  const itemsPerHour: Record<string, number> = {};
  for (const [id, n] of Object.entries(fig.items)) itemsPerHour[id] = n * perHour;
  const { coverage, hidden } = coverageOf(snap, found.entries, state, content);
  return {
    target,
    samples,
    winRate,
    meanWinMs: fig.winMs,
    meanMs: fig.allMs,
    winsPerHour: winRate * perHour,
    xpPerHour,
    masteryPerHour,
    ryoPerHour: ryo,
    lootPerHour: loot,
    woundsPerHour: fig.wounds * perHour,
    itemsPerHour,
    coverage,
    hiddenTraits: hidden,
    hints: hintsFor(coverage, state, content),
  };
}

/** A loadout to compare: the techniques of its slots. */
export type LoadoutChoice = readonly string[];

/**
 * Plays the target with each of two loadouts (same seed, so the same dice) and returns the
 * differences, second minus first, of the main figures.
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
  const xp: Partial<Record<SkillId, number>> = {};
  const skills = new Set([
    ...Object.keys(first.xpPerHour),
    ...Object.keys(second.xpPerHour),
  ]) as Set<SkillId>;
  for (const s of skills) xp[s] = (second.xpPerHour[s] ?? 0) - (first.xpPerHour[s] ?? 0);
  return {
    a: first,
    b: second,
    winRate: second.winRate - first.winRate,
    meanWinMs: second.meanWinMs - first.meanWinMs,
    winsPerHour: second.winsPerHour - first.winsPerHour,
    ryoPerHour: second.ryoPerHour - first.ryoPerHour,
    woundsPerHour: second.woundsPerHour - first.woundsPerHour,
    xpPerHour: xp,
  };
}
