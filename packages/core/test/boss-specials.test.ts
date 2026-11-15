/** The seven kinds of boss special (and the rival's second form) as fight hooks, driven by the content data. */
import { content, type Boss } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  alive,
  createFight,
  encounterFor,
  fightAdvance,
  findEffect,
  stat,
  workOf,
  type FightState,
  type PlayerSnapshot,
} from '../src/index.ts';
import { bossNature } from '../src/index.ts';
import { fighter, startFight, unlock } from './prep-state.ts';
import { K, ctxOf, quiet, rules, scripted, sec, withAi } from './fight-helpers.ts';

const boss = (id: string): Boss => {
  const b = content.bosses.find((x) => x.id === id);
  if (!b) throw new Error(`no boss ${id}`);
  return b;
};

/** A player who cannot be hurt, so a mechanic can be watched without the fight ending. */
function watched(
  id: string,
  snap: PlayerSnapshot = scripted(['core:leaf_whirlwind']),
  seed = 3,
): FightState {
  const fight = createFight(snap, encounterFor(boss(id), content), seed, content, rules);
  fight.player.hp = fight.player.maxHp = 1e12;
  fight.player.damage = 0;
  return fight;
}

const advanceBy = (f: FightState, seconds: number, r = rules) =>
  fightAdvance(f, sec(seconds), content, r);
const wait = withAi(() => ({ type: 'wait' }), rules);

describe('the pack respawn of the wolf leader', () => {
  it('builds a leader with the boss numbers and a pack of the configured size', () => {
    const f = watched('core:boss_wolf');
    const [lead, ...pack] = f.enemies;
    expect(lead?.specials).toContain('special:packRespawn');
    expect(pack).toHaveLength(K.bossFx.wolfPack!.count);
    expect(lead?.maxHp).toBeCloseTo(
      (K.eHp[0] + K.eHp[1] * 22) * K.boss.hp * K.bossFx.wolfPack!.leaderHp,
      6,
    );
    expect(pack[0]?.maxHp).toBeCloseTo((K.eHp[0] + K.eHp[1] * 22) * K.bossFx.wolfPack!.hp, 6);
  });

  it('calls the pack back at intervals while the leader lives, and stops when he falls', () => {
    const f = watched('core:boss_wolf');
    quiet(f);
    f.player.damage = 0;
    const wolves = () =>
      f.enemies.filter((e) => alive(e) && e.specials.includes('special:packMember'));
    for (const e of wolves()) e.hp = 0;
    expect(wolves()).toHaveLength(0);
    advanceBy(f, K.bossFx.wolfPack!.everyMs / 1000 + 1, wait);
    expect(wolves()).toHaveLength(K.bossFx.wolfPack!.count);
    // The leader falls: no more wolves come back.
    const lead = f.enemies[0];
    if (!lead) throw new Error('no leader');
    for (const e of wolves()) e.hp = 0;
    lead.hp = 0;
    advanceBy(f, (2 * K.bossFx.wolfPack!.everyMs) / 1000, wait);
    expect(wolves()).toHaveLength(0);
  });

  it('is aimed at by the AI: the leader is the body the fight turns on', () => {
    const f = watched('core:boss_wolf');
    advanceBy(
      f,
      1,
      withAi((view) => {
        expect(view.enemies.find((e) => e.leader)?.id).toBe(f.enemies[0]?.id);
        return { type: 'wait' };
      }),
    );
  });
});

describe('the rival', () => {
  it('fights with the nature the team selector gives him: the one that beats the first nature of the player', () => {
    const state = fighter(1, 20, 'katon');
    // Suiton beats Katon.
    expect(bossNature(state, boss('core:boss_ren1'))).toBe('suiton');
    expect(state.team?.rival).toBe('suiton');
    startBoss(state);
    expect(state.combat?.fight.enemies[0]?.nature).toBe('suiton');
    // A player with no nature has no rival nature yet, and no placeholder stands in for it.
    const none = fighter(2, 20, 'katon');
    none.player.natures = [];
    none.team = null;
    startBoss(none);
    expect(none.combat?.fight.enemies[0]?.nature).toBeNull();
  });

  it('keeps a timer for each of its techniques and one for the signature that opens the fight', () => {
    const duel = watched('core:boss_ren1', { ...scripted([]), natures: [] });
    expect(
      Object.keys(duel.enemies[0]?.timers ?? {}).filter(
        (n) => n.startsWith('rival.') && n !== 'rival.sig',
      ),
    ).toHaveLength(K.bossFx.rivalDuel!.techniques);
    const tournament = watched('core:boss_ren2', { ...scripted([]), natures: [] });
    expect(
      Object.keys(tournament.enemies[0]?.timers ?? {}).filter(
        (n) => n.startsWith('rival.') && n !== 'rival.sig',
      ),
    ).toHaveLength(K.bossFx.rivalTournament!.techniques);
    const sig = duel.enemies[0]?.timers['rival.sig'];
    // The signature is ready soon after the start.
    expect((sig?.need ?? 0) - (sig?.progress ?? 0)).toBeLessThanOrEqual(2 * 1000 * 1000 * 1000);
  });

  it('strikes with its techniques at their cadence', () => {
    const f = watched('core:boss_ren1', { ...scripted([]), natures: [] });
    f.enemies[0]!.accuracy = 1e9;
    f.player.evasion = 0;
    f.enemies[0]!.timer.need = 1e18;
    advanceBy(f, 40, wait);
    expect(f.tally.taken).toBeGreaterThan(0);
  });

  it('makes the player techniques wear off faster in the tournament, and not in the duel', () => {
    const used = (id: string) => {
      const f = watched(id, { ...scripted(['core:dynamic_entry']), natures: [] });
      f.uses['core:dynamic_entry'] = 2;
      let expected = 0;
      advanceBy(
        f,
        0.1,
        withAi((view) => {
          expected = view.techniques[0]?.expected ?? 0;
          return { type: 'wait' };
        }),
      );
      return expected;
    };
    const duel = used('core:boss_ren1');
    const tournament = used('core:boss_ren2');
    expect(tournament).toBeLessThan(duel);
  });
});

