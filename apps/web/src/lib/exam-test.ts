import type { ContentDb } from '@shinobi/content';
import { SENSEI_TEST_KIND, SHARE_FULL, type GameState, type Rules } from '@shinobi/core';

export interface SenseiTestInfo {
  slot: number;
  /** 0..1 of the test done. */
  fraction: number;
  /** Game time left at the slot's current speed, in ms. */
  left: number;
}

/** The sensei test while it runs, or null. */
export function senseiTestInfo(
  state: GameState,
  rules: Rules,
  content: ContentDb,
): SenseiTestInfo | null {
  const slot = state.slots.findIndex((s) => s.action?.kind === SENSEI_TEST_KIND);
  const running = state.slots[slot];
  const kind = rules.actionKinds[SENSEI_TEST_KIND];
  if (!running?.action || !kind) return null;
  const total = kind.intervalMs(state, running.action.id, content, rules) * SHARE_FULL;
  const left = running.share > 0 ? Math.max(0, total - running.progress) / running.share : 0;
  return { slot, fraction: Math.min(1, running.progress / total), left };
}
