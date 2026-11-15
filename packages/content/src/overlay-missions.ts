/** Layers the hand-written part of the missions over the generated ones. */
import { z } from 'zod';
import {
  coreId,
  missionExtraSchema,
  type Mission,
  type MissionBase,
  type MissionExtra,
} from './schema.ts';

export const missionExtraMapSchema = z.record(coreId, missionExtraSchema);

/**
 * Gives each generated mission its hand-written part: the requirement that opens it, the weight of
 * each stage in its minutes, and the amount of each payment in kind. Every stage has a label.
 */
export function layerMissions(
  base: readonly MissionBase[],
  extra: Readonly<Record<string, MissionExtra>>,
): Mission[] {
  for (const id of Object.keys(extra)) {
    if (!base.some((m) => m.id === id)) throw new Error(`Hand data for unknown mission ${id}`);
  }
  return base.map((m) => {
    const x = extra[m.id];
    if (!x) throw new Error(`No hand data for mission ${m.id}`);
    if (x.shares.length !== m.stages.length) throw new Error(`${m.id}: one share per stage`);
    if (x.slow.length !== m.stages.length) throw new Error(`${m.id}: one slow list per stage`);
    if (x.pay.length !== m.pay.length) throw new Error(`${m.id}: one amount per payment`);
    return {
      ...m,
      stages: m.stages.map((s) => (s.t === 'skill' || s.t === 'tech' ? { ...s, label: true } : s)),
      pay: m.pay.map((p, i) => {
        const n = x.pay[i] ?? 1;
        return p.kind === 'scrollPart' ? p : { ...p, n };
      }),
      unlock: x.unlock,
      shares: x.shares,
      slow: x.slow,
    };
  });
}
