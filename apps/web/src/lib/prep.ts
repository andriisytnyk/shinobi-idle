import type { ContentDb, Technique } from '@shinobi/content';
import {
  bingoLevel,
  cloneRoleOf,
  effectiveLoadout,
  entryOf,
  fightTarget,
  isPassive,
  knowledgeTerm,
  loadoutLimits,
  opSteps,
  partsAgainst,
  planningSnapshot,
  playerEvasionParts,
  prepareFor,
  pouchLayout,
  pouchKind,
  itemFitsKind,
  pouchUse,
  revealAt,
  targetOf,
  wheelFactor,
  type Analysis,
  type EvasionPart,
  type GameState,
  type Reveal,
  type Rules,
  type Verdict,
} from '@shinobi/core';
import { rankIndex } from '@shinobi/core';

/*
 * The preparation for a fight, as the screen reads it: what the target is, how well the player
 * knows it (and so what may be shown of the forecast), the hand and the suggested hand, the
 * defence, and the reasons behind a verdict. Pure functions of the state and the content; no text.
 */

/** What a preparation is for: a fight zone (a boss has one too) or an operation. */
export interface PrepTarget {
  kind: 'zone' | 'operation';
  id: string;
}

/** The enemy and boss entries a target puts in front of the player. */
export function entriesOf(target: PrepTarget, content: ContentDb): string[] {
  if (target.kind === 'zone') {
    const found = fightTarget(content, target.id);
    return found ? [found.enemy.id] : [];
  }
  const op = content.operations.find((o) => o.id === target.id);
  if (!op) return [];
  const ids = new Set<string>();
  for (const step of opSteps(op)) {
    if (step.t === 'fight') ids.add(step.enemy);
    else if (step.t === 'draw') for (const id of step.pool) ids.add(id);
  }
  return [...ids];
}

/** Whether the target's own entry is a boss: its page says so in the kind it links to. */
export const isBossTarget = (target: PrepTarget, content: ContentDb): boolean =>
  target.kind === 'zone' &&
  content.bosses.some((b) => b.id === fightTarget(content, target.id)?.enemy.id);

/** How well the player knows the target: the least known of its entries (0 when it has none). */
export function knowledgeOfTarget(
  state: GameState,
  target: PrepTarget,
  content: ContentDb,
): number {
  const entries = entriesOf(target, content);
  if (entries.length === 0) return 0;
  return Math.min(...entries.map((id) => bingoLevel(state, id, content)));
}

/** What the knowledge level lets the preparation show: the verdict from level 1, the reasons from level 2. */
export interface Disclosure {
  verdict: boolean;
  reasons: boolean;
}

export function disclosure(level: number): Disclosure {
  const reveal: Reveal = revealAt(level);
  return { verdict: reveal.traits, reasons: reveal.hiddenTraits };
}

/** The command that starts the target's fight. */
export const startCommand = (target: PrepTarget, slot = 0) =>
  ({
    type: 'action.start',
    slot,
    kind: target.kind === 'zone' ? 'fight' : 'operation',
    id: target.id,
  }) as const;

/** The bank with what the pouch holds put back, as the plan sees what the player owns. */
function ownedBank(state: GameState): Record<string, number> {
  const bank = { ...state.bank };
  for (const slot of state.pouch.slots) {
    if (slot.id !== '') bank[slot.id] = (bank[slot.id] ?? 0) + slot.n;
  }
  return bank;
}

/** Whether the character knows a technique that makes combat clones: only then the role of the clones means anything. */
export const knowsCombatClone = (state: GameState, content: ContentDb): boolean =>
  content.techniques.some(
    (tech) => state.known[tech.id] === true && tech.combat?.effect?.kind === 'summon',
  );

/** The role the clones would take in a fight now: the chosen one, or the default when none is chosen or the chosen one is gone. */
export const cloneRoleNow = (state: GameState, content: ContentDb): string | null =>
  cloneRoleOf(content, state.loadouts.cloneRole)?.id ?? null;

/** The target's facts a plan can use: the traits the player knows and the nature of the enemy. */
function planFacts(
  state: GameState,
  target: PrepTarget,
  content: ContentDb,
): { traits: string[]; nature: string | null } {
  const entries = entriesOf(target, content);
  if (target.kind === 'zone') {
    return (
      (entries[0] ? targetOf(state, entries[0], content) : null) ?? { traits: [], nature: null }
    );
  }
  const traits = new Set<string>();
  for (const id of entries)
    for (const t of targetOf(state, id, content)?.traits ?? []) traits.add(t);
  return { traits: [...traits], nature: null };
}

/** The hand and the pouch the game would suggest for the target from what the player knows of it. */
export function suggestFor(
  state: GameState,
  target: PrepTarget,
  content: ContentDb,
): { techniques: string[]; pouch: { id: string; n: number }[] } {
  const rank = rankIndex(content, state.player.rank);
  return prepareFor(
    planningSnapshot(state, content),
    loadoutLimits(rank, content),
    planFacts(state, target, content),
    ownedBank(state),
    pouchLayout(state, content),
    state.loadouts.signature,
    content,
  );
}

