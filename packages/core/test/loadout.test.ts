/** A3: the loadout: limits by rank, always-available techniques, the automatic loadout, the signature, `loadout.prepare`. */
import { content, type NatureId, type TagId, type TraitId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createFight,
  dispatch,
  effectiveLoadout,
  encounterFor,
  fightAdvance,
  loadoutLimits,
  pouchUse,
  refreshUnlocks,
  snapshotPlayer,
  workOf,
  xpAt,
  defaultRules,
  type GameState,
} from '../src/index.ts';
import { K, castSeq, quiet, withAi } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, ids, know, run, stock } from './prep-state.ts';

const tech = (id: string) => {
  const t = content.techniques.find((x) => x.id === id);
  if (!t) throw new Error(`no technique ${id}`);
  return t;
};
const loadout = (state: GameState): string[] => state.loadouts.active;
const attempt = (state: GameState, techniques: string[]) =>
  dispatch(state, { type: 'loadout.set', techniques }, content);

/** A fighter who knows techniques of two natures. */
function twoNatures(rank: 'genin' | 'chunin'): GameState {
  const state = fighter(1, 40, 'katon');
  state.player.rank = rank;
  setLevel(state, 'futon', 40);
  setLevel(state, 'raiton', 40);
  refreshUnlocks(state, content, true);
  return state;
}

describe('slots and natures by rank', () => {
  it('reads the limits from the balance extension: genin 4 and 1, chunin 5 and 2, a student none', () => {
    expect(loadoutLimits(0, content)).toBeNull();
    expect(loadoutLimits(1, content)).toEqual({ slots: 4, natures: 1 });
    expect(loadoutLimits(2, content)).toEqual({ slots: 5, natures: 2 });
  });

  it('refuses a fifth technique and a second nature at genin, and allows them at chunin', () => {
    const genin = twoNatures('genin');
    const five = [
      'core:leaf_whirlwind',
      'core:dynamic_entry',
      'core:leaf_gale',
      'core:shadow_shuriken',
      'core:leaf_great_whirlwind',
    ];
    expect(attempt(genin, five)).toEqual({ ok: false, reason: 'error.tooManyTechniques' });
    const fire = 'core:great_fireball';
    const wind = 'core:gale_palm';
    expect(attempt(genin, [fire, wind])).toEqual({ ok: false, reason: 'error.tooManyNatures' });
    expect(attempt(genin, [fire, 'core:phoenix_sage_fire']).ok).toBe(true);

    const chunin = twoNatures('chunin');
    expect(attempt(chunin, five).ok).toBe(true);
    expect(attempt(chunin, [fire, wind]).ok).toBe(true);
    // Techniques of a third nature come from scrolls; this one is simply known.
    const bolt = 'core:double_suicide_decapitation';
    chunin.known[bolt] = true;
    expect(attempt(chunin, [fire, wind, bolt])).toEqual({
      ok: false,
      reason: 'error.tooManyNatures',
    });
  });

  it('counts Taijutsu and non-elemental Ninjutsu as no nature at all', () => {
    const genin = fighter(1, 40, 'katon');
    // Four techniques with a single nature among them: Taijutsu, Ninjutsu and Katon.
    expect(
      attempt(genin, [
        'core:leaf_great_whirlwind',
        'core:shadow_shuriken',
        'core:great_fireball',
        'core:leaf_gale',
      ]).ok,
    ).toBe(true);
  });

  it('refuses a technique that is not known, one listed twice, and a student', () => {
    const genin = fighter(1, 10);
    expect(attempt(genin, ['core:great_fireball'])).toEqual({
      ok: false,
      reason: 'error.unknownTechnique',
    });
    expect(attempt(genin, ['core:leaf_whirlwind', 'core:leaf_whirlwind'])).toEqual({
      ok: false,
      reason: 'error.duplicateTechnique',
    });
    const student = fighter(1, 10);
    student.player.rank = 'student';
    expect(attempt(student, ['core:leaf_whirlwind'])).toEqual({
      ok: false,
      reason: 'error.noLoadoutYet',
    });
  });

  it('lets a student fight with everything they know', () => {
    const student = fighter(1, 20);
    student.player.rank = 'student';
    const snap = snapshotPlayer(student, content, defaultRules);
    expect(snap.loadout).toBeUndefined();
    expect(snap.known.length).toBeGreaterThan(5);
  });
});

