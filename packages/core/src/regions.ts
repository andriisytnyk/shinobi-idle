import type { ContentDb, Region } from '@shinobi/content';
import { emit } from './events.ts';
import { graduateReq } from './lookup.ts';
import { evalReq, type Req } from './requirements.ts';
import { activitySkill } from './vocab.ts';
import type { GameState } from './state.ts';

/** The flag a region raises once it is open; fight zones name it in their `unlock`. */
export const regionFlag = (regionId: string): string =>
  `region.${regionId.replace(/^core:/, '')}.unlocked`;

/** What opens a region: graduation from the Academy and the level of the map skill (Scouting) the region names. */
export function regionOpenReq(region: Region, content: ContentDb): Req {
  const scouting = activitySkill(content, 'map');
  return {
    t: 'all',
    of: [
      graduateReq(content),
      scouting === null
        ? { t: 'any', of: [] }
        : { t: 'skill', skill: scouting, level: region.scout },
    ],
  };
}

/**
 * Raises the flag of every region that is open now. A flag is never taken back: levels and rank
 * only go up. Emits `regionOpened` for each region opened by this call unless `silent`.
 */
export function refreshRegions(state: GameState, content: ContentDb, silent = false): void {
  for (const region of content.regions) {
    const flag = regionFlag(region.id);
    if (state.flags[flag]) continue;
    if (!evalReq(state, regionOpenReq(region, content), content).met) continue;
    state.flags[flag] = true;
    if (!silent) emit(state, { type: 'regionOpened', region: region.id });
  }
}
