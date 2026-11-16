import type { ContentDb } from '@shinobi/content';
import { actionsKey, bump } from './counters.ts';
import { emit, type ActionStoppedEvent } from './events.ts';
import {
  MS_PER_SECOND,
  SECONDS_PER_HOUR,
  masteryLevel,
  masteryXpPerAction,
  practiceIntervalSeconds,
  rate,
  techniqueCastSeconds,
} from './formulas.ts';
import { indexOf } from './lookup.ts';
import { actionFloor, entitySkill } from './vocab.ts';
import { nonNativeLevel } from './natures.ts';
import { cycleFactor } from './modifiers.ts';
import { spendTonicCharges } from './buffs.ts';
import { gainXp, grantMastery } from './progression.ts';
import { evalReq, skillLevel, type Req } from './requirements.ts';
import type { Rules } from './rules.ts';
import { SHARE_FULL, type GameState } from './state.ts';
import type { System } from './system.ts';

export type StopReason = ActionStoppedEvent['reason'];

/** What one kind of action does. Rule sets map kind names to these; slots refer to the names. */
export interface ActionKind {
  /** Whether `id` names an action of this kind in the content. */
  has(id: string, content: ContentDb): boolean;
  /** What must hold to start and keep going; null when nothing is needed. Re-checked after every cycle. */
  requirements(state: GameState, id: string, content: ContentDb, rules: Rules): Req | null;
  /**
   * Length of one cycle in ms at full speed, modifiers included. At least 1. `slot` is the slot
   * that runs the action, when the caller knows it; kinds that keep state in the slot read it.
   */
  intervalMs(state: GameState, id: string, content: ContentDb, rules: Rules, slot?: number): number;
  /**
   * Pays out one finished cycle. Returning 'stop' ends the action (one-shot actions); 'abort'
   * ends it too but means nothing was done, so the cycle is not counted. 'step' goes on without
   * counting the cycle: it was a part of a longer action (a stage of a mission) that counts itself.
   */
  complete(
    state: GameState,
    id: string,
    content: ContentDb,
    rules: Rules,
    slot?: number,
  ): 'continue' | 'stop' | 'abort' | 'step' | void;
  /** A reason (localization key) the action cannot start for a cause that is not a requirement, or null. */
  blocked?(
    state: GameState,
    id: string,
    content: ContentDb,
    rules: Rules,
    slot?: number,
  ): string | null;
  /** Why an action that returned 'abort' cannot go on (a localization key), or null for a plain end. */
  abortCause?(state: GameState, id: string, content: ContentDb, rules: Rules): string | null;
  /** The item the action lacks for its next cycle, if any; names the cause when it stops or is refused. */
  missing?(state: GameState, id: string, content: ContentDb, rules: Rules): string | null;
  /** The skill the action trains, when it trains one; a locked skill refuses its actions. */
  skill?(id: string, content: ContentDb): string | null;
  /**
   * The fight the action started (it put `state.combat` there) has ended in `result`; the combat
   * system has counted the Wounds and the kill. The kind decides what follows: it may leave the
   * slot, clear or replace `state.combat`, and so on. Kinds without it are the fight kinds.
   */
  combatEnded?(
    state: GameState,
    slot: number,
    result: 'victory' | 'defeat',
    content: ContentDb,
    rules: Rules,
  ): void;
  /** Called after the action is put in slot `slot` (its `data` is null). */
  start?(state: GameState, slot: number, id: string, content: ContentDb, rules: Rules): void;
  /** Called just before the action leaves slot `slot`, for any reason. */
  stop?(
    state: GameState,
    slot: number,
    id: string,
    content: ContentDb,
    rules: Rules,
    reason: StopReason,
  ): void;
}

/** The action kind a rule set has under `name`; a name of the object prototype (`constructor`) is no kind. */
export function actionKindOf(rules: Rules, name: string): ActionKind | undefined {
  return Object.hasOwn(rules.actionKinds, name) ? rules.actionKinds[name] : undefined;
}

/** The facts a skill-training action is built from. */
export interface SkillActionDef {
  skill: string;
  /** Level at which the action unlocks; sets its XP rate. */
  level: number;
  masteryKey: string;
  /** Cycle length in seconds before modifiers. */
  baseSeconds: number;
  /** Requirements beyond the skill level. */
  extra: Req[];
  /** A speed modifier key besides the skill's own, for example `speed.practice`. */
  extraSpeed?: string;
}

/** Looks an action up in the content. `state` is null when only existence is being checked. */
export type Resolver = (
  state: GameState | null,
  id: string,
  content: ContentDb,
) => SkillActionDef | null;

export function skillAction(resolve: Resolver): ActionKind {
  const baseMs = (def: SkillActionDef) => Math.round(def.baseSeconds * MS_PER_SECOND);
  return {
    has: (id, content) => resolve(null, id, content) !== null,
    skill: (id, content) => resolve(null, id, content)?.skill ?? null,
    requirements(state, id, content) {
      const def = resolve(state, id, content);
      if (!def) return null;
      return { t: 'all', of: [...def.extra, { t: 'skill', skill: def.skill, level: def.level }] };
    },
    intervalMs(state, id, content, rules) {
      const def = resolve(state, id, content);
      if (!def) return 1;
      const mod = cycleFactor(rules.modifierProviders, state, def.skill, content, def.extraSpeed);
      return Math.max(actionFloor(content), Math.round(baseMs(def) * mod));
    },
    complete(state, id, content, rules) {
      const def = resolve(state, id, content);
      if (!def) return;
      // Rewards follow the unmodified cycle length, so a faster cycle earns more per hour.
      const seconds = baseMs(def) / MS_PER_SECOND;
      const xp = (rate(def.level, content) * seconds) / SECONDS_PER_HOUR;
      gainXp(state, def.skill, xp, content, rules);
      const mastery = masteryXpPerAction(seconds, content);
      grantMastery(state, def.masteryKey, def.skill, mastery, content, rules);
    },
  };
}