describe('techniques outside the slots', () => {
  it('keeps Body Replacement out of the slots: it is passive and adds to the evasion instead', () => {
    const state = fighter(1, 40);
    const body = 'core:body_replacement';
    expect(state.known[body]).toBe(true);
    expect(attempt(state, [body])).toEqual({ ok: false, reason: 'error.passiveTechnique' });
    expect(loadout(state)).not.toContain(body);
    run(state, { type: 'loadout.set', techniques: ['core:leaf_whirlwind'] });
    const snap = snapshotPlayer(state, content, defaultRules);
    expect(snap.loadout).toEqual(['core:leaf_whirlwind']);
    const fight = createFight(
      snap,
      encounterFor(content.enemies[1] ?? content.enemies[0]!, content),
      1,
      content,
      defaultRules,
    );
    expect(fight.kit.techniques.map((t) => t.id)).toEqual(['core:leaf_whirlwind']);
    expect(fight.kit.evasion.some((p) => p.source === 'technique' && p.id === body)).toBe(true);
  });
});

describe('the automatic loadout', () => {
  it('is on from the start, never longer than the slots and with at most one nature at genin', () => {
    const state = fighter(1, 40);
    expect(state.loadouts.auto).toBe(true);
    expect(loadout(state).length).toBeLessThanOrEqual(4);
    expect(loadout(state).length).toBeGreaterThan(0);
    const natures = new Set(
      loadout(state)
        .map((id) => tech(id).skill)
        .filter((s) => (['katon', 'futon', 'raiton', 'doton', 'suiton'] as string[]).includes(s)),
    );
    expect(natures.size).toBeLessThanOrEqual(1);
  });

  it('picks the nature with the best total and builds without answering anything in particular', () => {
    const state = twoNatures('genin');
    run(state, { type: 'loadout.auto', on: true });
    const skills = loadout(state).map((id) => tech(id).skill);
    expect(skills.some((s) => s === 'katon' || s === 'futon' || s === 'raiton')).toBe(true);
    const natures = new Set(skills.filter((s) => ['katon', 'futon', 'raiton'].includes(s)));
    expect(natures.size).toBe(1);
  });

  it('is rebuilt when a technique is learned and left alone after a manual set', () => {
    const state = fighter(1, 20, 'katon');
    const before = [...loadout(state)];
    expect(before).not.toContain('core:great_fireball');
    // Learning the Great Fireball makes it the strongest attack.
    setLevel(state, 'katon', 40);
    refreshUnlocks(state, content);
    expect(state.known['core:great_fireball']).toBe(true);
    expect(loadout(state)).toContain('core:great_fireball');
    expect(loadout(state)).not.toEqual(before);

    run(state, { type: 'loadout.set', techniques: ['core:leaf_whirlwind'] });
    expect(state.loadouts.auto).toBe(false);
    setLevel(state, 'katon', 50);
    setLevel(state, 'tai', 50);
    refreshUnlocks(state, content);
    expect(loadout(state)).toEqual(['core:leaf_whirlwind']);
    // One call switches it on again and rebuilds at once.
    run(state, { type: 'loadout.auto', on: true });
    expect(loadout(state).length).toBeGreaterThan(1);
  });

  it('is rebuilt on promotion, which adds a slot', () => {
    const state = fighter(1, 40);
    expect(loadout(state)).toHaveLength(4);
    state.player.rank = 'chunin';
    refreshUnlocks(state, content);
    expect(loadout(state)).toHaveLength(5);
  });

  it('is rebuilt by the fight without touching the state when it went stale', () => {
    const state = fighter(1, 20, 'katon');
    setLevel(state, 'katon', 40);
    state.known['core:great_fireball'] = true;
    state.known['core:phoenix_sage_fire'] = true;
    const stale = [...loadout(state)];
    expect(effectiveLoadout(state, content)).toContain('core:great_fireball');
    expect(loadout(state)).toEqual(stale);
  });
});