describe('the drunken fighter: evasion grows with the health he has lost', () => {
  it('ramps from the Evasive factor at full health to the special maximum at none, and a bind ends it', () => {
    const f = watched('core:boss_fighter');
    const body = f.enemies[0];
    if (!body) throw new Error('no body');
    const base = body.evasion;
    const at = (share: number) => {
      body.hp = body.maxHp * share;
      return stat(ctxOf(f), body, 'evasion', base) / base;
    };
    expect(at(1)).toBeCloseTo(K.trait.evasive, 9);
    expect(at(0.5)).toBeCloseTo((K.trait.evasive! + K.bossFx.drunkenEvasion!.maxMult) / 2, 9);
    expect(at(0)).toBeCloseTo(K.bossFx.drunkenEvasion!.maxMult, 9);
    body.hp = body.maxHp * 0.5;
    body.effects.push({
      kind: 'modifier',
      id: 'bind',
      src: 'x',
      until: sec(60),
      suppresses: 'evasive',
      stat: 'evasion',
      op: 'mul',
      value: K.bindEva,
    });
    expect(stat(ctxOf(f), body, 'evasion', base) / base).toBeCloseTo(K.bindEva, 9);
  });
});

describe('the heavy cast of the hunter', () => {
  const fx = K.bossFx.heavyCast;

  it('winds up for its time, hits for the multiple and stuns the player unless interrupted', () => {
    const f = watched('core:boss_hunter');
    const body = f.enemies[0];
    if (!body) throw new Error('no body');
    quiet(f);
    f.player.hp = f.player.maxHp = 1e12;
    body.timer.need = 1e18;
    // Not casting yet: the view shows no cast, but the timer is waiting.
    advanceBy(f, fx!.everyMs / 1000 - 0.1, wait);
    expect(body.data['caster.cast']).toBe(0);
    advanceBy(f, 0.2, wait);
    expect(body.data['caster.cast']).toBe(1);
    const before = f.tally.taken;
    advanceBy(f, fx!.castMs / 1000 + 0.1, wait);
    expect(f.tally.taken - before).toBeCloseTo(body.damage * fx!.damageMult, 6);
    const stun = findEffect(f.player, 'stun');
    expect(stun?.kind === 'modifier' ? stun.value : 1).toBe(0);
    expect(stun?.until).toBe(sec((fx!.everyMs + fx!.castMs + fx!.stunMs) / 1000));
  });

  it('does nothing when the cast is interrupted', () => {
    const f = watched('core:boss_hunter', scripted(['core:dynamic_entry']));
    const body = f.enemies[0];
    if (!body) throw new Error('no body');
    quiet(f);
    f.player.hp = f.player.maxHp = 1e12;
    body.timer.need = 1e18;
    f.player.accuracy = 1e9;
    body.evasion = 0;
    // The chunin tactics interrupt every wind-up they can; an interrupted cast never lands or stuns.
    advanceBy(f, 60, rules);
    expect(f.tally.interrupts).toBeGreaterThan(0);
    expect(f.tally.taken).toBe(0);
    expect(findEffect(f.player, 'stun')).toBeUndefined();
  });
});