/** The techniques of the hand now. A student has no hand to choose: every attack he knows is used. */
export function currentHand(state: GameState, content: ContentDb): string[] {
  const rank = rankIndex(content, state.player.rank);
  return loadoutLimits(rank, content) === null
    ? suggestFor(state, { kind: 'zone', id: '' }, content).techniques
    : effectiveLoadout(state, content);
}

/** Whether the player picks the hand: from the first rank that has a loadout. */
export const hasHand = (state: GameState, content: ContentDb): boolean =>
  loadoutLimits(rankIndex(content, state.player.rank), content) !== null;

/** The techniques the player may put in the hand: known, attacking (not passive), not always at hand. */
export function handCandidates(state: GameState, content: ContentDb): Technique[] {
  return content.techniques.filter(
    (t) =>
      state.known[t.id] === true && t.rank !== null && !isPassive(t) && !t.combat?.outOfLoadout,
  );
}

/** The defensive (passive) techniques the player knows. */
export function defenceTechniques(state: GameState, content: ContentDb): Technique[] {
  return content.techniques.filter((t) => state.known[t.id] === true && isPassive(t));
}

export interface DefenceView {
  /** The rating against the target, when it has one enemy whose level the player may read; else without that adjustment. */
  total: number;
  parts: EvasionPart[];
  /** The combat level the techniques were worked out against; null when it is not shown. */
  against: number | null;
}

/**
 * The evasion rating and its parts. With a known single enemy the techniques are worked out against its
 * level (their adjustment is on each part) and what knowing it adds is a part of its own.
 */
export function defenceOf(
  state: GameState,
  target: PrepTarget | null,
  content: ContentDb,
  rules: Rules,
): DefenceView {
  const own = playerEvasionParts(state, content, rules);
  const entry =
    target && target.kind === 'zone'
      ? entryOf(content, entriesOf(target, content)[0] ?? '')
      : undefined;
  const level = entry ? bingoLevel(state, entry.id, content) : 0;
  if (!entry || level < 1) {
    return { total: own.reduce((n, p) => n + p.value, 0), parts: own, against: null };
  }
  const parts = partsAgainst(own, entry.cl, content);
  parts.push({
    source: 'knowledge',
    id: entry.id,
    value: knowledgeTerm(level, content),
    knowledgeLevel: level,
  });
  return { total: parts.reduce((n, p) => n + p.value, 0), parts, against: entry.cl };
}

/** Why a verdict is what it is, as far as the player's knowledge lets it be said. */
export type Reason =
  | { kind: 'trait'; enemy: string; trait: string }
  | { kind: 'allAnswered' }
  | { kind: 'hiddenTraits'; count: number }
  | { kind: 'nature'; nature: string; strong: number; weak: number }
  | { kind: 'supply'; item: string; lastsMinutes: number; then: Verdict | null }
  | { kind: 'wounds'; stacks: number }
  | { kind: 'blocked'; key: string };

/** The reasons of a forecast for a target; the caller shows them only to a player who knows the enemy that well. */
export function reasonsOf(
  state: GameState,
  target: PrepTarget,
  analysis: Analysis,
  hand: readonly string[],
  content: ContentDb,
): Reason[] {
  const out: Reason[] = [];
  if (analysis.sessionBlocked) out.push({ kind: 'blocked', key: analysis.sessionBlocked });
  for (const c of analysis.coverage) {
    if (!c.answered) out.push({ kind: 'trait', enemy: c.enemy, trait: c.trait });
  }
  if (analysis.coverage.length > 0 && analysis.coverage.every((c) => c.answered)) {
    out.push({ kind: 'allAnswered' });
  }
  if (analysis.hiddenTraits > 0) out.push({ kind: 'hiddenTraits', count: analysis.hiddenTraits });
  const facts = planFacts(state, target, content);
  if (facts.nature !== null) {
    let strong = 0;
    let weak = 0;
    for (const id of hand) {
      const tech = content.techniques.find((t) => t.id === id);
      if (!tech) continue;
      const f = wheelFactor(tech.skill, facts.nature, content);
      if (f > 1) strong++;
      else if (f < 1) weak++;
    }
    out.push({ kind: 'nature', nature: facts.nature, strong, weak });
  }
  const session = analysis.session;
  if (session) {
    session.supplies.forEach((s, i) => {
      out.push({
        kind: 'supply',
        item: s.item,
        lastsMinutes: s.lastsMinutes,
        then: i === 0 ? (session.afterSupplies?.verdict ?? null) : null,
      });
    });
  }
  if (state.wounds.stacks > 0) out.push({ kind: 'wounds', stacks: state.wounds.stacks });
  return out;
}

/**
 * The items the player may pack into a slot of the kind: those in the bank (or already in a slot) whose use in a fight
 * the kind takes. Without a kind, every item a fight can use.
 */
export function pouchChoices(state: GameState, content: ContentDb, kindId?: string): string[] {
  const held = new Set(state.pouch.slots.map((s) => s.id).filter((id) => id !== ''));
  const kind = kindId === undefined ? undefined : pouchKind(content, kindId);
  return content.items
    .filter(
      (i) =>
        pouchUse(i, content) !== null &&
        (kind === undefined || itemFitsKind(i, kind, content)) &&
        ((state.bank[i.id] ?? 0) > 0 || held.has(i.id)),
    )
    .map((i) => i.id);
}
