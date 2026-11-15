/** A8: the team's support in the fights of team missions. */
import { content, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  alive,
  createFight,
  encounterFor,
  parseFight,
  type FightState,
  type TeamSupport,
} from '../src/index.ts';
import { K, castSeq, quiet, pacify, runUntil, scripted, sec, withAi } from './fight-helpers.ts';
import { player, startMission } from './missions-helpers.ts';

const bandit = content.enemies.find((e) => e.id === 'core:bandit');

const support = (...natures: NatureId[]): TeamSupport[] =>
  natures.map((nature) => ({ nature, ...K.team.support }));

/** A fight of a scripted player against a bandit with the given supports; the enemy has endless health and does not strike. */
function fightWith(supports: TeamSupport[], known: string[] = [], seed = 1): FightState {
  if (!bandit) throw new Error('no bandit');
  const encounter = encounterFor(bandit, content, [], null, supports);
  const fight = createFight(scripted(known), encounter, seed, content, withAi(castSeq(...known)));
  pacify(quiet(fight));
  // The player still hurts a little, so that the supports have a basic damage to scale.
  fight.player.damage = 10;
  return fight;
}

const teamHits = (fight: FightState, nature: string): number =>
  fight.tally.damage[`team:${nature}`] ?? 0;

describe('A8: team support', () => {
  it('hits at its interval: the first teammate at each period, the second half a period later', () => {
    const fight = fightWith(support('suiton', 'raiton'));
    const rules = withAi(castSeq());
    const every = K.team.support.everyMs;
    runUntil(fight, (f) => teamHits(f, 'suiton') > 0, rules, content, sec(60));
    expect(fight.t).toBe(sec(every / 1000));
    expect(teamHits(fight, 'raiton')).toBe(0);
    runUntil(fight, (f) => teamHits(f, 'raiton') > 0, rules, content, sec(60));
    expect(fight.t).toBe(sec((every * 1.5) / 1000));
    // Then each every `every` ms again.
    const first = teamHits(fight, 'suiton');
    runUntil(fight, (f) => teamHits(f, 'suiton') > first, rules, content, sec(60));
    expect(fight.t).toBe(sec((every * 2) / 1000));
  });

  it('applies the status of its nature: burn, wet and stun', () => {
    const rules = withAi(castSeq());
    for (const [nature, effect] of [
      ['katon', 'burn'],
      ['suiton', 'wet'],
      ['raiton', 'stun'],
    ] as const) {
      const fight = fightWith(support(nature));
      runUntil(fight, (f) => teamHits(f, nature) > 0, rules, content, sec(60));
      expect(fight.enemies.every((e) => !alive(e) || e.effects.some((x) => x.id === effect))).toBe(
        true,
      );
      expect(fight.tally.statuses[effect]).toBe(1);
    }
    // Futon and Doton make no state: the hit only hurts.
    const wind = fightWith(support('futon'));
    runUntil(wind, (f) => teamHits(f, 'futon') > 0, rules, content, sec(60));
    expect(wind.enemies[0]?.effects).toEqual([]);
  });

  it('lets a status combo with the player technique fire: Aya wets, Katon turns it to steam', () => {
    let steam = 0;
    for (let seed = 1; seed <= 200 && steam === 0; seed++) {
      const fight = fightWith(support('suiton'), ['core:great_fireball'], seed);
      runUntil(
        fight,
        (f) => (f.tally.combos.steam ?? 0) > 0,
        withAi(castSeq('core:great_fireball')),
        content,
        sec(120),
      );
      steam = fight.tally.combos.steam ?? 0;
    }
    expect(steam).toBeGreaterThan(0);
  });

  it('has no combo without the teammate', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const fight = fightWith([], ['core:great_fireball'], seed);
      runUntil(fight, () => false, withAi(castSeq('core:great_fireball')), content, sec(60));
      expect(fight.tally.combos.steam ?? 0).toBe(0);
      expect(teamHits(fight, 'suiton')).toBe(0);
    }
  });

  /** Runs a mission to its fight and watches it second by second; returns what the fight showed. */
  function watchFight(id: string) {
    const state = player({
      natures: ['katon'],
      levels: { scout: 20, ath: 25, tai: 25, vit: 20, eva: 20, katon: 20, doton: 1 },
      bank: { 'core:antidote': 5 },
    });
    startMission(state, id);
    const seen = { fight: false, support: [] as string[], special: false, teamDamage: false };
    for (let i = 0; i < 40 * 60; i++) {
      advance(state, 1000, content);
      const c = state.combat;
      if (!c) continue;
      seen.fight = true;
      seen.support = (c.fight.encounter.support ?? []).map((x) => x.nature);
      seen.special ||= c.fight.player.specials.includes('special:team');
      seen.teamDamage ||= Object.keys(c.fight.tally.damage).some((k) => k.startsWith('team:'));
      if (seen.teamDamage) break;
    }
    return { seen, state };
  }

  it('is in the fight of a team mission', () => {
    const { seen, state } = watchFight('core:caravan');
    expect(seen.fight).toBe(true);
    const natures = state.team ? [state.team.rival, state.team.aya] : [];
    expect(seen.support).toEqual(natures);
    expect(seen.special).toBe(true);
    expect(seen.teamDamage).toBe(true);
  });

  it('is absent from the fight of a solo mission', () => {
    const { seen } = watchFight('core:thief');
    expect(seen.fight).toBe(true);
    expect(seen.support).toEqual([]);
    expect(seen.special).toBe(false);
    expect(seen.teamDamage).toBe(false);
  });

  it('reads back from a save with its supports', () => {
    const fight = fightWith(support('katon', 'suiton'));
    const again = parseFight(JSON.parse(JSON.stringify(fight)), content);
    expect(again?.encounter.support).toEqual(fight.encounter.support);
    const broken = JSON.parse(JSON.stringify(fight)) as { encounter: { support: unknown } };
    broken.encounter.support = [{ nature: 'nope', everyMs: 1, damage: 1 }];
    expect(parseFight(broken, content)).toBeNull();
  });

  it('follows the natures the team selector gives: the rival beats the first nature, Aya is Suiton or Raiton', () => {
    const state = player({ natures: ['doton'], levels: { scout: 20, vit: 20, eva: 20 } });
    expect(state.team).toEqual({ rival: 'raiton', aya: 'suiton' });
    const katon = player({ natures: ['katon'] });
    expect(katon.team?.aya).toBe('raiton');
  });
});