describe('the twins', () => {
  it('are two bodies of a share of the boss health each, and poison the player while both fight', () => {
    const f = createFight(
      scripted(['core:leaf_whirlwind']),
      encounterFor(boss('core:boss_twins'), content),
      3,
      content,
      rules,
    );
    expect(f.enemies).toHaveLength(K.bossFx.twins!.count);
    const hp = (K.eHp[0] + K.eHp[1] * 38) * K.boss.hp * K.bossFx.twins!.hpEach;
    expect(f.enemies[0]?.maxHp).toBeCloseTo(hp, 6);
    const mist = findEffect(f.player, 'twinMist');
    expect(mist).toMatchObject({ kind: 'periodic', mode: 'damage', until: null });
    expect(mist?.kind === 'periodic' ? mist.amount : 0).toBeCloseTo(
      K.poison.pctPerSec * f.player.maxHp * K.bossFx.twins!.mistMult,
      6,
    );
    f.enemies.forEach((e) => (e.timer.need = 1e18));
    advanceBy(f, 3, wait);
    expect(f.tally.taken).toBeCloseTo(3 * (mist?.kind === 'periodic' ? mist.amount : 0), 6);
  });

  it('end the mist when one of them leaves the fight', () => {
    const f = watched('core:boss_twins');
    quiet(f);
    f.player.hp = f.player.maxHp = 1e12;
    const first = f.enemies[0];
    if (!first) throw new Error('no twin');
    first.hp = 1e-9;
    f.enemies.forEach((e) => (e.timer.need = 1e18));
    // The twin falls to the next tick of anything that hurts it.
    first.effects.push({
      kind: 'periodic',
      id: 'burn',
      src: 'x',
      until: sec(60),
      mode: 'damage',
      amount: 1,
      every: sec(1),
      next: sec(1),
    });
    advanceBy(f, 2, wait);
    expect(alive(first)).toBe(false);
    expect(findEffect(f.player, 'twinMist')).toBeUndefined();
  });
});

describe('the mist fugitive', () => {
  it('hides again and binds the player at intervals, unless it is sensed', () => {
    const f = watched('core:boss_mist');
    const body = f.enemies[0];
    if (!body) throw new Error('no body');
    quiet(f);
    f.player.hp = f.player.maxHp = 1e12;
    body.timer.need = 1e18;
    // The hide from the start wears off; the first re-hide comes at the configured time.
    advanceBy(f, K.trait.hidden! + 1, wait);
    expect(findEffect(f.player, 'hidden')).toBeUndefined();
    expect(findEffect(f.player, 'bind')).toBeUndefined();
    advanceBy(f, K.bossFx.mistRehide!.everyMs / 1000 - K.trait.hidden! - 1 + 0.5, wait);
    expect(findEffect(f.player, 'hidden')).toBeDefined();
    const bind = findEffect(f.player, 'bind');
    expect(bind?.kind === 'modifier' ? bind.value : 1).toBe(K.bindEva);
    // A sensed body does not hide, but the prison still closes.
    advanceBy(f, K.bind.dur + K.trait.hidden! + 1, wait);
    expect(findEffect(f.player, 'hidden')).toBeUndefined();
    body.effects.push({
      kind: 'modifier',
      id: 'revealed',
      src: 'x',
      until: f.t + sec(60),
      stat: 'accuracy',
      op: 'mul',
      value: 1,
    });
    const next = 2 * sec(K.bossFx.mistRehide!.everyMs / 1000);
    advanceBy(f, (next - f.t) / sec(1) + 0.5, wait);
    expect(findEffect(f.player, 'hidden')).toBeUndefined();
    expect(findEffect(f.player, 'bind')).toBeDefined();
  });
});

describe('the Nameless', () => {
  it('casts an illusion on the special cadence and leaves at the threshold', () => {
    const f = watched('core:boss_nameless', {
      ...scripted([]),
      levels: { ...scripted([]).levels, med: 0 },
    });
    const body = f.enemies[0];
    if (!body) throw new Error('no body');
    quiet(f);
    f.player.hp = f.player.maxHp = 1e12;
    body.timer.need = 1e18;
    expect(body.fleeAt).toBe(K.bossFx.illusion!.fleeAtHp);
    expect(body.timers.illusionist?.need).toBe(workOf(K.bossFx.illusion!.everyMs) * 1000);
    advanceBy(f, K.bossFx.illusion!.everyMs / 1000 + 0.1, wait);
    expect(findEffect(f.player, 'illusion')).toBeDefined();
    expect(f.tally.statuses.illusion).toBe(1);
    // A hit that takes it to the threshold sends it away: the fight is over as a flight.
    body.hp = body.maxHp * (K.bossFx.illusion!.fleeAtHp + 0.001);
    body.effects.push({
      kind: 'periodic',
      id: 'burn',
      src: 'x',
      until: f.t + sec(10),
      mode: 'damage',
      amount: body.maxHp * 0.01,
      every: sec(1),
      next: f.t + sec(1),
    });
    advanceBy(f, 2, wait);
    expect(f.result).toBe('fled');
  });
});

function startBoss(state: Parameters<typeof startFight>[0]): void {
  unlock(state, 'boss.ren1.unlocked');
  startFight(state, 'core:zone_boss_ren1');
}
