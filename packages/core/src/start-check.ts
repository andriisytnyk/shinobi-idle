import type { ContentDb } from '@shinobi/content';
import { actionKindOf } from './actions.ts';
import { cloneRefusal } from './clone.ts';
import { evalReq, type ReqResult } from './requirements.ts';
import type { Rules } from './rules.ts';
import { isSkillUnlocked } from './selectors.ts';
import type { GameState } from './state.ts';

/** Why an action cannot be started in a slot: the localization key `dispatch` answers, and the unmet requirement when that is the cause. */
export interface StartRefusal {
  reason: string;
  /** The requirement that failed (for `error.requirementsNotMet` and `error.missingIngredient`). */
  req?: ReqResult;
  /** The item the action lacks, when the reason is `error.missingIngredient`. */
  missing?: string;
}

/**
 * The refusal `action.start` gives for action `id` of `kindName` in slot `slotIndex`, or null when
 * it would start. The command and every forecast of "can I start it now" run this one function,
 * so they cannot disagree: the slot, the kind, the shut skill, the kind's own rules, and last the
 * requirements.
 */
export function startRefusal(
  state: GameState,
  slotIndex: number,
  kindName: string,
  id: string,
  content: ContentDb,
  rules: Rules,
  /** The kind's requirement tree already evaluated, when the caller has it from a moment ago (a forecast that is refreshed at a coarse rate). */
  evaluated?: ReqResult | null,
): StartRefusal | null {
  if (!state.slots[slotIndex]) return { reason: 'error.invalidSlot' };
  const kind = actionKindOf(rules, kindName);
  if (!kind) return { reason: 'error.unknownActionKind' };
  if (!kind.has(id, content)) return { reason: 'error.unknownAction' };
  // A skill that is still shut refuses every action it would train, whatever else holds.
  const skill = kind.skill?.(id, content);
  if (skill && !isSkillUnlocked(state, skill, content)) return { reason: 'error.skillLocked' };
  // A clone does not fight: its slot refuses what can hold a fight.
  const clone = cloneRefusal(state, slotIndex, kindName, id, content);
  if (clone) return { reason: clone };
  const blocked = kind.blocked?.(state, id, content, rules, slotIndex);
  if (blocked) return { reason: blocked };
  // One action, one performer: the very same action does not run in two slots at once.
  const same = state.slots.some(
    (s, i) => i !== slotIndex && s.action?.kind === kindName && s.action.id === id,
  );
  if (same) return { reason: 'error.sameActionElsewhere' };
  let result = evaluated;
  if (result === undefined) {
    const req = kind.requirements(state, id, content, rules);
    result = req ? evalReq(state, req, content) : null;
  }
  if (result && !result.met) {
    // An action that lacks an ingredient says so; anything else is a plain unmet requirement.
    const lacking = kind.missing?.(state, id, content, rules);
    return lacking
      ? { reason: 'error.missingIngredient', req: result, missing: lacking }
      : { reason: 'error.requirementsNotMet', req: result };
  }
  return null;
}