export const practiceKind = skillAction((state, id, content) => {
  const t = indexOf(content).techniques.get(id);
  if (!t) return null;
  const mastery = state ? masteryLevel(state, id, content) : 1;
  const foreign = state
    ? nonNativeLevel(t.skill, state.player.natures, skillLevel(state, t.skill, content), content)
    : undefined;
  const cast = techniqueCastSeconds(t, mastery, content, foreign);
  return {
    skill: t.skill,
    level: t.level,
    masteryKey: id,
    baseSeconds: practiceIntervalSeconds(cast, content, t.level),
    extra: [{ t: 'technique', id }],
    extraSpeed: 'speed.practice',
  };
});

export const drillKind = skillAction((_state, id, content) => {
  const e = indexOf(content).exercises.get(id);
  const skill = e ? entitySkill(content, 'drill', e) : null;
  if (!e || skill === null) return null;
  return {
    skill,
    level: e.level,
    masteryKey: id,
    baseSeconds: content.balance.K.drill,
    extra: [],
  };
});

/**
 * Splits the speed budget: active slots share SHARE_FULL equally, the remainder goes to the first
 * active slot, idle slots get 0 (slot 0 keeps the full budget when nothing runs).
 */
export function rebalanceShares(state: GameState): void {
  const active = state.slots.filter((s) => s.action);
  const takers = active.length > 0 ? active : state.slots.slice(0, 1);
  for (const slot of state.slots) slot.share = 0;
  const each = Math.floor(SHARE_FULL / Math.max(1, takers.length));
  for (const slot of takers) slot.share = each;
  const [first] = takers;
  if (first) first.share += SHARE_FULL - each * takers.length;
}

/** Clears a slot, calls the kind's stop hook, tells the UI why and re-splits the speed budget. */
export function stopSlot(
  state: GameState,
  index: number,
  reason: StopReason,
  content: ContentDb,
  rules: Rules,
  cause?: string,
): void {
  const slot = state.slots[index];
  if (!slot?.action) return;
  const { kind, id } = slot.action;
  const impl = actionKindOf(rules, kind);
  impl?.stop?.(state, index, id, content, rules, reason);
  const missing = reason === 'requirements' ? impl?.missing?.(state, id, content, rules) : null;
  emit(state, {
    type: 'actionStopped',
    slot: index,
    kind,
    id,
    reason,
    ...(missing ? { missing } : {}),
    ...(cause ? { cause } : {}),
  });
  slot.action = null;
  slot.progress = 0;
  slot.data = null;
  rebalanceShares(state);
}

/**
 * Runs every slot's action. Progress is whole work units (ms x SHARE_FULL); a slot's share is how
 * many units a ms adds, and a cycle needs `intervalMs x SHARE_FULL`.
 */
export const actionSystem: System = {
  nextEventIn(state, content, rules) {
    let best: number | null = null;
    for (const [index, slot] of state.slots.entries()) {
      if (!slot.action || slot.share <= 0) continue;
      const kind = actionKindOf(rules, slot.action.kind);
      if (!kind) continue;
      const need =
        kind.intervalMs(state, slot.action.id, content, rules, index) * SHARE_FULL - slot.progress;
      const wait = need <= 0 ? 0 : Math.ceil(need / slot.share);
      if (best === null || wait < best) best = wait;
    }
    return best;
  },

  elapse(state, dt) {
    for (const slot of state.slots) if (slot.action) slot.progress += dt * slot.share;
  },

  run(state, content, rules) {
    state.slots.forEach((slot, index) => {
      while (slot.action) {
        const { kind: name, id } = slot.action;
        const kind = actionKindOf(rules, name);
        if (!kind || !kind.has(id, content))
          return stopSlot(state, index, 'missing', content, rules);
        const need = kind.intervalMs(state, id, content, rules, index) * SHARE_FULL;
        if (slot.progress < need) return;
        slot.progress -= need;
        const result = kind.complete(state, id, content, rules, index);
        if (result === 'abort') {
          const lacking = kind.missing?.(state, id, content, rules);
          const cause = kind.abortCause?.(state, id, content, rules);
          const reason = lacking || cause ? 'requirements' : 'finished';
          return stopSlot(state, index, reason, content, rules, cause ?? undefined);
        }
        if (result === 'step') {
          const req = kind.requirements(state, id, content, rules);
          if (req && !evalReq(state, req, content).met) {
            const cause = kind.abortCause?.(state, id, content, rules);
            return stopSlot(state, index, 'requirements', content, rules, cause ?? undefined);
          }
          continue;
        }
        const trained = kind.skill?.(id, content);
        if (trained) spendTonicCharges(state, trained, content);
        state.stats.completed++;
        bump(state, actionsKey(name));
        if (result === 'stop') {
          const lacking = kind.missing?.(state, id, content, rules);
          return stopSlot(state, index, lacking ? 'requirements' : 'finished', content, rules);
        }
        const req = kind.requirements(state, id, content, rules);
        if (req && !evalReq(state, req, content).met) {
          return stopSlot(state, index, 'requirements', content, rules);
        }
      }
    });
  },
};