describe('named loadouts and the signature', () => {
  it('saves up to five loadouts by name, loads, overwrites and deletes them', () => {
    const state = fighter(1, 40);
    for (const name of ['a', 'b', 'c', 'd', 'e']) run(state, { type: 'loadout.save', name });
    expect(dispatch(state, { type: 'loadout.save', name: 'f' }, content)).toEqual({
      ok: false,
      reason: 'error.tooManyLoadouts',
    });
    expect(dispatch(state, { type: 'loadout.save', name: 'a' }, content).ok).toBe(true);
    run(state, { type: 'loadout.set', techniques: ['core:leaf_whirlwind'] });
    run(state, { type: 'loadout.load', name: 'b' });
    expect(loadout(state).length).toBeGreaterThan(1);
    expect(state.loadouts.auto).toBe(false);
    run(state, { type: 'loadout.delete', name: 'b' });
    expect(dispatch(state, { type: 'loadout.load', name: 'b' }, content)).toEqual({
      ok: false,
      reason: 'error.noSuchLoadout',
    });
    expect(dispatch(state, { type: 'loadout.save', name: ' ' }, content).ok).toBe(false);
  });

  const sig = 'core:great_fireball';
  function withSignature(mastery: number): GameState {
    const state = fighter(1, 40);
    state.mastery[sig] = { xp: xpAt(mastery) };
    return state;
  }
  const masteryOf = (state: GameState, id: string) =>
    snapshotPlayer(state, content, defaultRules).mastery[id] ?? 1;

  it('needs Mastery 25 and a slot of the loadout', () => {
    const low = withSignature(10);
    expect(dispatch(low, { type: 'loadout.signature', technique: sig }, content)).toEqual({
      ok: false,
      reason: 'error.masteryTooLow',
    });
    const high = withSignature(K.signature.minMastery);
    expect(masteryOf(high, sig)).toBeGreaterThanOrEqual(K.signature.minMastery);
    run(high, { type: 'loadout.set', techniques: ['core:leaf_whirlwind', 'core:dynamic_entry'] });
    expect(dispatch(high, { type: 'loadout.signature', technique: sig }, content)).toEqual({
      ok: false,
      reason: 'error.notInLoadout',
    });
    run(high, { type: 'loadout.set', techniques: [sig, 'core:dynamic_entry'] });
    run(high, { type: 'loadout.signature', technique: sig });
    expect(high.loadouts.signature).toBe(sig);
  });

  it('slows habituation to it, opens the fight with it and gives it more Mastery XP', () => {
    const state = withSignature(K.signature.minMastery);
    run(state, { type: 'loadout.set', techniques: [sig, 'core:dynamic_entry', 'core:leaf_gale'] });
    run(state, { type: 'loadout.signature', technique: sig });
    const snap = snapshotPlayer(state, content, defaultRules);
    expect(snap.signature).toBe(sig);
    const enemy = content.enemies.find((e) => e.id === 'core:bandit');
    if (!enemy) throw new Error('no bandit');
    const fight = createFight(snap, encounterFor(enemy, content), 3, content, defaultRules);
    expect(fight.kit.techniques.find((t) => t.id === sig)?.habituationMult).toBe(
      K.signatureHabituation,
    );
    expect(fight.kit.techniques.find((t) => t.id === 'core:dynamic_entry')?.habituationMult).toBe(
      1,
    );
    // It is cast first, although another technique would hit harder against this enemy.
    fightAdvance(fight, workOf(3000), content, defaultRules);
    expect(fight.log?.find((l) => l.side === 'player' && l.act === 'cast')?.tech).toBe(sig);
  });

  it('pays a tenth more Mastery XP for the same time spent on the signature', () => {
    // An endless fight in which only the signature is cast: the two runs differ in the mark alone.
    const gained = (marked: boolean): number => {
      const s = withSignature(K.signature.minMastery);
      run(s, { type: 'loadout.set', techniques: [sig] });
      if (marked) run(s, { type: 'loadout.signature', technique: sig });
      const rules = withAi(castSeq(sig));
      dispatch(
        s,
        { type: 'action.start', slot: 0, kind: 'fight', id: 'core:bandit' },
        content,
        rules,
      );
      if (!s.combat) throw new Error('no fight');
      quiet(s.combat.fight);
      const before = s.mastery[sig]?.xp ?? 0;
      advance(s, 90_000, content, rules);
      return (s.mastery[sig]?.xp ?? 0) - before;
    };
    const plain = gained(false);
    expect(plain).toBeGreaterThan(0);
    expect(gained(true) / plain).toBeCloseTo(1 + K.signature.xpBonus, 6);
  });
});

