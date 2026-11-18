import type { ContentDb, Mod, Practice } from '@shinobi/content';
import { skillAction, type ActionKind } from './actions.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { cycleSeconds, cycleXp, masteryLevel } from './formulas.ts';
import { indexOf } from './lookup.ts';
import {
  NO_MODIFIERS,
  bonusOf,
  hasNone,
  type Modifier,
  type ModifierProvider,
} from './modifiers.ts';
import { nextFloat } from './rng.ts';
import type { Rules } from './rules.ts';
import type { GameState, MeditationEntry } from './state.ts';
import { activitySkill, entitySkill, ownsNature } from './vocab.ts';

/** The skill that meditation trains: the one whose activity is `insight` (Meditation). */
export const meditationSkill = (content: ContentDb): string | null =>
  activitySkill(content, 'insight');

export type MeditationKind = 'insight' | 'enlight';

/** Reference to one purchasable modifier of a practice: `insight.0` .. `enlight.2`. */
export type MeditationModRef = `${MeditationKind}.${number}`;

/** The entry of a practice, created empty on first use. */
function entryOf(state: GameState, practice: string): MeditationEntry {
  return (state.meditation[practice] ??= { insight: 0, enlight: 0, bought: {} });
}

/** Parses `insight.1` into its kind and index; null for anything else. */
export function parseModRef(ref: string): { kind: MeditationKind; index: number } | null {
  const m = /^(insight|enlight)\.(\d+)$/.exec(ref);
  if (!m) return null;
  return { kind: m[1] as MeditationKind, index: Number(m[2]) };
}

/** Levels a modifier of this kind can reach. */
export function maxLevels(kind: MeditationKind, content: ContentDb): number {
  const K = content.balance.K.meditation;
  return kind === 'insight' ? K.insightLevels : K.enlightLevels;
}

/** Practice mastery level that opens modifier `index` of this kind. */
export function unlockMastery(kind: MeditationKind, index: number, content: ContentDb): number {
  const K = content.balance.K.meditation;
  return (kind === 'insight' ? K.insightGates : K.enlightGates)[index] ?? Infinity;
}

/** The modifiers of a purchasable modifier, as the content states them. */
function modsOf(practice: Practice, kind: MeditationKind, index: number): readonly Mod[] | null {
  return (kind === 'insight' ? practice.insightMods : practice.enlightMods)[index] ?? null;
}

/**
 * Chance of an Insight and of an Enlightenment per finished cycle: the balance numbers plus the
 * `meditation.insightChance` and `meditation.enlightChance` modifiers.
 */
export function meditationChances(
  state: GameState,
  content: ContentDb,
  rules: Rules,
): { insight: number; enlight: number } {
  const K = content.balance.K.meditation;
  const providers = rules;
  return {
    insight: K.insightChance + bonusOf(providers, state, 'meditation.insightChance', content),
    enlight: K.enlightChance + bonusOf(providers, state, 'meditation.enlightChance', content),
  };
}

/** Meditation: the plain training action, then a roll for an Insight and one for an Enlightenment. */
const meditationBase = skillAction((_state, id, content) => {
  const p = indexOf(content).practices.get(id);
  const skill = p ? entitySkill(content, 'insight', p) : null;
  if (!p || skill === null) return null;
  return {
    skill,
    level: p.level,
    masteryKey: id,
    baseSeconds: cycleSeconds('meditate', p, content),
    xp: cycleXp('meditate', p, content),
    extra: [],
  };
});

export const meditateKind: ActionKind = {
  ...meditationBase,
  complete(state, id, content, rules, slot) {
    meditationBase.complete(state, id, content, rules, slot);
    // Both rolls are always made, so the stream advances the same way whatever they give.
    const chance = meditationChances(state, content, rules);
    const insight = nextFloat(state.rng, 'action') < chance.insight;
    const enlight = nextFloat(state.rng, 'action') < chance.enlight;
    if (!insight && !enlight) return;
    const entry = entryOf(state, id);
    if (insight) {
      entry.insight += 1;
      emit(state, { type: 'meditationGain', practice: id, kind: 'insight' });
    }
    if (enlight) {
      entry.enlight += 1;
      emit(state, { type: 'meditationGain', practice: id, kind: 'enlight' });
    }
  },
};

/**
 * Spends earned Insights or Enlightenments of a practice on one level of one of its modifiers.
 * Level `n` costs `n`; the modifier must be open (practice mastery) and below its level cap.
 */
