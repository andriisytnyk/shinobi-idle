import type { ContentDb, Technique } from '@shinobi/content';
import { addItem, removeItem } from './bank.ts';
import { growSlots } from './clone.ts';
import type { CommandResult } from './engine.ts';
import { rebalanceShares } from './actions.ts';
import { emit } from './events.ts';
import { masteryLevel, masteryXpPerHour } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { grantMastery } from './progression.ts';
import { evalReq, type Req } from './requirements.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { refreshUnlocks } from './unlocks.ts';

/** What reading a scroll of a technique needs: its skill level, and the skill itself open (a nature skill needs the nature). */
export function learnReq(tech: Technique, content: ContentDb): Req {
  const of: Req[] = [{ t: 'skill', skill: tech.skill, level: tech.level }];
  const open = content.skills.find((s) => s.id === tech.skill)?.unlockReq;
  if (open) of.push(open);
  return { t: 'all', of };
}

/** The scroll item of a technique, if there is one. */
export function scrollOf(technique: string, content: ContentDb): string | null {
  return content.items.find((i) => i.scroll?.technique === technique)?.id ?? null;
}

/**
 * The Library scroll a chain hands out in place of a fixed one: a technique the player does not
 * know and can read once its skill is open, from a Library level up to `maxLibrary`. A scroll of a
 * nature the player owns comes first, then the higher Library level, then the content order.
 */
export function rewardScroll(
  state: GameState,
  maxLibrary: number,
  content: ContentDb,
): string | null {
  let best: { item: string; owned: boolean; level: number } | null = null;
  for (const item of content.items) {
    const scroll = item.scroll;
    if (!scroll || scroll.source.t !== 'library' || scroll.source.level > maxLibrary) continue;
    const tech = indexOf(content).techniques.get(scroll.technique);
    if (!tech || state.known[tech.id]) continue;
    const open = content.skills.find((s) => s.id === tech.skill)?.unlockReq;
    if (open && !evalReq(state, open, content).met) continue;
    const owned = state.player.natures.includes(tech.skill);
    const level = scroll.source.level;
    if (!best || (owned && !best.owned) || (owned === best.owned && level > best.level)) {
      best = { item: item.id, owned, level };
    }
  }
  return best?.item ?? null;
}

/**
 * Turns `partsPerScroll` parts of a technique into its scroll. `item` names the part (or the
 * scroll the parts make). Fewer parts than that, an item that is neither, or a technique with no
 * scroll is refused and nothing changes.
 */
export function combineParts(state: GameState, item: string, content: ContentDb): CommandResult {
  const def = typeof item === 'string' ? indexOf(content).items.get(item) : undefined;
  const technique = def?.part?.technique ?? def?.scroll?.technique;
  if (!def || !technique) return { ok: false, reason: 'error.notCombinable' };
  const part = content.items.find((i) => i.part?.technique === technique);
  const scroll = scrollOf(technique, content);
  if (!part || !scroll) return { ok: false, reason: 'error.notCombinable' };
  const need = content.balance.K.partsPerScroll;
  if ((state.bank[part.id] ?? 0) < need) return { ok: false, reason: 'error.notEnoughParts' };
  removeItem(state, part.id, need);
  addItem(state, scroll, 1);
  emit(state, { type: 'itemGained', id: scroll, n: 1 });
  return { ok: true };
}

/** One hour of practice for a technique, as the balance defines it. */
function notesFor(state: GameState, tech: Technique, content: ContentDb, rules: Rules): void {
  grantMastery(
    state,
    tech.id,
    tech.skill,
    masteryXpPerHour(masteryLevel(state, tech.id, content), content),
    content,
    rules,
  );
}

/**
 * Reads a scroll. A technique the player does not know is learned when its requirements hold
 * (the refusal carries the requirement tree otherwise); a scroll of a technique already known is
 * read as Notes, worth an hour of practice.
 */
export function readScroll(
  state: GameState,
  itemId: string,
  technique: string,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const tech = indexOf(content).techniques.get(technique);
  if (!tech) return { ok: false, reason: 'error.unknownTechnique' };
  if (state.known[tech.id]) {
    removeItem(state, itemId, 1);
    notesFor(state, tech, content, rules);
    emit(state, { type: 'itemUsed', id: itemId, target: tech.id });
    return { ok: true };
  }
  const check = evalReq(state, learnReq(tech, content), content);
  if (!check.met) return { ok: false, reason: 'error.requirementsNotMet', req: check };
  removeItem(state, itemId, 1);
  state.known[tech.id] = true;
  emit(state, { type: 'techniqueLearned', id: tech.id });
  emit(state, { type: 'itemUsed', id: itemId, target: tech.id });
  refreshUnlocks(state, content, true);
  // The technique may open an action slot (the clone).
  growSlots(state, content);
  rebalanceShares(state, content);
  return { ok: true };
}

/** Uses the generic Notes on a technique the player knows. */
export function readNotes(
  state: GameState,
  itemId: string,
  target: string | undefined,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const tech = target === undefined ? undefined : indexOf(content).techniques.get(target);
  if (!tech || tech.rank === null || !state.known[tech.id]) {
    return { ok: false, reason: 'error.invalidTarget' };
  }
  removeItem(state, itemId, 1);
  notesFor(state, tech, content, rules);
  emit(state, { type: 'itemUsed', id: itemId, target: tech.id });
  return { ok: true };
}
