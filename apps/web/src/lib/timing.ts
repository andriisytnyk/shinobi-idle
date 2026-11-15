import type { ContentDb } from '@shinobi/content';
import {
  masteryLevel,
  nonNativeLevel,
  practiceIntervalSeconds,
  skillLevel,
  RATE_FULL,
  SHARE_FULL,
  techniqueCastSeconds,
  type GameState,
} from '@shinobi/core';
import type { ProgressTiming } from './time-progress.ts';

/** A cycle that is not running: the visual stays where it is. */
export const IDLE_TIMING: ProgressTiming = { fraction: 0, cycleMs: 0, running: false };

/**
 * Timing of the action in a slot. `lengthMs` is the cycle at full speed with modifiers (what
 * `ActionInfo.intervalMs` says); the slot's share stretches it to the real time the cycle takes.
 */
export function slotTiming(
  state: GameState,
  slotIndex: number,
  lengthMs: number,
  repeat = true,
): ProgressTiming {
  const slot = state.slots[slotIndex];
  if (!slot?.action || lengthMs <= 0) return IDLE_TIMING;
  const share = Math.max(0, slot.share);
  return {
    fraction: Math.min(1, slot.progress / (lengthMs * SHARE_FULL)),
    cycleMs: share > 0 ? (lengthMs * SHARE_FULL) / share : 0,
    running: share > 0,
    repeat,
  };
}

/**
 * Timing of one of the fight's timers (a cast or an attack). The fight is advanced at events, so
 * the work the slot has received since then still counts; timers fill at the slot's share times
 * full speed (a slowed or stunned combatant makes the next update re-sync the visual).
 */
export function combatTiming(
  state: GameState,
  timer: { progress: number; need: number },
): ProgressTiming {
  const combat = state.combat;
  const slot = combat ? state.slots.find((s) => s.action?.kind === 'fight') : undefined;
  if (!combat || !slot || timer.need <= 0) return IDLE_TIMING;
  const share = Math.max(0, slot.share);
  const done = timer.progress + combat.work * RATE_FULL;
  return {
    fraction: Math.min(1, Math.max(0, done / timer.need)),
    cycleMs: share > 0 ? timer.need / (share * RATE_FULL) : 0,
    running: share > 0 && combat.phase === 'fight',
    repeat: false,
  };
}

/** The phases of a practice interval, as fractions of the cycle: focus, then the cast (the seals), then the release flash. */
export interface PracticePhases {
  /** End of the focus, the part of the interval that is not casting; the cast starts here. */
  focusEnd: number;
  /** End of the cast; the release flash runs from here to 1. */
  sealsEnd: number;
  /** Always 1: the flash ends with the interval. Kept so a consumer reads the flash as [sealsEnd, releaseEnd]. */
  releaseEnd: number;
  /** Number of seals, spread evenly over the cast. */
  count: number;
}

/** The release is a flash at the moment the interval completes: at most this long, at most a tenth of the interval. */
const RELEASE_MAX_S = 0.3;

/** The cast time of a technique in seconds, always from the core formula (the UI never derives it from the seals). */
function castSecondsOf(
  state: GameState,
  tech: ContentDb['techniques'][number],
  content: ContentDb,
): number {
  const foreign = nonNativeLevel(
    tech.skill,
    state.player.natures,
    skillLevel(state, tech.skill, content),
  );
  return techniqueCastSeconds(tech, masteryLevel(state, tech.id, content), content, foreign);
}

/**
 * Splits the practice interval into focus, cast and release. The interval and the cast time come
 * from core (practiceIntervalSeconds, techniqueCastSeconds); the focus is the part of the interval
 * that is not casting and comes before the cast; the seals are spread evenly over the cast; the
 * release flash is the last moments of the interval. Core exposes no such split itself.
 */
export function practicePhases(
  state: GameState,
  id: string,
  content: ContentDb,
): PracticePhases | null {
  const tech = content.techniques.find((t) => t.id === id);
  if (!tech) return null;
  const count = tech.sealSeq.length;
  const cast = castSecondsOf(state, tech, content);
  const total = practiceIntervalSeconds(cast, content);
  const release = Math.min(RELEASE_MAX_S, total * 0.1);
  const sealsEnd = Math.max(0, 1 - release / total);
  const castFraction = Math.min(sealsEnd, cast / total);
  return {
    focusEnd: count === 0 ? sealsEnd : sealsEnd - castFraction,
    sealsEnd,
    releaseEnd: 1,
    count,
  };
}

export type PhaseName = 'focus' | 'seal' | 'release';

export interface PracticePhase {
  name: PhaseName;
  /** The seal being made, for the phase seal. */
  seal: number;
}

/** The phase of a practice at a fraction of its cycle. */
export function phaseAt(phases: PracticePhases, fraction: number): PracticePhase {
  if (fraction < phases.focusEnd) return { name: 'focus', seal: -1 };
  if (phases.count > 0 && fraction < phases.sealsEnd) {
    const span = (phases.sealsEnd - phases.focusEnd) / phases.count;
    const seal = Math.min(phases.count - 1, Math.floor((fraction - phases.focusEnd) / span));
    return { name: 'seal', seal };
  }
  if (fraction < phases.sealsEnd) return { name: 'focus', seal: -1 };
  return { name: 'release', seal: -1 };
}

/** A seal that would be on screen for less than this is not shown one by one (a sweep instead). */
export const MIN_SEAL_MS = 250;

/** What a running practice looks like to the strip, the emblem and the Now bar. */
export interface PracticeView {
  timing: ProgressTiming;
  phases: PracticePhases;
  phase: PracticePhase;
  /** Real milliseconds one seal is on screen. */
  sealMs: number;
  /** Whether the seals go too fast to be lit one by one. */
  sweep: boolean;
}

/** The view of technique `id` practised in `slotIndex`; null when that slot does not practise it. */
export function practiceView(
  state: GameState,
  slotIndex: number,
  content: ContentDb,
  intervalMs: number,
): PracticeView | null {
  const slot = state.slots[slotIndex];
  if (!slot?.action || slot.action.kind !== 'practice') return null;
  const phases = practicePhases(state, slot.action.id, content);
  if (!phases) return null;
  const timing = slotTiming(state, slotIndex, intervalMs);
  const sealMs =
    phases.count > 0 ? ((phases.sealsEnd - phases.focusEnd) / phases.count) * timing.cycleMs : 0;
  return {
    timing,
    phases,
    phase: phaseAt(phases, timing.fraction),
    sealMs,
    sweep: phases.count > 0 && sealMs < MIN_SEAL_MS,
  };
}

/** The same for a tile that is not running: the strip only needs the seal count. */
export function sealWindows(phases: PracticePhases): { from: number; to: number }[] {
  const span = phases.count > 0 ? (phases.sealsEnd - phases.focusEnd) / phases.count : 0;
  return Array.from({ length: phases.count }, (_, i) => ({
    from: phases.focusEnd + i * span,
    to: phases.focusEnd + (i + 1) * span,
  }));
}
