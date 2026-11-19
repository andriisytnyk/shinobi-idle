/**
 * The digest a caller keeps forecasts by (`missionInputs`) changes with every input of a forecast:
 * each input is changed in turn and the digest must differ. Modifiers of any source (gear, tonics,
 * the village, the world) are in it because it reads the rule set's providers, not a hand-kept list.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  currencyOf,
  defaultRules,
  missionForecast,
  missionInputs,
  skillLevel,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { ableFor } from './missions-helpers.ts';
import { BOARD } from './missions-states.ts';

const base = (): GameState => ableFor(BOARD[0] as (typeof BOARD)[number]);
const digest = (s: GameState): string => missionInputs(s, content, defaultRules);

const tonic = content.items.find((i) => i.fx?.kind === 'tonic');
const ration = content.items.find((i) => i.fx?.kind === 'ration');
const gearLine = content.gear.find((g) => g.fx !== undefined) ?? content.gear[0];
const training = content.cells.flatMap((c) =>
  c.pois.flatMap((p) => (p.kind === 'training' ? [{ cell: c.id, poi: p.id }] : [])),
);
const itemsStage = content.missions.flatMap((m) =>
  m.stages.flatMap((s) => (s.t === 'items' ? [s] : [])),
)[0];

const CHANGES: Record<string, (s: GameState) => void> = {
  'a skill level': (s) => {
    const skill = content.skills[0]?.id ?? '';
    s.skills[skill]!.xp = xpAt(skillLevel(s, skill, content) + 5);
  },
  'a technique known': (s) => {
    const id = content.techniques.find((t) => !s.known[t.id])?.id ?? '';
    s.known[id] = true;
  },
  Mastery: (s) => {
    const id = Object.keys(s.known)[0] ?? '';
    s.mastery[id] = { xp: 1e9 } as never;
  },
  'the rank': (s) => {
    s.player.rank = content.playerRanks[0]?.id ?? '';
  },
  'a nature': (s) => {
    s.player.natures = [...s.player.natures, 'raiton'];
  },
  'the team': (s) => {
    s.team = null;
  },
  'a flag': (s) => {
    s.flags['x.test.flag'] = true;
  },
  'the loadout': (s) => {
    s.loadouts.auto = false;
    s.loadouts.active = [];
  },
  'a building': (s) => {
    const village = s.village;
    const id = content.buildings[0]?.id ?? '';
    if (village) village.levels[id] = (village.levels[id] ?? 0) + 1;
  },
  Intel: (s) => {
    s.currencies[currencyOf(content, 'study') ?? ''] = 777;
  },
  'an item a stage takes': (s) => {
    s.bank[itemsStage?.item ?? ''] = (s.bank[itemsStage?.item ?? ''] ?? 0) + 3;
  },
  'a ration in the bank': (s) => {
    s.bank[ration?.id ?? ''] = 4;
  },
  'the armed ration': (s) => {
    s.buffs[ration?.id ?? ''] = { skill: 'mission', charges: 2 };
  },
  gear: (s) => {
    s.gear[gearLine?.id ?? ''] = 1;
  },
  'a tonic': (s) => {
    s.buffs[tonic?.id ?? ''] = { skill: content.skills[0]?.id ?? '', charges: 5 };
  },
  'a training spot of the world': (s) => {
    const spot = training[0];
    if (!spot) return;
    s.world.location = spot.cell;
    s.world.pois[spot.poi] = true;
  },
};

describe('missionInputs', () => {
  for (const [name, change] of Object.entries(CHANGES)) {
    it(`changes with ${name}`, () => {
      const s = base();
      const before = digest(s);
      change(s);
      expect(digest(s)).not.toBe(before);
    });
  }

  it('is the same for the same state, and moves when a forecast moves', () => {
    const s = base();
    expect(digest(s)).toBe(digest(structuredClone(s)));
    const m = BOARD[0] as (typeof BOARD)[number];
    const before = missionForecast(s, m, content, defaultRules).expectedMs;
    if (ration) s.buffs[ration.id] = { skill: 'mission', charges: 1 };
    expect(missionForecast(s, m, content, defaultRules).expectedMs).toBeLessThan(before);
  });
});
