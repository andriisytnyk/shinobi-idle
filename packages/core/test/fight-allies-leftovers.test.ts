/**
 * Combat allies, leftovers of the review of #127: how a body left the fight (dispelled or struck down) is kept and read back,
 * a body is named by the technique that summoned it (from data), and the summon's numbers come from one place.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  allyNameKey,
  dealDamage,
  defaultRules,
  deserialize,
  makeCtx,
  serialize,
  summonSpecOf,
} from '../src/index.ts';
import { fighter, run, startFight } from './prep-state.ts';

const CLONE = 'core:shadow_clone';
type State = ReturnType<typeof fighter>;

function cloned(seed = 2): State {
  const state = fighter(seed, 40);
  state.known[CLONE] = true;
  state.mastery[CLONE] = { xp: 0 } as never;
  run(state, { type: 'loadout.prepare', encounter: 'core:zone_foreign_genin' });
  startFight(state, 'core:zone_foreign_genin');
  for (let i = 0; i < 90 && (state.combat?.fight.allies?.length ?? 0) < 2; i++) {
    advance(state, 1000, content);
  }
  return state;
}

describe('how a body left the fight', () => {
  it('reads «struck» for a body that took a lethal blow, and nothing while it stands', () => {
    const state = cloned();
    const fight = state.combat?.fight;
    const [first, second] = fight?.allies ?? [];
    if (!fight || !first || !second) throw new Error('need two bodies');
    expect(first.ally?.out).toBeUndefined();
    dealDamage(makeCtx(fight, content, defaultRules), first, 1e12, 'test');
    expect(first.hp).toBe(0);
    expect(first.ally?.out).toBe('struck');
    expect(second.ally?.out).toBeUndefined();
  });

  it('reads «dispelled» for a body whose chakra and stamina ran out, in a real run', () => {
    const state = cloned();
    const fight = state.combat?.fight;
    const [first, second] = fight?.allies ?? [];
    if (!fight || !first || !second) throw new Error('need two bodies');
    first.chakra = 0;
    first.stamina = 0;
    for (let i = 0; i < 40 && first.hp > 0; i++) advance(state, 500, content);
    expect(first.hp).toBe(0);
    expect(first.ally?.out).toBe('dispelled');
    // The other body did not run dry (it may have fallen to a blow, but not by running out).
    expect(second.ally?.out).not.toBe('dispelled');
  });

  it('is saved and read back, and a fight saved without it loads', () => {
    const state = cloned();
    const fight = state.combat?.fight;
    const first = fight?.allies?.[0];
    if (!fight || !first) throw new Error('no body');
    dealDamage(makeCtx(fight, content, defaultRules), first, 1e12, 'test');
    const copy = deserialize(serialize(state), content);
    expect(copy.combat?.fight.allies?.[0]?.ally?.out).toBe('struck');
    expect(serialize(copy)).toBe(serialize(state));
    const raw = JSON.parse(serialize(state)) as {
      state: { combat: { fight: { allies: { ally: { out?: string } }[] } } };
    };
    for (const a of raw.state.combat.fight.allies) delete a.ally.out;
    const old = deserialize(JSON.stringify(raw), content);
    expect(old.combat?.fight.allies?.length).toBe(fight.allies?.length);
    expect(old.combat?.fight.allies?.[0]?.ally?.out).toBeUndefined();
  });
});

describe('a body is named by what summoned it', () => {
  it('takes the name key from the summon data, and none from a summon that names none', () => {
    expect(allyNameKey(content, CLONE)).toBe('fight.ally');
    expect(allyNameKey(content, 'core:great_fireball')).toBeNull();
    expect(allyNameKey(content, 'mod:gone')).toBeNull();
    const mod = {
      ...content,
      techniques: content.techniques.map((t) =>
        t.id === CLONE && t.combat?.effect.kind === 'summon'
          ? {
              ...t,
              combat: { ...t.combat, effect: { kind: 'summon' as const, fx: t.combat.effect.fx } },
            }
          : t,
      ),
    };
    expect(allyNameKey(mod, CLONE)).toBeNull();
    const named = {
      ...content,
      techniques: content.techniques.map((t) =>
        t.id === CLONE && t.combat?.effect.kind === 'summon'
          ? {
              ...t,
              combat: {
                ...t.combat,
                effect: { kind: 'summon' as const, fx: t.combat.effect.fx, allyName: 'mod.puppet' },
              },
            }
          : t,
      ),
    };
    expect(allyNameKey(named, CLONE)).toBe('mod.puppet');
  });

  it('puts the kind on the log lines of an ally', () => {
    const state = cloned();
    const fight = state.combat?.fight;
    if (!fight) throw new Error('no fight');
    fight.log = [];
    state.events = [];
    for (let i = 0; i < 20; i++) advance(state, 500, content);
    // The system hands the lines to the event queue as it goes.
    const lines = state.events.flatMap((e) =>
      e.type === 'combatLog' && e.ally !== undefined ? [e] : [],
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.allyKind === CLONE)).toBe(true);
  });
});

describe('the numbers of a summon', () => {
  it('are one function for the fight and the technique page', () => {
    const row = content.balance.K.techFx.combatClone;
    if (!row) throw new Error('no row');
    const low = summonSpecOf(content, 'combatClone', 1);
    expect(low.count).toBe(
      Math.min(row.max ?? 1, Math.floor((row.count ?? 1) + 1 / (row.masteryStep ?? 1))),
    );
    expect(low.hp).toBe(row.hp);
    expect(low.dmg).toBe(row.dmg);
    expect(low.threat).toBe(row.threat);
    expect(summonSpecOf(content, 'combatClone', 1e6).count).toBe(row.max);
    expect(() => summonSpecOf(content, 'nothing', 1)).toThrow();
  });
});
