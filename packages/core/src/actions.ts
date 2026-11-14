import type { ContentDb, SkillId } from '@shinobi/content';
import { emit } from './events.ts';
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
import { getMod } from './modifiers.ts';
import { gainMasteryXp, gainPoolXp, gainXp } from './progression.ts';
import { evalReq, type Req } from './requirements.ts';
import type { GameState } from './state.ts';
import type { System } from './system.ts';

/** What one kind of action does. Registered by name; slots refer to kinds by that name. */
export interface ActionKind {
  /** Whether `id` names an action of this kind in the content. */
  has(id: string, content: ContentDb): boolean;
  /** What must hold to start and keep going; null when nothing is needed. */
  requirements(state: GameState, id: string, content: ContentDb): Req | null;
  /** Length of one cycle in ms at full speed, modifiers included. At least 1. */
  intervalMs(state: GameState, id: string, content: ContentDb): number;
  /** Pays out one finished cycle. */
  complete(state: GameState, id: string, content: ContentDb): void;
}

const kinds = new Map<string, ActionKind>();

export function registerActionKind(name: string, kind: ActionKind): void {
  kinds.set(name, kind);
}

export function getActionKind(name: string): ActionKind | undefined {
  return kinds.get(name);
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
    intervalMs(state, id, content) {
      const def = resolve(state, id, content);
      if (!def) return 1;
      const mod = getMod(state, `interval.skill.${def.skill}`, content).total;
      return Math.max(1, Math.round(baseMs(def) * mod));
    },
    complete(state, id, content) {
      const def = resolve(state, id, content);
      if (!def) return;
      // Rewards follow the unmodified cycle length, so a faster cycle earns more per hour.
      const seconds = baseMs(def) / MS_PER_SECOND;
      gainXp(state, def.skill, (rate(def.level, content) * seconds) / SECONDS_PER_HOUR, content);
      const mastery = masteryXpPerAction(seconds, content);
      gainMasteryXp(state, def.masteryKey, mastery, content);
      gainPoolXp(state, def.skill, poolGain(mastery, content), content);
    },
  };
}

registerActionKind(
  'practice',
  skillAction((state, id, content) => {
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
  }),
);

registerActionKind(
  'drill',
  skillAction((_state, id, content) => {
    const e = indexOf(content).exercises.get(id);
    if (!e) return null;
    return {
      skill: 'cc',
      level: e.level,
      masteryKey: id,
      baseSeconds: content.balance.K.drill,
      extra: [],
    };
  }),
);

registerActionKind(
  'meditate',
  skillAction((_state, id, content) => {
    const p = indexOf(content).practices.get(id);
    if (!p) return null;
    return {
      skill: 'med',
      level: p.level,
      masteryKey: id,
      baseSeconds: content.balance.K.meditate,
      extra: [],
    };
  }),
);

registerActionKind(
  'obstacle',
  skillAction((_state, id, content) => {
    const o = indexOf(content).obstacles.get(id);
    if (!o) return null;
    return {
      skill: 'ath',
      level: o.level,
      masteryKey: id,
      baseSeconds: content.balance.K.obstacle,
      extra: [],
    };
  }),
);

/** Clears a slot and tells the UI why. */
export function stopSlot(state: GameState, index: number, reason: 'manual' | 'requirements'): void {
  const slot = state.slots[index];
  if (!slot?.action) return;
  emit(state, {
    type: 'actionStopped',
    slot: index,
    kind: slot.action.kind,
    id: slot.action.id,
    reason,
  });
  slot.action = null;
  slot.progress = 0;
}

/** Runs every slot's action. Progress is in ms of full-speed work; `share` scales how fast it fills. */
export const actionSystem: System = {
  nextEventIn(state, content) {
    let best: number | null = null;
    for (const slot of state.slots) {
      if (!slot.action || !(slot.share > 0)) continue;
      const kind = kinds.get(slot.action.kind);
      if (!kind) continue;
      const need = kind.intervalMs(state, slot.action.id, content) - slot.progress;
      const wait = need <= 0 ? 0 : Math.ceil(need / slot.share);
      if (best === null || wait < best) best = wait;
    }
    return best;
  },

  elapse(state, dt) {
    for (const slot of state.slots) if (slot.action) slot.progress += dt * slot.share;
  },

  run(state, content) {
    state.slots.forEach((slot, index) => {
      while (slot.action) {
        const { kind: name, id } = slot.action;
        const kind = kinds.get(name);
        if (!kind || !kind.has(id, content)) return stopSlot(state, index, 'requirements');
        const interval = kind.intervalMs(state, id, content);
        if (slot.progress < interval) return;
        slot.progress -= interval;
        kind.complete(state, id, content);
        state.stats.completed++;
        const req = kind.requirements(state, id, content);
        if (req && !evalReq(state, req, content).met) stopSlot(state, index, 'requirements');
      }
    });
  },
};
