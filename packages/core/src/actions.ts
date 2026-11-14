import type { ContentDb, SkillId } from '@shinobi/content';
import { actionsKey, bump } from './counters.ts';
import { emit, type ActionStoppedEvent } from './events.ts';
import {
  MS_PER_SECOND,
  SECONDS_PER_HOUR,
  masteryLevel,
  masteryXpPerAction,
  poolGain,
  practiceIntervalSeconds,
  rate,
  techniqueCastSeconds,
} from './formulas.ts';
import { indexOf } from './lookup.ts';
import { computeMod } from './modifiers.ts';
import { gainMasteryXp, gainPoolXp, gainXp } from './progression.ts';
import { evalReq, type Req } from './requirements.ts';
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
  /** Length of one cycle in ms at full speed, modifiers included. At least 1. */
  intervalMs(state: GameState, id: string, content: ContentDb, rules: Rules): number;
  /** Pays out one finished cycle. Returning 'stop' ends the action (one-shot actions). */
  complete(
    state: GameState,
    id: string,
    content: ContentDb,
    rules: Rules,
  ): 'continue' | 'stop' | void;
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

/** The facts a skill-training action is built from. */
interface SkillActionDef {
  skill: SkillId;
  /** Level at which the action unlocks; sets its XP rate. */
  level: number;
  masteryKey: string;
  /** Cycle length in seconds before modifiers. */
  baseSeconds: number;
  /** Requirements beyond the skill level. */
  extra: Req[];
}

/** Looks an action up in the content. `state` is null when only existence is being checked. */
type Resolver = (state: GameState | null, id: string, content: ContentDb) => SkillActionDef | null;

function skillAction(resolve: Resolver): ActionKind {
  const baseMs = (def: SkillActionDef) => Math.round(def.baseSeconds * MS_PER_SECOND);
  return {
    has: (id, content) => resolve(null, id, content) !== null,
    requirements(state, id, content) {
      const def = resolve(state, id, content);
      if (!def) return null;
      return { t: 'all', of: [...def.extra, { t: 'skill', skill: def.skill, level: def.level }] };
    },
    intervalMs(state, id, content, rules) {
      const def = resolve(state, id, content);
      if (!def) return 1;
      const mod = computeMod(
        rules.modifierProviders,
        state,
        `interval.skill.${def.skill}`,
        content,
      ).total;
      return Math.max(1, Math.round(baseMs(def) * mod));
    },
    complete(state, id, content, rules) {
      const def = resolve(state, id, content);
      if (!def) return;
      // Rewards follow the unmodified cycle length, so a faster cycle earns more per hour.
      const seconds = baseMs(def) / MS_PER_SECOND;
      const xp = (rate(def.level, content) * seconds) / SECONDS_PER_HOUR;
      gainXp(state, def.skill, xp, content, rules);
      const mastery = masteryXpPerAction(seconds, content);
      gainMasteryXp(state, def.masteryKey, mastery, content);
      gainPoolXp(state, def.skill, poolGain(mastery, content), content);
    },
  };
}

export const practiceKind = skillAction((state, id, content) => {
  const t = indexOf(content).techniques.get(id);
  if (!t) return null;
  const mastery = state ? masteryLevel(state, id, content) : 1;
  const cast = techniqueCastSeconds(t.sealSeq.length, mastery, content);
  return {
    skill: t.skill,
    level: t.level,
    masteryKey: id,
    baseSeconds: practiceIntervalSeconds(cast, content),
    extra: [{ t: 'technique', id }],
  };
});

export const drillKind = skillAction((_state, id, content) => {
  const e = indexOf(content).exercises.get(id);
  if (!e) return null;
  return {
    skill: 'cc',
    level: e.level,
    masteryKey: id,
    baseSeconds: content.balance.K.drill,
    extra: [],
  };
});

export const meditateKind = skillAction((_state, id, content) => {
  const p = indexOf(content).practices.get(id);
  if (!p) return null;
  return {
    skill: 'med',
    level: p.level,
    masteryKey: id,
    baseSeconds: content.balance.K.meditate,
    extra: [],
  };
});

export const obstacleKind = skillAction((_state, id, content) => {
  const o = indexOf(content).obstacles.get(id);
  if (!o) return null;
  return {
    skill: 'ath',
    level: o.level,
    masteryKey: id,
    baseSeconds: content.balance.K.obstacle,
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
): void {
  const slot = state.slots[index];
  if (!slot?.action) return;
  const { kind, id } = slot.action;
  rules.actionKinds[kind]?.stop?.(state, index, id, content, rules, reason);
  emit(state, { type: 'actionStopped', slot: index, kind, id, reason });
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
    for (const slot of state.slots) {
      if (!slot.action || slot.share <= 0) continue;
      const kind = rules.actionKinds[slot.action.kind];
      if (!kind) continue;
      const need =
        kind.intervalMs(state, slot.action.id, content, rules) * SHARE_FULL - slot.progress;
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
        const kind = rules.actionKinds[name];
        if (!kind || !kind.has(id, content))
          return stopSlot(state, index, 'missing', content, rules);
        const need = kind.intervalMs(state, id, content, rules) * SHARE_FULL;
        if (slot.progress < need) return;
        slot.progress -= need;
        const result = kind.complete(state, id, content, rules);
        state.stats.completed++;
        bump(state, actionsKey(name));
        if (result === 'stop') return stopSlot(state, index, 'finished', content, rules);
        const req = kind.requirements(state, id, content, rules);
        if (req && !evalReq(state, req, content).met) {
          return stopSlot(state, index, 'requirements', content, rules);
        }
      }
    });
  },
};
