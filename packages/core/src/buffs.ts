import type { ContentDb } from '@shinobi/content';
import { removeItem } from './bank.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { indexOf } from './lookup.ts';
import {
  NO_MODIFIERS,
  bonusOf,
  hasNone,
  touchMods,
  type Modifier,
  type ModifierProvider,
} from './modifiers.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** The skills a tonic's `skill` field covers. */
function coveredSkills(skill: string, content: ContentDb): readonly string[] {
  return skill === 'allNatures' ? indexOf(content).natureIds : [skill];
}

/**
 * Tonic buffs: each active tonic adds its XP bonus to the skills it covers while it has charges.
 * The modifier names the tonic item as its source, so the breakdown in `getMod` shows it.
 */
export const tonicProvider: ModifierProvider = (state, content) => {
  if (hasNone(state.buffs)) return NO_MODIFIERS;
  const out: Modifier[] = [];
  const items = indexOf(content).items;
  for (const [id, buff] of Object.entries(state.buffs)) {
    const fx = items.get(id)?.fx;
    if (fx?.kind !== 'tonic' || buff.charges < 1) continue;
    for (const skill of coveredSkills(buff.skill, content)) {
      out.push({
        key: `xp.skill.${skill}`,
        op: 'add',
        value: fx.xpBonus,
        group: 'items',
        source: { kind: 'item', id },
      });
    }
  }
  return out;
};

/** Takes one charge from every tonic that covers `skill`; a tonic with none left is removed. */
export function spendTonicCharges(state: GameState, skill: string, content: ContentDb): void {
  for (const [id, buff] of Object.entries(state.buffs)) {
    if (!coveredSkills(buff.skill, content).includes(skill)) continue;
    buff.charges -= 1;
    // The tonic provider reads only whether a charge is left.
    if (buff.charges < 1) {
      touchMods(state);
      delete state.buffs[id];
    }
  }
}

/** Charges one tonic gives: its own count after the `tonic.charges` modifiers, at least one. */
export function tonicCharges(
  state: GameState,
  base: number,
  content: ContentDb,
  rules: Rules,
): number {
  const bonus = bonusOf(rules, state, 'tonic.charges', content);
  return Math.max(1, Math.round(base * (1 + bonus)));
}

/**
 * Drinks one tonic from the bank: starts its buff, or adds its charges to a running one up to
 * `K.tonic.capMult` times the charges of one tonic. A tonic that is already at the cap is refused
 * and kept.
 */
export function useTonic(
  state: GameState,
  id: string,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const fx = indexOf(content).items.get(id)?.fx;
  if (fx?.kind !== 'tonic') return { ok: false, reason: 'error.itemNotUsable' };
  const per = tonicCharges(state, fx.charges, content, rules);
  const cap = per * content.balance.K.tonic.capMult;
  const current = state.buffs[id]?.charges ?? 0;
  if (current >= cap) return { ok: false, reason: 'error.tonicFull' };
  if (!removeItem(state, id, 1)) return { ok: false, reason: 'error.noItem' };
  state.buffs[id] = { skill: fx.skill, charges: Math.min(cap, current + per) };
  emit(state, { type: 'itemUsed', id, target: fx.skill });
  return { ok: true };
}