export function buyMeditationLevel(
  state: GameState,
  practiceId: string,
  mod: string,
  content: ContentDb,
): CommandResult {
  const practice = indexOf(content).practices.get(practiceId);
  if (!practice) return { ok: false, reason: 'error.unknownPractice' };
  const ref = parseModRef(mod);
  if (!ref || !modsOf(practice, ref.kind, ref.index)) {
    return { ok: false, reason: 'error.unknownMeditationMod' };
  }
  if (masteryLevel(state, practiceId, content) < unlockMastery(ref.kind, ref.index, content)) {
    return { ok: false, reason: 'error.masteryTooLow' };
  }
  const have = state.meditation[practiceId]?.bought[mod] ?? 0;
  if (have >= maxLevels(ref.kind, content)) return { ok: false, reason: 'error.maxLevel' };
  const cost = have + 1;
  const entry = state.meditation[practiceId];
  if (!entry || entry[ref.kind] < cost) return { ok: false, reason: 'error.notEnoughInsights' };
  entry[ref.kind] -= cost;
  entry.bought[mod] = have + 1;
  emit(state, { type: 'meditationBought', practice: practiceId, mod, level: have + 1 });
  return { ok: true };
}

/** Why a bought modifier does not work: its chakra nature is not owned. */
export const isNatureLocked = (state: GameState, nature: string | undefined): boolean =>
  nature !== undefined && !ownsNature(state, nature);

/**
 * Bought Meditation modifiers: each level gives total / levels of the modifier's value. A modifier
 * tied to a chakra nature the player does not own gives nothing until the nature is owned.
 */
export const meditationProvider: ModifierProvider = (state, content) => {
  if (hasNone(state.meditation)) return NO_MODIFIERS;
  const out: Modifier[] = [];
  const index = indexOf(content);
  for (const [practiceId, entry] of Object.entries(state.meditation)) {
    const practice = index.practices.get(practiceId);
    if (!practice) continue;
    for (const [ref, levels] of Object.entries(entry.bought)) {
      const parsed = parseModRef(ref);
      const mods = parsed ? modsOf(practice, parsed.kind, parsed.index) : null;
      if (!parsed || !mods || levels < 1) continue;
      const share =
        Math.min(levels, maxLevels(parsed.kind, content)) / maxLevels(parsed.kind, content);
      for (const m of mods) {
        if (isNatureLocked(state, m.nature)) continue;
        out.push({
          key: m.key,
          op: m.op,
          value: m.op === 'add' ? m.value * share : 1 + (m.value - 1) * share,
          group: 'character',
          source: { kind: 'practice', id: practiceId },
        });
      }
    }
  }
  return out;
};

/** Everything a screen needs to show one purchasable modifier of a practice. */
export interface MeditationModInfo {
  practice: string;
  ref: MeditationModRef;
  kind: MeditationKind;
  index: number;
  /** What the modifier changes, at full levels. */
  mods: readonly Mod[];
  levels: number;
  maxLevels: number;
  /** Insights or Enlightenments the next level costs; null at the level cap. */
  nextCost: number | null;
  /** Practice mastery that opens the modifier, and whether it is open. */
  unlockMastery: number;
  unlocked: boolean;
  /** The chakra nature the player lacks, when that keeps the bought levels from working. */
  lockedNature: string | null;
  /** Whether the bought levels work now. */
  active: boolean;
  /** Whether one more level can be bought now. */
  canBuy: boolean;
}

/** The six modifiers of a practice with their state, Insight ones first. */
export function listMeditationMods(
  state: GameState,
  practiceId: string,
  content: ContentDb,
): MeditationModInfo[] {
  const practice = indexOf(content).practices.get(practiceId);
  if (!practice) return [];
  const entry = state.meditation[practiceId];
  const mastery = masteryLevel(state, practiceId, content);
  const out: MeditationModInfo[] = [];
  for (const kind of ['insight', 'enlight'] as const) {
    const list = kind === 'insight' ? practice.insightMods : practice.enlightMods;
    list.forEach((mods, index) => {
      const ref: MeditationModRef = `${kind}.${index}`;
      const levels = entry?.bought[ref] ?? 0;
      const cap = maxLevels(kind, content);
      const gate = unlockMastery(kind, index, content);
      const lockedNature = mods.find((m) => isNatureLocked(state, m.nature))?.nature ?? null;
      const nextCost = levels >= cap ? null : levels + 1;
      const unlocked = mastery >= gate;
      out.push({
        practice: practiceId,
        ref,
        kind,
        index,
        mods,
        levels,
        maxLevels: cap,
        nextCost,
        unlockMastery: gate,
        unlocked,
        lockedNature,
        active: levels > 0 && lockedNature === null,
        canBuy: unlocked && nextCost !== null && (entry?.[kind] ?? 0) >= nextCost,
      });
    });
  }
  return out;
}
