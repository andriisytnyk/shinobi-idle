import type { Boss, ContentDb, Enemy } from '@shinobi/content';
import { hasCurrency, removeCurrency } from '../bank.ts';
import type { CommandResult } from '../engine.ts';
import { emit } from '../events.ts';
import { indexOf } from '../lookup.ts';
import type { GameState } from '../state.ts';
import { entryOf, zoneExplored } from './zones.ts';

/**
 * The Bingo book: what the player has met, beaten and lost to, per enemy or boss id. The level of
 * knowledge is computed from it (and from the levels bought with Intel); it is not stored.
 */
export interface BingoEntry {
  /** Encounters begun with the entry. */
  seen: number;
  wins: number;
  losses: number;
  /** Fights that ran to the time cap. */
  timeouts: number;
  /** The highest level bought with Intel; the level read from the fights can only be higher. */
  bought: number;
  /** Ryo of bounty paid for this entry so far. */
  bounty: number;
}

/** Levels of knowledge: unknown, seen, defeated, studied. */
export const BINGO_MAX = 3;
/** The level Intel cannot buy: it is earned by a first win (or, for a boss, a first fight). */
const BOUGHT_GAP = 1;

/**
 * What a knowledge level lets the player see of an entry's loot and traits. The Bingo view and
 * the battle analysis both read it, so neither can show what the other hides.
 */
export interface Reveal {
  /** Traits that show on sight (level 1) and the hidden ones and the mechanic (level 2). */
  traits: boolean;
  hiddenTraits: boolean;
  /** The technique it carries (so the part it drops) and the ryo it pays (level 2). */
  carries: boolean;
  ryo: boolean;
  /** The trophies it drops, exact chances and the bounty (level 3). */
  drops: boolean;
  chances: boolean;
  bounty: boolean;
}

export const revealAt = (level: number): Reveal => ({
  traits: level >= 1,
  hiddenTraits: level >= 2,
  carries: level >= 2,
  ryo: level >= 2,
  drops: level >= 3,
  chances: level >= 3,
  bounty: level >= 3,
});

export const blankBingo = (): BingoEntry => ({
  seen: 0,
  wins: 0,
  losses: 0,
  timeouts: 0,
  bought: 0,
  bounty: 0,
});

const isBoss = (entry: Enemy | Boss): entry is Boss => 'special' in entry;

/** Wins that study an entry completely. */
export function studiedWins(entry: Enemy | Boss, content: ContentDb): number {
  const wins = content.balance.K.bingo.studiedWins;
  return isBoss(entry) ? wins.boss : wins.enemy;
}

/** The level of knowledge the fights alone give. */
function levelFromFights(entry: Enemy | Boss, b: BingoEntry, content: ContentDb): number {
  if (b.wins >= studiedWins(entry, content)) return 3;
  // A boss teaches its mechanic with the first fight, whatever came of it; an enemy with the first win.
  const fought = isBoss(entry) ? b.wins + b.losses + b.timeouts : b.wins;
  if (fought >= 1) return 2;
  return b.seen >= 1 ? 1 : 0;
}

/** The knowledge level (0 unknown, 1 seen, 2 defeated, 3 studied) of an enemy or boss id. */
export function bingoLevel(state: GameState, id: string, content: ContentDb): number {
  const entry = entryOf(content, id);
  if (!entry) return 0;
  const b = state.bingo[id];
  if (!b) return 0;
  return Math.max(b.bought, levelFromFights(entry, b, content));
}

function entryFor(state: GameState, id: string): BingoEntry {
  return (state.bingo[id] ??= blankBingo());
}

function announce(state: GameState, id: string, before: number, content: ContentDb): void {
  const after = bingoLevel(state, id, content);
  if (after > before) emit(state, { type: 'bingoLevel', enemy: id, level: after });
}

/** An encounter with the entry begins: it is seen from now on. */
export function noteSighting(state: GameState, id: string, content: ContentDb): void {
  const before = bingoLevel(state, id, content);
  entryFor(state, id).seen++;
  announce(state, id, before, content);
}

/** How a fight with the entry ended, for the book. */
export function noteFight(
  state: GameState,
  id: string,
  result: 'win' | 'loss' | 'timeout',
  content: ContentDb,
): void {
  const before = bingoLevel(state, id, content);
  const b = entryFor(state, id);
  if (result === 'win') b.wins++;
  else if (result === 'loss') b.losses++;
  else b.timeouts++;
  announce(state, id, before, content);
}

/** Notes bounty ryo paid for an entry. */
export function noteBounty(state: GameState, id: string, ryo: number): void {
  if (ryo > 0) entryFor(state, id).bounty += ryo;
}

