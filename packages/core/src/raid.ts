import type { ContentDb, Raid } from '@shinobi/content';
import { addCurrency } from './bank.ts';
import { emit } from './events.ts';
import { reqMet } from './requirements.ts';
import type { GameState } from './state.ts';
import { currencyOf } from './vocab.ts';
import type { RaidRun, VillageState } from './village-state.ts';

/*
 * Raids on the village. A raid is data (`content.raids`): it is called once when its trigger holds, waits
 * `lead` village ticks, then stands at the gates for `hold` ticks. The player repels its packs by fighting
 * in the raid's own fight (open while the raid is at the gates); when the hold ends the village's own
 * defence takes the packs left, if it has any defence at all. Everything runs on village ticks and on the
 * kills of the fight loop, so it is the same however the time is cut and whether the player is there or not.
 */

/** The flag of a raid: `active` while it is at the gates, `over` once it has ended (a quest can ask for it). */
export const raidFlag = (raidId: string, part: 'active' | 'over'): string =>
  `raid.${raidId}.${part}`;

/** What one entry of a raid's defence counts now: the building level or the units of the resource held. */
function held(village: VillageState, content: ContentDb, entry: Raid['defence'][number]): number {
  if (entry.t === 'building') return village.damage[entry.id] ? 0 : (village.levels[entry.id] ?? 0);
  const kind = content.resources.find((r) => r.id === entry.id)?.kind;
  if (kind === 'power') return village.power;
  if (kind === 'workforce') return village.workforce;
  if (kind === 'shinobi') return village.shinobi[entry.id] ?? 0;
  return village.res[entry.id] ?? 0;
}

/** The parts of the village's defence against a raid: what is held, and the points it gives. */
export function defenceParts(
  village: VillageState,
  raid: Raid,
  content: ContentDb,
): { t: 'building' | 'resource'; id: string; have: number; points: number }[] {
  return raid.defence.map((entry) => {
    const have = held(village, content, entry);
    return { t: entry.t, id: entry.id, have, points: have * entry.per };
  });
}

/** The defence points of the village against a raid. */
export const raidDefence = (village: VillageState, raid: Raid, content: ContentDb): number =>
  defenceParts(village, raid, content).reduce((sum, p) => sum + p.points, 0);

/** How many packs the village alone would stop now. */
export const packsStopped = (village: VillageState, raid: Raid, content: ContentDb): number =>
  Math.floor(raidDefence(village, raid, content) / raid.perPack);

const emptyRun = (phase: RaidRun['phase'], ticks: number): RaidRun => ({
  phase,
  ticks,
  repelled: 0,
  byVillage: 0,
  breached: 0,
  damaged: [],
  ryo: 0,
  rep: 0,
});

/** Packs of the raid that nobody has repelled yet. */
export const packsLeft = (raid: Raid, run: RaidRun): number =>
  Math.max(0, raid.packs - run.repelled - run.byVillage);

function arrive(state: GameState, raid: Raid, village: VillageState): void {
  village.raids[raid.id] = emptyRun('active', raid.hold);
  state.flags[raidFlag(raid.id, 'active')] = true;
  emit(state, { type: 'raidArrived', raid: raid.id });
}

/** Calls every raid whose trigger holds and that was never called. A raid with no lead arrives at once. */
export function startRaids(state: GameState, content: ContentDb): void {
  const village = state.village;
  if (!village) return;
  for (const raid of content.raids) {
    if (village.raids[raid.id] || !reqMet(state, raid.trigger, content)) continue;
    village.raids[raid.id] = emptyRun('warned', raid.lead);
    emit(state, { type: 'raidCalled', raid: raid.id, ticks: raid.lead });
    if (raid.lead === 0) arrive(state, raid, village);
  }
}

/** Ends a raid: what got through damages buildings, the reward is paid by the share repelled, the flags are set. */
function finish(state: GameState, raid: Raid, village: VillageState, content: ContentDb): void {
  const run = village.raids[raid.id];
  if (!run) return;
  const breached = packsLeft(raid, run);
  // Each pack that got through damages the next building of the raid's list that is built and still working.
  const hit = raid.targets
    .filter((id) => (village.levels[id] ?? 0) > 0 && !village.damage[id])
    .slice(0, breached);
  for (const id of hit) village.damage[id] = raid.repair;
  const share = (run.repelled + run.byVillage * raid.autoShare) / raid.packs;
  const ryo = Math.floor(raid.reward.ryo * share);
  const rep = Math.floor(raid.reward.rep * share);
  const money = currencyOf(content, 'money');
  const renown = currencyOf(content, 'renown');
  if (money !== null && ryo > 0) addCurrency(state, money, ryo);
  if (renown !== null && rep > 0) addCurrency(state, renown, rep);
  Object.assign(run, { phase: 'over', ticks: 0, breached, damaged: hit, ryo, rep });
  delete state.flags[raidFlag(raid.id, 'active')];
  state.flags[raidFlag(raid.id, 'over')] = true;
  emit(state, {
    type: 'raidOver',
    raid: raid.id,
    repelled: run.repelled,
    byVillage: run.byVillage,
    breached,
    damaged: hit,
    ryo,
    rep,
  });
}

/**
 * A pack fell in the fight `actionId`. If that fight is a raid at the gates, counts the pack for the player and
 * ends the raid when it was the last. Returns true when the raid is over (the fight has nothing more to do).
 */
export function raidPackFell(state: GameState, actionId: string, content: ContentDb): boolean {
  const village = state.village;
  const raid = content.raids.find((r) => r.id === actionId);
  const run = raid && village?.raids[raid.id];
  if (!village || !raid || !run || run.phase !== 'active') return false;
  run.repelled += 1;
  if (packsLeft(raid, run) > 0) return false;
  finish(state, raid, village, content);
  return true;
}

/** One village tick of the raids: the countdowns, the arrival, the end of the hold, and the repair of damaged buildings. */
export function raidsTick(state: GameState, village: VillageState, content: ContentDb): void {
  // Repairs first: a building a raid damages in this tick is out of work for the whole of `repair` ticks.
  for (const id of Object.keys(village.damage)) {
    village.damage[id] = (village.damage[id] ?? 0) - 1;
    if ((village.damage[id] ?? 0) <= 0) {
      delete village.damage[id];
      emit(state, { type: 'buildingRepaired', building: id });
    }
  }
  for (const raid of content.raids) {
    const run = village.raids[raid.id];
    if (!run) continue;
    if (run.phase === 'warned') {
      run.ticks -= 1;
      if (run.ticks <= 0) arrive(state, raid, village);
    } else if (run.phase === 'active') {
      if (run.ticks > 0) run.ticks -= 1;
      // The village takes the packs left only when it has a defence; with none, the raid waits for the player.
      if (run.ticks <= 0) {
        const stopped = packsStopped(village, raid, content);
        if (stopped > 0) {
          run.byVillage = Math.min(packsLeft(raid, run), stopped);
          finish(state, raid, village, content);
        }
      }
    }
  }
}
