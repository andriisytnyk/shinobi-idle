import type { ContentDb } from '@shinobi/content';
import { actionsKey, bump } from './counters.ts';
import { emit, type ActionStoppedEvent } from './events.ts';
import {
  MS_PER_SECOND,
  cycleSeconds,
  cycleXp,
  masteryLevel,
  masteryXpPerAction,
  practiceIntervalSeconds,
  practiceXp,
  techniqueCastSeconds,
} from './formulas.ts';
import { removeFigure } from './hex.ts';
import { indexOf } from './lookup.ts';
import { actionFloor, entitySkill } from './vocab.ts';
import { trackClone } from './clone.ts';
import { STAND_ID, STAND_KIND, asPerformer } from './performer.ts';
import { nonNativeLevel } from './natures.ts';
import { cycleFactor } from './modifiers.ts';
import { spendTonicCharges } from './buffs.ts';
import { gainXp, grantMastery } from './progression.ts';
import { reqMet, skillLevel, type Req } from './requirements.ts';
import type { Rules } from './rules.ts';
import { SHARE_FULL, type GameState } from './state.ts';
import type { System } from './system.ts';

export type StopReason = ActionStoppedEvent['reason'];

/**
 * What an action makes and uses: the items it makes, the items it uses up, and the speed key of the
 * skill that uses them. Plain data about the action; no rule reads it for a speed bonus any more.
 */
export interface ActionFlow {
  makes: string[];
  uses: string[];
  speed: string;
}

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
  /**
   * What the action `id` makes and uses (see `ActionFlow`), or null when it takes part in no item
   * flow. A kind without it never gets a link bonus; a pack's own kind that has it can feed or be
   * fed by the kinds of the clone technique's `slotLinks`.
   */
  flow?(id: string, content: ContentDb): ActionFlow | null;
  /**
   * Whether the action `id` is unique by nature: no two performers can do it at once (one raid
   * fight per raid, one instance of a mission, one hex surveyed by one performer). A kind without
   * it can run in any number of performers.
   */
  unique?(id: string, content: ContentDb): boolean;
  /** Not used any more: every performer works at full speed (kept so that kinds written for the shared pool still compile). */
  fullSpeed?: boolean;
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
  /**
   * What the slot does when this action finishes by itself (it returned 'stop') or aborts when its
   * work is done (it returned 'abort', for example a survey that has nothing left to reveal): another action
   * (kind and id) that takes the slot over, or null to leave it idle. The figure of a clone stays on
   * the map while its slot holds an action, so a clone's walk that ends in standing still keeps it there.
   */
  after?(
    state: GameState,
    slot: number,
    id: string,
    content: ContentDb,
    rules: Rules,
  ): { kind: string; id: string } | null;
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
export function actionKindOf(
  rules: Pick<Rules, 'actionKinds'>,
  name: string,
): ActionKind | undefined {
  return Object.hasOwn(rules.actionKinds, name) ? rules.actionKinds[name] : undefined;
}

/** The facts a skill-training action is built from. */
export interface SkillActionDef {
  skill: string;
  /** Level at which the action unlocks. */
  level: number;
  masteryKey: string;
  /** Cycle length in seconds before modifiers. */
  baseSeconds: number;
  /** Skill XP one completed cycle pays before modifiers; it does not depend on mastery. */
  xp: number;
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
      const mod = cycleFactor(rules, state, def.skill, content, def.extraSpeed);
      return Math.max(actionFloor(content), Math.round(baseMs(def) * mod));
    },
    complete(state, id, content, rules) {
      const def = resolve(state, id, content);
      if (!def) return;
      // The XP of a cycle is data of the action; a faster cycle (modifiers) earns more per hour.
      gainXp(state, def.skill, def.xp, content, rules);
      // Mastery follows the unmodified cycle length and grows with the mastery level of the action.
      const seconds = baseMs(def) / MS_PER_SECOND;
      const level = masteryLevel(state, def.masteryKey, content);
      const mastery = masteryXpPerAction(level, seconds, content);
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
    xp: practiceXp(t, content),
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
    baseSeconds: cycleSeconds('drill', e, content),
    xp: cycleXp('drill', e, content),
    extra: [],
  };
});