describe('loadout.prepare against a known trait', () => {
  /** The enemy that carries each trait, and the items that answer it from the pouch. */
  const cases: [TraitId, string][] = [
    ['armor', 'core:heavy'],
    ['caster', 'core:kumo'],
    ['pack', 'core:wolf'],
    ['evasive', 'core:thief'],
    ['regen', 'core:centipede'],
    ['illusionist', 'core:fake_genin'],
    ['hidden', 'core:kiri_hunter'],
    ['poisoner', 'core:poisoner'],
  ];
  const itemFor: Partial<Record<TraitId, string>> = {
    caster: ids.kunai,
    pack: ids.tag,
    evasive: ids.wiretrap,
    regen: ids.poisonSenbon,
    illusionist: ids.salt,
    poisoner: ids.antidote,
  };

  const traitAnswer = (trait: string): TagId => {
    const answer = content.traits.find((t) => t.id === trait)?.answer;
    if (!answer) throw new Error(`no trait ${trait}`);
    return answer;
  };

  /** Whether the loadout or the pouch of the state answers the trait. */
  function answered(state: GameState, trait: TraitId): 'technique' | 'item' | null {
    const answer = traitAnswer(trait);
    for (const id of state.loadouts.active) {
      const t = tech(id);
      if (t.tags.includes(answer) || (trait === 'regen' && t.state === 'burn')) return 'technique';
    }
    for (const slot of state.pouch.slots) {
      const item = content.items.find((i) => i.id === slot.id);
      if (!item || slot.n < 1 || pouchUse(item) === null) continue;
      if (item.tags.includes(answer) || (trait === 'poisoner' && item.fx?.kind === 'cleanse')) {
        return 'item';
      }
      if (trait === 'illusionist' && item.fx?.kind === 'dispel') return 'item';
    }
    return null;
  }

  for (const [trait, enemy] of cases) {
    it(`includes an answer to ${trait} against ${enemy} when the player owns one`, () => {
      const known = fighter(1, 40, 'katon');
      // The player has beaten the enemy, so its traits are known.
      know(known, enemy);
      // Technique answers: Futon pierces and reveals, Katon burns and sweeps; tools answer the rest.
      setLevel(known, 'futon', 40);
      known.player.rank = 'chunin';
      refreshUnlocks(known, content, true);
      const hasTechnique =
        ['armor', 'hidden'].includes(trait) || trait === 'regen' || trait === 'pack';
      if (!hasTechnique) delete known.known['core:sensing'];
      stock(known, { [ids.heal]: 4, ...(itemFor[trait] ? { [itemFor[trait] as string]: 4 } : {}) });
      run(known, { type: 'loadout.prepare', encounter: enemy });
      expect(answered(known, trait), `${trait} unanswered`).not.toBeNull();
      expect(known.loadouts.auto).toBe(false);
    });
  }

  it('answers a trait with a tool alone when the player has no technique for it', () => {
    for (const trait of [
      'caster',
      'pack',
      'evasive',
      'regen',
      'illusionist',
      'poisoner',
    ] as TraitId[]) {
      const enemy = cases.find(([t]) => t === trait)?.[1] ?? '';
      const state = fighter(1, 12, 'katon');
      state.player.rank = 'genin';
      know(state, enemy);
      // No technique of the player answers the trait.
      for (const id of Object.keys(state.known)) {
        const t = content.techniques.find((x) => x.id === id);
        if (
          t &&
          (t.tags.includes(traitAnswer(trait)) || (trait === 'regen' && t.state === 'burn'))
        ) {
          delete state.known[id];
        }
      }
      stock(state, { [ids.heal]: 4, [itemFor[trait] as string]: 4 });
      run(state, { type: 'loadout.prepare', encounter: enemy });
      expect(answered(state, trait), trait).toBe('item');
    }
  });

  it('does not answer a trait it does not know yet, and puts the healing item first', () => {
    const state = fighter(1, 36, 'katon');
    stock(state, { [ids.heal]: 4, [ids.kunai]: 4, [ids.tag]: 4 });
    run(state, { type: 'loadout.prepare', encounter: 'core:kumo' });
    // Seen (it was fought), not beaten: the caster trait is still hidden.
    expect(state.pouch.slots[0]?.id).toBe(ids.heal);
    // No area tool for a pack the enemy does not have, and no technique picked only to interrupt.
    expect(state.pouch.slots.find((s) => s.id === ids.tag)).toBeUndefined();
    const interruptOnly = loadout(state).filter((id) => {
      const t = tech(id);
      return t.tags.includes('interrupt') && !t.tags.includes('pierce');
    });
    expect(interruptOnly.length).toBeLessThanOrEqual(2);
  });

  it('packs the pouch from the bank and refuses to do so mid-fight', () => {
    const state = fighter(1, 36, 'katon');
    stock(state, { [ids.heal]: 14 });
    run(state, { type: 'loadout.prepare', encounter: 'core:zone_kumo' });
    // The food slot takes its per-fight amount from the bank.
    expect(state.pouch.slots[0]).toEqual({ kind: 'core:pk_food', id: ids.heal, n: 10 });
    expect(state.bank[ids.heal]).toBe(4);
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:bandit' }, content);
    expect(dispatch(state, { type: 'loadout.prepare', encounter: 'core:kumo' }, content)).toEqual({
      ok: false,
      reason: 'error.fighting',
    });
  });
});

export type { NatureId };
