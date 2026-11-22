import {
  content,
  NATURE_IDS,
  NATURE_WHEEL,
  type Boss,
  type Enemy,
  type NatureId,
} from '@shinobi/content';
import {
  autoLoadout,
  encounterFor,
  loadoutLimits,
  planTarget,
  prepareFor,
  simulateFights,
  type FightSummary,
  type PlayerSnapshot,
} from '../src/index.ts';
import { K, knownFor, levelsFor, rules } from './fight-helpers.ts';

/** Healing item of the pouch for a player of combat level `c`: the best food of the balance table the level allows. */
export function healItemFor(c: number): string {
  const row = [...K.food].reverse().find((f) => f[0] <= c) ?? K.food[0];
  const hp = row?.[1];
  const item = content.items.find((i) => i.fx?.kind === 'heal' && i.fx.hp === hp);
  if (!item) throw new Error(`no healing item of ${hp} hp`);
  return item.id;
}

/**
 * What the prepared player of the balance tests has of each item: four, as every pouch slot carried before the typed
 * slots. The data default of the healing slot is now ten, which makes the bosses far easier (see the PR); these tests
 * keep measuring the fights at the strength their bounds were set at.
 */
export const PREPARED_STACK = 4;

/** Every item a prepared player might carry: `PREPARED_STACK` of the level's healing item and of each tool. */
export function wellStocked(c: number): Record<string, number> {
  const bank: Record<string, number> = { [healItemFor(c)]: PREPARED_STACK };
  for (const i of content.items) {
    if (i.pouch === true || ['cleanse', 'dispel', 'bomb'].includes(i.fx?.kind ?? '')) {
      bank[i.id] = PREPARED_STACK;
    }
  }
  return bank;
}

// Scratch tuning: BOSSFX='{"twins":{"hpEach":0.4}}' overrides numbers of the loaded content.
const over = JSON.parse(process.env.BOSSFX ?? '{}') as Record<string, Record<string, number>>;
for (const [key, nums] of Object.entries(over)) {
  Object.assign((content.balance.K.bossFx as Record<string, object>)[key] ?? {}, nums);
}

export type Entry = Enemy | Boss;

/** The nature that beats `nature`, and the one it beats. */
export const beaten = (nature: NatureId): NatureId => {
  const found = content.natures.find((n) => n.id === nature)?.strongAgainst[0];
  if (!found) throw new Error('no beaten nature');
  return found as NatureId;
};
export const beater = (nature: NatureId): NatureId => {
  const found = NATURE_IDS.find((n) => NATURE_WHEEL[n] === nature);
  if (!found) throw new Error('no beater');
  return found;
};

export interface PlayerOptions {
  /** Levels below the entry's combat level. */
  below?: number;
  /** `prepared`: the best loadout and a pouch of healing items and tools; `empty`: the best loadout and nothing in the pouch; `auto`: the automatic loadout and nothing in the pouch. */
  prep: 'prepared' | 'empty' | 'auto';
  /** The AI tier: 1 plays as a Genin, 2 as a Chunin. */
  tier?: number;
  mastery?: number;
  /** `full`: every trait and the mechanic of the enemy is known; `none`: a first attempt, only what shows on sight. */
  knowledge?: 'full' | 'none';
  /** Whether the pouch is used on its own (the medic pouch). */
  medic?: boolean;
}

export function playerFor(entry: Entry, nature: NatureId, opts: PlayerOptions): PlayerSnapshot {
  const c = entry.cl - (opts.below ?? 0);
  const levels = levelsFor(c, nature);
  const known = knownFor(levels, nature);
  const mastery: Record<string, number> = {};
  for (const id of known) mastery[id] = opts.mastery ?? 20;
  const tier = opts.tier ?? 1;
  if (opts.knowledge === undefined && opts.prep === 'auto') opts = { ...opts, knowledge: 'none' };
  const snap: PlayerSnapshot = {
    levels,
    mastery,
    known,
    natures: [nature],
    costMod: { chakra: 1, stamina: 1 },
    tier,
  };
  const limits = loadoutLimits(tier, content);
  const visible: readonly string[] = content.ai.visibleTraits;
  const everything =
    opts.knowledge === 'none'
      ? entry.traits.filter((t) => visible.includes(t))
      : [...entry.traits, 'special'];
  snap.knowledge = { [entry.id]: everything };
  if (opts.prep === 'auto') {
    snap.loadout = autoLoadout(snap, limits, null, content);
    return snap;
  }
  const target = planTarget(entry, everything, nature, content);
  // The chunin vest adds a pouch slot.
  const slots = [...content.pouchKinds.flatMap((k) => Array<string>(k.slots).fill(k.id))];
  if (tier >= 2)
    slots.push(...content.pouchKinds.flatMap((k) => Array<string>(k.vest ?? 0).fill(k.id)));
  const plan = prepareFor(snap, limits, target, wellStocked(c), slots, null, content);
  snap.loadout = plan.techniques;
  if (opts.prep === 'prepared') {
    snap.pouch = plan.pouch;
    if (opts.medic !== false) {
      const heal = plan.pouch.findIndex((p) => p.id === healItemFor(c));
      snap.medic = heal >= 0 ? heal : null;
    }
  }
  return snap;
}

export function simulate(entry: Entry, snap: PlayerSnapshot, n = 400, seed = 1): FightSummary {
  // The rival's nature is the one the team gives: the one that beats the player's first.
  const first = snap.natures[0];
  const rival =
    'special' in entry && entry.special.kind === 'rival' && first ? beater(first) : null;
  return simulateFights(snap, encounterFor(entry, content, [], rival), n, seed, content, rules);
}

export const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