/**
 * Splits the speed budget. Every performer works at full speed: a slot that runs an action has
 * SHARE_FULL, an idle slot has 0 (slot 0 keeps the full budget when nothing runs). There is no shared
 * pool: a clone's price is its chakra (`clone-life.ts`), not the character's speed.
 */
export function rebalanceShares(state: GameState, _content?: ContentDb): void {
  const anyRuns = state.slots.some((s) => s.action);
  state.slots.forEach((slot, index) => {
    slot.share = slot.action || (index === 0 && !anyRuns) ? SHARE_FULL : 0;
  });
}

/** Clears a slot, calls the kind's stop hook, tells the UI why and re-splits the speed budget. */
export function stopSlot(
  state: GameState,
  index: number,
  reason: StopReason,
  content: ContentDb,
  rules: Rules,
  cause?: string,
  /** The action that takes the slot over (and so keeps a clone's figure on the map). */
  next: { kind: string; id: string } | null = null,
): void {
  const slot = state.slots[index];
  if (!slot?.action) return;
  const { kind, id } = slot.action;
  const impl = actionKindOf(rules, kind);
  const missing = asPerformer(state, index, () => {
    impl?.stop?.(state, index, id, content, rules, reason);
    return reason === 'requirements' ? impl?.missing?.(state, id, content, rules) : null;
  });
  emit(state, {
    type: 'actionStopped',
    slot: index,
    kind,
    id,
    reason,
    ...(missing ? { missing } : {}),
    ...(cause ? { cause } : {}),
  });
  // A clone is still there when its action ends: it stands where it is, until the dispel or a new action.
  const body = index > 0 ? state.clones[index] : undefined;
  const stands =
    body !== undefined &&
    !body.doomed &&
    next === null &&
    reason !== 'replaced' &&
    reason !== 'dispelled' &&
    kind !== STAND_KIND &&
    actionKindOf(rules, STAND_KIND)?.has(STAND_ID, content) === true;
  slot.action = stands ? { kind: STAND_KIND, id: STAND_ID } : next;
  slot.progress = 0;
  slot.data = null;
  // A clone that is dispelled leaves the map; one whose action is replaced stays where it stands.
  if (index > 0 && reason !== 'replaced' && slot.action === null) removeFigure(state, index);
  rebalanceShares(state, content);
}

/** The ms the next cycle of the action in slot `index` takes at full speed (the performer's own modifiers apply). */
function cycleMs(
  state: GameState,
  index: number,
  kind: ActionKind,
  id: string,
  content: ContentDb,
  rules: Rules,
): number {
  return asPerformer(state, index, () => kind.intervalMs(state, id, content, rules, index));
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
        cycleMs(state, index, kind, slot.action.id, content, rules) * SHARE_FULL - slot.progress;
      const wait = need <= 0 ? 0 : Math.ceil(need / slot.share);
      if (best === null || wait < best) best = wait;
    }
    return best;
  },

  elapse(state, dt, content) {
    trackClone(state, dt, content);
    for (const slot of state.slots) {
      if (slot.action) slot.progress += dt * slot.share;
    }
  },

  run(state, content, rules) {
    state.slots.forEach((slot, index) => {
      asPerformer(state, index, () => {
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
            // A clone whose survey or auto-survey ends keeps its place: the kind may hand the slot to standing.
            const after = kind.after?.(state, index, id, content, rules) ?? null;
            const next =
              after && actionKindOf(rules, after.kind)?.has(after.id, content) ? after : null;
            return stopSlot(state, index, reason, content, rules, cause ?? undefined, next);
          }
          if (result === 'step') {
            const req = kind.requirements(state, id, content, rules);
            if (req && !reqMet(state, req, content)) {
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
            const after = lacking ? null : (kind.after?.(state, index, id, content, rules) ?? null);
            const next =
              after && actionKindOf(rules, after.kind)?.has(after.id, content) ? after : null;
            return stopSlot(
              state,
              index,
              lacking ? 'requirements' : 'finished',
              content,
              rules,
              undefined,
              next,
            );
          }
          const req = kind.requirements(state, id, content, rules);
          if (req && !reqMet(state, req, content)) {
            return stopSlot(state, index, 'requirements', content, rules);
          }
        }
      });
    });
  },
};
