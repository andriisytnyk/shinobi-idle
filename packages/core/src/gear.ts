import type { ContentDb, Gear } from '@shinobi/content';
import { removeCurrency } from './bank.ts';
import type { CommandResult } from './engine.ts';
import { graduateReq, indexOf } from './lookup.ts';
import { NO_MODIFIERS, hasNone, type Modifier, type ModifierProvider } from './modifiers.ts';
import { evalReq, type Req } from './requirements.ts';
import type { GameState } from './state.ts';
import { moneyOf } from './vocab.ts';

/** Tiers of a gear line the player owns. */
export function ownedTiers(state: GameState, line: string): number {
  return state.gear[line] ?? 0;
}

/**
 * What the next tier of a line needs: graduation from the Academy, the tier's skill level, and its building level
 * when it has one.
 */
export function nextTierReq(state: GameState, gear: Gear, content: ContentDb): Req | null {
  const tier = gear.tiers[ownedTiers(state, gear.id)];
  if (!tier) return null;
  const parts: Req[] = [graduateReq(content), { t: 'skill', skill: gear.skill, level: tier.level }];
  if (tier.building)
    parts.push({ t: 'building', id: tier.building.id, level: tier.building.level });
  return { t: 'all', of: parts };
}

/** Price of the next tier of a line, or null when every tier is owned. */
export function nextTierPrice(state: GameState, gear: Gear, content: ContentDb): number | null {
  return content.balance.K.gearTier[ownedTiers(state, gear.id)] ?? null;
}

/** Each owned tier of a line adds its share to the line's modifier key. */
export const gearProvider: ModifierProvider = (state, content) => {
  if (hasNone(state.gear)) return NO_MODIFIERS;
  const out: Modifier[] = [];
  const index = indexOf(content);
  for (const [id, tiers] of Object.entries(state.gear)) {
    const line = index.gear.get(id);
    if (!line || tiers < 1) continue;
    const size = (content.balance.K.gearFx[line.fx.perTier] ?? 0) * tiers;
    const base = { key: line.fx.key, group: 'items', source: { kind: 'gear', id } } as const;
    switch (line.fx.effect) {
      case 'bonus':
        out.push({ ...base, op: 'add', value: size });
        break;
      case 'reduction':
        out.push({ ...base, op: 'add', value: -size });
        break;
      case 'speed':
        out.push({ ...base, op: 'mul', value: 1 / (1 + size) });
        break;
    }
  }
  return out;
};

/** Buys the next tier of a line: the tier before it, the tier's requirements and the price are all needed. */
export function buyGear(state: GameState, lineId: string, content: ContentDb): CommandResult {
  const line = indexOf(content).gear.get(lineId);
  if (!line) return { ok: false, reason: 'error.unknownGear' };
  const req = nextTierReq(state, line, content);
  const price = nextTierPrice(state, line, content);
  if (!req || price === null) return { ok: false, reason: 'error.gearMaxed' };
  if (!evalReq(state, req, content).met) return { ok: false, reason: 'error.requirementsNotMet' };
  if (!removeCurrency(state, moneyOf(content), price))
    return { ok: false, reason: 'error.notEnoughRyo' };
  state.gear[lineId] = ownedTiers(state, lineId) + 1;
  return { ok: true };
}