/** Whether the entry is a first kill (no win yet recorded). */
export const isFirstWin = (state: GameState, id: string): boolean =>
  (state.bingo[id]?.wins ?? 0) === 0;

/**
 * What the knowledge level lets the player's tactics use: nothing at level 0, the traits that
 * show on sight at level 1, every trait and the mechanic (`special`) from level 2.
 */
export function knowledgeOf(
  state: GameState,
  content: ContentDb,
  entries: readonly string[],
): Record<string, string[]> {
  const visible: readonly string[] = content.ai.visibleTraits;
  const out: Record<string, string[]> = {};
  for (const id of entries) {
    const entry = entryOf(content, id);
    if (!entry) continue;
    const level = bingoLevel(state, id, content);
    if (level >= 2) out[id] = [...entry.traits, 'special'];
    else if (level === 1) out[id] = entry.traits.filter((t) => visible.includes(t));
    else out[id] = [];
  }
  return out;
}

/** Intel one level of knowledge costs. */
export const studyCost = (content: ContentDb): number => content.balance.K.intel.bingoLevel;

/**
 * Whether level 1 may be bought for an entry the player has not met: only when the cell of its
 * zone has been explored. An entry no zone holds (a mission enemy) is not gated by a cell.
 */
function canScout(state: GameState, id: string, content: ContentDb): boolean {
  const zone = indexOf(content).zoneByEnemy.get(id);
  return zone ? zoneExplored(state, zone.id, content) : true;
}

/** Spends Intel to raise the level of an entry by one, up to the studied level. */
export function studyEnemy(state: GameState, id: string, content: ContentDb): CommandResult {
  const entry = typeof id === 'string' ? entryOf(content, id) : undefined;
  if (!entry) return { ok: false, reason: 'error.unknownEnemy' };
  const level = bingoLevel(state, id, content);
  if (level >= BINGO_MAX) return { ok: false, reason: 'error.bingoMax' };
  // Intel gives the first sight and the last level; the level between them is earned by a fight.
  if (level === BOUGHT_GAP) return { ok: false, reason: 'error.bingoNeedsFight' };
  if (level === 0 && !canScout(state, id, content)) {
    return { ok: false, reason: 'error.notDiscovered' };
  }
  const cost = studyCost(content);
  if (!hasCurrency(state, 'intel', cost) || !removeCurrency(state, 'intel', cost)) {
    return { ok: false, reason: 'error.notEnoughIntel' };
  }
  const b = entryFor(state, id);
  b.bought = level + 1;
  announce(state, id, level, content);
  return { ok: true };
}

/** What the book shows of one entry at its level. */
export interface BingoView {
  id: string;
  level: number;
  seen: number;
  wins: number;
  losses: number;
  /** Wins still needed for the studied level; 0 once there. */
  winsToStudied: number;
  /** Intel the next level costs, and whether the player could buy it now. */
  studyCost: number;
  canStudy: boolean;
  /** Level 1 and up: nature and rank-level; traits that show on sight. */
  traits: string[];
  /** Level 2 and up: every trait, the mechanic and the technique the entry carries. */
  hiddenTraits: string[] | null;
  carries: string | null;
  /** Level 3: exact drop chances and the first-kill bounty; null before. */
  drops: { item: string; chance: number }[] | null;
  bounty: { first: number; repeatShare: number; paid: number } | null;
}

/** The book page of an entry; null for an id that is neither enemy nor boss. */
export function bingoView(state: GameState, id: string, content: ContentDb): BingoView | null {
  const entry = entryOf(content, id);
  if (!entry) return null;
  const level = bingoLevel(state, id, content);
  const b = state.bingo[id] ?? blankBingo();
  const visible: readonly string[] = content.ai.visibleTraits;
  const cost = studyCost(content);
  const reveal = revealAt(level);
  return {
    id,
    level,
    seen: b.seen,
    wins: b.wins,
    losses: b.losses,
    winsToStudied: Math.max(0, studiedWins(entry, content) - b.wins),
    studyCost: cost,
    canStudy:
      level < BINGO_MAX &&
      level !== BOUGHT_GAP &&
      state.currencies.intel >= cost &&
      (level > 0 || canScout(state, id, content)),
    traits: reveal.traits ? entry.traits.filter((t) => visible.includes(t)) : [],
    hiddenTraits: reveal.hiddenTraits ? entry.traits.filter((t) => !visible.includes(t)) : null,
    carries: reveal.carries ? entry.carries : null,
    drops: reveal.chances ? entry.drops.map((d) => ({ ...d })) : null,
    bounty: reveal.bounty && entry.bounty ? { ...entry.bounty, paid: b.bounty } : null,
  };
}
