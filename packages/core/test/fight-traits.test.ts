/** A5: one test per enemy trait and its answer, with the numbers of the balance object. */
import { content, type TraitId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createFight,
  defaultCombatAi,
  fightAdvance,
  findEffect,
  needOf,
  stat,
  statOf,
  type FightState,
  type FightView,
  type KitTechnique,
  type ViewEnemy,
  type ViewTechnique,
} from '../src/index.ts';
import {
  K,
  castAndHit,
  castOnce,
  castSeq,
  ctxOf,
  enemyAt,
  pacify,
  quiet,
  rules,
  scripted,
  sec,
  syntheticTechnique,
  tech,
  withAi,
  withTechniques,
  runUntil,
} from './fight-helpers.ts';

const chunin = content.ai.tiers.find((t) => t.id === 'chunin');
if (!chunin) throw new Error('no chunin AI tier');

const LEVEL = 34;
const enemyHp = K.eHp[0] + K.eHp[1] * LEVEL;
const enemyDamage = K.eDmg[0] + K.eDmg[1] * LEVEL;
const enemyEvasion = K.eEva[0] + K.eEva[1] * LEVEL;

describe('Armor (answer: pierce)', () => {
  const dyn = 'core:dynamic_entry';
  const palm = 'core:gale_palm';

  it('cuts incoming damage by the armour share', () => {
    const { fight } = castAndHit(
      { known: [dyn], enemy: enemyAt(LEVEL, ['armor']), ai: () => castOnce(dyn) },
      dyn,
    );
    expect(fight.tally.damage[dyn]).toBeCloseTo(tech(fight, dyn).damage * (1 - K.trait.armor), 8);
  });

  it('is ignored by a pierce hit, which switches it off for the configured time', () => {
    const { fight } = castAndHit(
      { known: [palm, dyn], enemy: enemyAt(LEVEL, ['armor']), ai: () => castOnce(palm) },
      palm,
    );
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    expect(fight.tally.damage[palm]).toBeCloseTo(tech(fight, palm).damage, 8);
    const off = findEffect(enemy, 'armorOff');
    expect(off?.until).toBe(fight.t + sec(K.trait.armorOff));
    expect(stat(ctxOf(fight), enemy, 'damageTaken', 1)).toBe(1);
    expect(fight.tally.statuses.armorBreak).toBe(1);
    // After the window the armour is back.
    fightAdvance(
      fight,
      sec(K.trait.armorOff),
      content,
      withAi(() => ({ type: 'basic' })),
    );
    expect(findEffect(enemy, 'armorOff')).toBeUndefined();
    expect(stat(ctxOf(fight), enemy, 'damageTaken', 1)).toBeCloseTo(1 - K.trait.armor, 12);
  });
});

describe('Caster (answer: interrupt)', () => {
  const dyn = 'core:dynamic_entry';
  const heavy = enemyDamage * K.trait.casterMult;
  /** Plays to just after the first heavy attack would land; ordinary enemy attacks are off. */
  const play = (known: string[], seed: number): FightState => {
    const fight = quiet(
      pacify(createFight(scripted(known), enemyAt(LEVEL, ['caster']), seed, content, rules)),
    );
    fightAdvance(fight, sec(K.trait.casterEvery + K.trait.casterCast + 1), content, rules);
    return fight;
  };

  it('lands a heavy attack for the multiplied damage when nothing interrupts it', () => {
    for (const seed of [1, 2, 3]) {
      const fight = play([], seed);
      expect(fight.tally.taken).toBeCloseTo(heavy, 8);
    }
  });

  it('is cancelled by an interrupt that hits during the cast', () => {
    let interrupted = 0;
    let landed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const fight = play([dyn], seed);
      if (fight.tally.interrupts === 1) {
        interrupted++;
        expect(fight.tally.taken).toBe(0);
      } else {
        landed++;
        expect(fight.tally.taken).toBeCloseTo(heavy, 8);
      }
    }
    expect(interrupted).toBeGreaterThan(15);
    expect(landed).toBeGreaterThan(0);
  });
});

describe('Pack (answer: area)', () => {
  const whirl = 'core:leaf_great_whirlwind';

  it('spawns the configured number of weaker enemies', () => {
    const fight = createFight(scripted([]), enemyAt(10, ['pack']), 1, content, rules);
    expect(fight.enemies).toHaveLength(K.pack.n);
    for (const e of fight.enemies) {
      expect(e.maxHp).toBeCloseTo((K.eHp[0] + K.eHp[1] * 10) * K.pack.hp, 9);
      expect(e.damage).toBeCloseTo((K.eDmg[0] + K.eDmg[1] * 10) * K.pack.dmg, 9);
    }
  });

  it('is hit all at once by an area technique, one at a time by any other', () => {
    const { fight } = castAndHit(
      {
        known: [whirl],
        enemy: enemyAt(10, ['pack']),
        ai: () => castOnce(whirl),
        ok: (f) => f.enemies.every((e) => e.hp < e.maxHp),
      },
      whirl,
    );
    const each = tech(fight, whirl).damage;
    for (const e of fight.enemies) expect(e.maxHp - e.hp).toBeCloseTo(each, 5);
    expect(fight.tally.damage[whirl]).toBeCloseTo(each * K.pack.n, 8);

    const { fight: single } = castAndHit(
      {
        known: ['core:dynamic_entry'],
        enemy: enemyAt(10, ['pack']),
        ai: () => castOnce('core:dynamic_entry'),
      },
      'core:dynamic_entry',
    );
    expect(single.enemies.filter((e) => e.hp < e.maxHp)).toHaveLength(1);
  });
});

describe('Evasive (answer: bind)', () => {
  const bind = 'core:temporary_paralysis';

  it('multiplies evasion until the enemy is bound', () => {
    const fight = createFight(scripted([bind]), enemyAt(LEVEL, ['evasive']), 1, content, rules);
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    expect(enemy.evasion).toBeCloseTo(enemyEvasion, 9);
    expect(stat(ctxOf(fight), enemy, 'evasion', enemy.evasion)).toBeCloseTo(
      enemyEvasion * K.trait.evasive,
      9,
    );

    const { fight: bound } = castAndHit(
      { known: [bind], enemy: enemyAt(LEVEL, ['evasive']), ai: () => castOnce(bind) },
      bind,
    );
    const target = bound.enemies[0];
    if (!target) throw new Error('no enemy');
    // Bind replaces Evasive rather than adding to it.
    expect(stat(ctxOf(bound), target, 'evasion', target.evasion)).toBeCloseTo(
      enemyEvasion * K.bindEva,
      9,
    );
    expect(findEffect(target, 'bind')?.until).toBe(bound.t + sec(K.bind.dur));
    fightAdvance(
      bound,
      sec(K.bind.dur),
      content,
      withAi(() => ({ type: 'basic' })),
    );
    expect(findEffect(target, 'bind')).toBeUndefined();
    expect(stat(ctxOf(bound), target, 'evasion', target.evasion)).toBeCloseTo(
      enemyEvasion * K.trait.evasive,
      9,
    );
  });
});

describe('Regeneration (answer: damage over time)', () => {
  const amount = K.trait.regenPct * enemyHp;

  function regenFight(): FightState {
    const fight = quiet(
      pacify(
        createFight(
          scripted(['core:great_fireball']),
          enemyAt(LEVEL, ['regen']),
          1,
          content,
          rules,
        ),
      ),
    );
    return fight;
  }

  it('heals a share of maximum health every second', () => {
    const fight = regenFight();
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    expect(findEffect(enemy, 'regen')).toMatchObject({ mode: 'heal', amount });
    enemy.hp = enemy.maxHp / 2;
    const before = enemy.hp;
    fightAdvance(
      fight,
      sec(5),
      content,
      withAi(() => ({ type: 'basic' })),
    );
    expect(enemy.hp - before).toBeCloseTo(5 * amount, 6);
  });

  it('stops while the enemy burns, and resumes afterwards', () => {
    const fireball = 'core:great_fireball';
    const { fight } = castAndHit(
      { known: [fireball], enemy: enemyAt(LEVEL, ['regen']), ai: () => castOnce(fireball) },
      fireball,
    );
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    const idle = withAi(() => ({ type: 'basic' }));
    let last = enemy.hp;
    for (let s = 0; s < 5; s++) {
      fightAdvance(fight, sec(1), content, idle);
      expect(enemy.hp).toBeLessThan(last);
      last = enemy.hp;
    }
    // Burning has ended after its duration; regeneration works again.
    fightAdvance(fight, sec(K.burn.dur), content, idle);
    const resumed = enemy.hp;
    fightAdvance(fight, sec(3), content, idle);
    expect(enemy.hp - resumed).toBeCloseTo(3 * amount, 6);
  });

  it('stops while the enemy is poisoned', () => {
    const fight = regenFight();
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    enemy.hp = enemy.maxHp / 2;
    const before = enemy.hp;
    enemy.effects.push({
      kind: 'periodic',
      id: 'poison',
      src: 'test',
      until: sec(60),
      suppresses: 'regen',
      mode: 'damage',
      amount: 7,
      every: sec(1),
      next: sec(1),
    });
    fightAdvance(
      fight,
      sec(3),
      content,
      withAi(() => ({ type: 'basic' })),
    );
    expect(before - enemy.hp).toBeCloseTo(3 * 7, 6);
  });
});

describe('Illusionist (answer: dispel)', () => {
  const illusionFight = (
    med: number,
    seed: number,
    c = content,
    known: string[] = [],
  ): FightState =>
    quiet(
      pacify(
        createFight(scripted(known, { med }), enemyAt(LEVEL, ['illusionist']), seed, c, rules),
      ),
    );

  it('cuts the player accuracy by the configured factor for the configured time', () => {
    const fight = illusionFight(0, 1);
    fightAdvance(fight, sec(K.trait.illusionEvery), content, rules);
    const effect = findEffect(fight.player, 'illusion');
    expect(effect?.until).toBe(fight.t + sec(K.trait.illusionDur));
    expect(statOf(fight.player, 'accuracy', 100)).toBeCloseTo(100 * K.trait.illusionAcc, 9);
    fightAdvance(fight, sec(K.trait.illusionDur), content, rules);
    expect(findEffect(fight.player, 'illusion')).toBeUndefined();
    expect(statOf(fight.player, 'accuracy', 100)).toBe(100);
  });

  it('is resisted at Meditation level times the configured rate', () => {
    for (const med of [20, 40]) {
      let resisted = 0;
      const n = 2000;
      for (let seed = 1; seed <= n; seed++) {
        const fight = illusionFight(med, seed);
        fightAdvance(fight, sec(K.trait.illusionEvery), content, rules);
        if (!findEffect(fight.player, 'illusion')) resisted++;
      }
      expect(Math.abs(resisted / n - med * K.illusionResist)).toBeLessThan(0.03);
    }
  });

  it('is removed by a dispel technique', () => {
    const dispel = 'core:test_dispel';
    const c = withTechniques([syntheticTechnique(dispel, ['dispel'])]);
    const fight = illusionFight(0, 1, c, [dispel]);
    runUntil(fight, (f) => (f.tally.uses[dispel] ?? 0) > 0, rules, c);
    expect(fight.tally.uses[dispel]).toBe(1);
    // It was cast in answer to the illusion, not before it.
    expect(fight.tally.lastUseAt).toBeGreaterThanOrEqual(sec(K.trait.illusionEvery));
    expect(findEffect(fight.player, 'illusion')).toBeUndefined();
  });
});

describe('Hidden (answer: reveal)', () => {
  const sensing = 'core:sensing';
  const hiddenFight = (seed: number, known: string[], ai = rules): FightState =>
    createFight(scripted(known), enemyAt(LEVEL, ['hidden']), seed, content, ai);
  const firstBlow = (known: string[], ai = rules): { taken: number; fight: FightState } | null => {
    for (let seed = 1; seed < 100; seed++) {
      const fight = quiet(hiddenFight(seed, known, ai));
      fightAdvance(fight, sec(K.eInterval), content, ai);
      if (fight.tally.taken > 0) return { taken: fight.tally.taken, fight };
    }
    return null;
  };

  it('cuts the player accuracy for the first seconds, then lets go', () => {
    const fight = hiddenFight(1, []);
    expect(statOf(fight.player, 'accuracy', 100)).toBeCloseTo(100 * K.trait.hiddenAcc, 9);
    expect(findEffect(fight.player, 'hidden')?.until).toBe(sec(K.trait.hidden));
    quiet(pacify(fight));
    fightAdvance(
      fight,
      sec(K.trait.hidden),
      content,
      withAi(() => ({ type: 'basic' })),
    );
    expect(findEffect(fight.player, 'hidden')).toBeUndefined();
  });

  it('strikes first with a multiplied blow while still hidden', () => {
    const blow = firstBlow([]);
    expect(blow?.taken).toBeCloseTo(enemyDamage * K.trait.hiddenFirst, 8);
  });

  it('loses both edges once a reveal technique is used', () => {
    const ai = withAi(castOnce(sensing));
    const blow = firstBlow([sensing], ai);
    expect(blow?.fight.tally.uses[sensing]).toBe(1);
    expect(blow && findEffect(blow.fight.player, 'hidden')).toBeUndefined();
    expect(blow?.taken).toBeCloseTo(enemyDamage, 8);
  });
});

describe('Poisoner (answer: cleanse)', () => {
  const poisonFight = (seed: number, c = content, known: string[] = []): FightState =>
    quiet(createFight(scripted(known), enemyAt(LEVEL, ['poisoner']), seed, c, rules));

  it('poisons on a hit at the configured chance', () => {
    let hits = 0;
    let poisoned = 0;
    for (let seed = 1; seed <= 2500; seed++) {
      const fight = poisonFight(seed);
      fightAdvance(fight, sec(K.eInterval), content, rules);
      if (fight.tally.taken > 0) hits++;
      if ((fight.tally.statuses.poison ?? 0) > 0) poisoned++;
    }
    expect(hits).toBeGreaterThan(1000);
    expect(Math.abs(poisoned / hits - K.trait.poisonChance)).toBeLessThan(0.04);
  });

  it('then takes a share of maximum health every second for the configured time', () => {
    for (let seed = 1; seed < 200; seed++) {
      const fight = poisonFight(seed);
      fightAdvance(fight, sec(K.eInterval), content, rules);
      if (!findEffect(fight.player, 'poison')) continue;
      pacify(fight);
      const before = fight.tally.taken;
      fightAdvance(fight, sec(K.poison.dur), content, rules);
      expect(fight.tally.taken - before).toBeCloseTo(
        K.poison.dur * K.poison.pctPerSec * fight.player.maxHp,
        3,
      );
      expect(findEffect(fight.player, 'poison')).toBeUndefined();
      return;
    }
    throw new Error('no seed poisons');
  });

  it('refreshes rather than stacks when poisoned again', () => {
    const fight = poisonFight(3);
    fight.player.hp = fight.player.maxHp = 1e15;
    for (const e of fight.enemies) {
      e.intervalMs = 400;
      e.timer.need = needOf(400);
    }
    let seen = 0;
    while (fight.t < sec(20)) {
      fightAdvance(fight, sec(0.2), content, rules);
      expect(fight.result).toBe('ongoing');
      const poisons = fight.player.effects.filter((e) => e.id === 'poison');
      expect(poisons.length).toBeLessThanOrEqual(1);
      seen += poisons.length;
    }
    expect(fight.tally.statuses.poison).toBeGreaterThan(1);
    expect(seen).toBeGreaterThan(0);
  });

  it('is cleansed by a cleanse technique', () => {
    const cleanse = 'core:test_cleanse';
    const c = withTechniques([syntheticTechnique(cleanse, ['cleanse'])]);
    for (let seed = 1; seed < 200; seed++) {
      const fight = poisonFight(seed, c, [cleanse]);
      pacify(fight);
      // Poison the player by hand the way the enemy would, then let the AI act.
      fight.player.effects.push({
        kind: 'periodic',
        id: 'poison',
        src: 'trait:poisoner',
        until: sec(60),
        suppresses: 'regen',
        mode: 'damage',
        amount: 5,
        every: sec(1),
        next: sec(1),
      });
      runUntil(fight, (f) => (f.tally.uses[cleanse] ?? 0) > 0, rules, c);
      expect(fight.tally.uses[cleanse]).toBe(1);
      expect(findEffect(fight.player, 'poison')).toBeUndefined();
      return;
    }
  });
});

describe('the default AI answers a trait with its tagged technique', () => {
  const first = (known: string[], enemy = enemyAt(LEVEL), levels = {}) => {
    const fight = quiet(createFight(scripted(known, levels), enemy, 1, content, rules));
    runUntil(fight, (f) => Object.keys(f.tally.uses).length > 0, rules);
    return Object.keys(fight.tally.uses)[0];
  };

  it('reveals while hidden, but only when hidden', () => {
    expect(first(['core:sensing', 'core:great_fireball'], enemyAt(LEVEL, ['hidden']))).toBe(
      'core:sensing',
    );
    expect(first(['core:sensing', 'core:great_fireball'])).toBe('core:great_fireball');
  });

  it('binds while Evasive works', () => {
    expect(
      first(['core:temporary_paralysis', 'core:great_fireball'], enemyAt(LEVEL, ['evasive'])),
    ).toBe('core:temporary_paralysis');
  });

  it('pierces while armour is up', () => {
    expect(first(['core:gale_palm', 'core:great_fireball'], enemyAt(LEVEL, ['armor']))).toBe(
      'core:gale_palm',
    );
    expect(first(['core:gale_palm', 'core:great_fireball'])).toBe('core:great_fireball');
  });

  it('uses area when more than one enemy lives', () => {
    expect(first(['core:leaf_great_whirlwind', 'core:lion_combo'], enemyAt(10, ['pack']))).toBe(
      'core:leaf_great_whirlwind',
    );
  });

  it('burns while Regeneration is unchecked', () => {
    const known = ['core:great_fireball', 'core:false_darkness'];
    expect(first(known, enemyAt(LEVEL, ['regen']), { raiton: 50 })).toBe('core:great_fireball');
    expect(first(known, enemyAt(LEVEL), { raiton: 50 })).toBe('core:false_darkness');
  });
});

describe('the default AI decision rules, on hand-made views', () => {
  const kt = (id: string, tags: string[], damage: number, extra = {}): KitTechnique => ({
    id,
    skill: 'nin',
    role: 'projectile',
    rank: 'C',
    tags: tags as KitTechnique['tags'],
    state: null,
    damage,
    castMs: 1000,
    cooldownMs: 6000,
    pool: 'chakra',
    cost: 1,
    accuracy: 100,
    comboChance: 0,
    hitsAll: false,
    guaranteedCombo: null,
    habituationMult: 1,
    fx: {
      kind: 'damage',
      amount: 0,
      mult: 1,
      durationMs: 0,
      drain: 0,
      wounds: 0,
      everyMs: 0,
      statuses: [],
    },
    requiresStance: false,
    ...extra,
  });
  const vt = (tech: KitTechnique): ViewTechnique => ({
    tech,
    cooldownLeft: 0,
    affordable: true,
    ready: true,
    uses: 0,
    expected: tech.damage,
    power: tech.damage,
    stanceOk: true,
  });
  const enemyView = (o: Partial<ViewEnemy> = {}): ViewEnemy => ({
    id: 'e#0',
    hp: 100,
    hpShare: 1,
    nature: null,
    effects: [],
    knownTraits: [],
    workingTraits: [],
    cast: null,
    nextCastIn: null,
    leader: false,
    ...o,
  });
  const mk = (
    techs: KitTechnique[],
    enemies: ViewEnemy[] = [enemyView()],
    playerEffects: string[] = [],
  ): FightView => ({
    t: 0,
    tier: 1,
    player: {
      hp: 100,
      maxHp: 100,
      chakra: 100,
      maxChakra: 100,
      stamina: 100,
      maxStamina: 100,
      effects: playerEffects.map((id) => ({ id, kind: 'modifier', remaining: null })),
      ward: 0,
      decoys: 0,
    },
    techniques: techs.map(vt),
    enemies,
    habituation: {},
    ai: chunin,
    visibleTraits: content.ai.visibleTraits,
    pouch: [],
    medic: null,
    stance: null,
    hastened: false,
    reactWork: 0,
    guardBelow: K.ai.guardBelow,
    strongMult: 0,
    itemWork: sec(K.pillAction),
  });
  const cast = (id: string) => ({ type: 'technique', id });

  it('casts an interrupt only while an interruptible cast is under way and ends later than this one', () => {
    const techs = [kt('int', ['interrupt'], 1), kt('big', [], 50)];
    const casting = (remaining: number, interruptible = true) =>
      mk(techs, [
        enemyView({
          cast: { kind: 'heavy', remaining, total: remaining, mult: 3, interruptible },
        }),
      ]);
    const need = sec(1);
    expect(defaultCombatAi(casting(need + 1))).toEqual(cast('int'));
    expect(defaultCombatAi(casting(need))).toEqual(cast('big'));
    expect(defaultCombatAi(mk(techs))).toEqual(cast('big'));
    // A cast an interrupt cannot stop is no reason to interrupt.
    expect(defaultCombatAi(casting(need + 1, false))).toEqual(cast('big'));
  });

  it('keeps an interrupt back when the next heavy attack comes before it would be ready again', () => {
    const techs = [kt('int', ['interrupt'], 30), kt('plain', [], 10)];
    const waiting = (inWork: number) =>
      mk(techs, [
        enemyView({ knownTraits: ['caster'], workingTraits: ['caster'], nextCastIn: inWork }),
      ]);
    expect(defaultCombatAi(waiting(sec(2)))).toEqual(cast('plain'));
    expect(defaultCombatAi(waiting(sec(60)))).toEqual(cast('int'));
  });

  it('answers a known, working trait with its tag, and only then', () => {
    const answers: [TraitId, string][] = [
      ['hidden', 'reveal'],
      ['evasive', 'bind'],
      ['armor', 'pierce'],
      ['regen', 'dot'],
    ];
    for (const [trait, tag] of answers) {
      const techs = [kt('answer', [tag], 1), kt('big', [], 50)];
      const view = (known: TraitId[], working: TraitId[]) =>
        mk(techs, [enemyView({ knownTraits: known, workingTraits: working })]);
      expect(defaultCombatAi(view([trait], [trait]))).toEqual(cast('answer'));
      // Unknown: the AI does not answer it deliberately. Switched off: nothing to answer.
      expect(defaultCombatAi(view([], []))).toEqual(cast('big'));
      expect(defaultCombatAi(view([trait], []))).toEqual(cast('big'));
    }
  });

  it('answers a status on the player with dispel or cleanse', () => {
    const techs = [kt('dispel', ['dispel'], 1), kt('cleanse', ['cleanse'], 1), kt('big', [], 50)];
    expect(defaultCombatAi(mk(techs, undefined, ['illusion']))).toEqual(cast('dispel'));
    expect(defaultCombatAi(mk(techs, undefined, ['poison']))).toEqual(cast('cleanse'));
    expect(defaultCombatAi(mk(techs))).toEqual(cast('big'));
  });

  it('uses area when more than one enemy lives, else the best damage, else a basic attack', () => {
    const techs = [kt('area', ['area'], 10, { hitsAll: true }), kt('big', [], 50)];
    expect(defaultCombatAi(mk(techs, [enemyView(), enemyView({ id: 'e#1' })]))).toEqual(
      cast('area'),
    );
    expect(defaultCombatAi(mk(techs))).toEqual(cast('big'));
    expect(defaultCombatAi(mk([]))).toEqual({ type: 'basic' });
    expect(defaultCombatAi(mk([kt('none', [], 0)]))).toEqual({ type: 'basic' });
  });
});

describe('the view the AI gets', () => {
  it('lists every loadout technique with its cooldown, cost and affordability, and hides the fight internals', () => {
    let seen: FightView | null = null;
    const spy = withAi((view) => {
      seen ??= view;
      return { type: 'basic' };
    });
    const known = ['core:great_fireball', 'core:dynamic_entry'];
    const snap = {
      ...scripted(known),
      loadout: ['core:great_fireball'],
      tier: 2,
      knowledge: { 'core:test': ['armor'] },
    };
    const fight = createFight(snap, enemyAt(LEVEL, ['armor', 'regen']), 1, content, spy);
    fight.player.cd['core:great_fireball'] = sec(3);
    fightAdvance(fight, 0, content, spy);
    const view = seen as FightView | null;
    expect(view?.tier).toBe(2);
    expect(view?.techniques.map((t) => t.tech.id)).toEqual(['core:great_fireball']);
    const t0 = view?.techniques[0];
    expect(t0?.cooldownLeft).toBe(sec(3));
    expect(t0?.ready).toBe(false);
    expect(t0?.affordable).toBe(true);
    expect(view?.enemies[0]?.knownTraits).toEqual(['armor']);
    expect(view?.enemies[0]?.workingTraits).toEqual(['armor']);
    expect(view?.enemies[0]?.hpShare).toBe(1);
    // The view is a copy: changing it does not touch the fight.
    (view?.techniques[0]?.tech.tags as string[]).push('x');
    expect(fight.kit.techniques[0]?.tags).not.toContain('x');
  });

  it('keeps the loadout, knowledge and tier in the fight state', () => {
    const snap = {
      ...scripted(['core:great_fireball']),
      tier: 1,
      knowledge: { 'core:x': ['regen'] },
    };
    const fight = createFight(snap, enemyAt(LEVEL), 1, content, rules);
    expect(fight.tier).toBe(1);
    expect(fight.knowledge).toEqual({ 'core:x': ['regen'] });
    expect(JSON.parse(JSON.stringify(fight))).toEqual(fight);
  });

  it('does not answer a trait the player does not know, in a real fight', () => {
    const known = ['core:gale_palm', 'core:great_fireball'];
    const first = (knowledge: Record<string, string[]>) => {
      const snap = { ...scripted(known), knowledge };
      const fight = quiet(createFight(snap, enemyAt(LEVEL, ['armor']), 1, content, rules));
      runUntil(fight, (f) => Object.keys(f.tally.uses).length > 0, rules);
      return Object.keys(fight.tally.uses)[0];
    };
    expect(first({})).toBe('core:gale_palm');
    expect(first({ 'core:test': [] })).toBe('core:great_fireball');
  });

  it('accepts wait and item decisions without breaking the fight', () => {
    const waits = withAi(() => ({ type: 'wait' }));
    const fight = quiet(createFight(scripted([]), enemyAt(LEVEL), 1, content, waits));
    fightAdvance(fight, sec(10), content, waits);
    expect(fight.tally.basic).toBe(0);
    expect(fight.result).toBe('ongoing');
    const items = withAi(() => ({ type: 'item', id: 'core:pill' }));
    const second = quiet(createFight(scripted([]), enemyAt(LEVEL), 1, content, items));
    fightAdvance(second, sec(10), content, items);
    expect(second.tally.basic).toBeGreaterThan(0);
  });

  it('aims a technique at the body the AI names', () => {
    const snap = scripted(['core:dynamic_entry']);
    const fight = quiet(createFight(snap, enemyAt(10, ['pack']), 1, content, rules));
    const heavier = fight.enemies[1];
    if (!heavier) throw new Error('no body');
    heavier.hp += 1;
    const ai = withAi(() => ({ type: 'technique', id: 'core:dynamic_entry', target: heavier.id }));
    runUntil(fight, (f) => (f.tally.uses['core:dynamic_entry'] ?? 0) > 0, ai);
    const hit = fight.enemies.filter((e) => e.hp < e.maxHp);
    expect(hit.length).toBeLessThanOrEqual(1);
    if (hit[0]) expect(hit[0].id).toBe(heavier.id);
  });
});

describe('the AI is a pluggable rule', () => {
  it('lets a rule set replace the player decisions', () => {
    const fight = quiet(
      createFight(scripted(['core:great_fireball']), enemyAt(LEVEL), 1, content, rules),
    );
    const basic = withAi(() => ({ type: 'basic' }));
    fightAdvance(fight, sec(30), content, basic);
    expect(fight.tally.uses).toEqual({});
    expect(fight.tally.basic).toBeGreaterThan(5);
    const cast = withAi(castSeq('core:great_fireball'));
    fightAdvance(fight, sec(30), content, cast);
    expect(fight.tally.uses['core:great_fireball']).toBeGreaterThan(2);
  });

  it('falls back to a basic attack when the AI asks for something not ready', () => {
    const fight = quiet(createFight(scripted([]), enemyAt(LEVEL), 1, content, rules));
    fightAdvance(
      fight,
      sec(10),
      content,
      withAi(() => ({ type: 'technique', id: 'core:nope' })),
    );
    expect(fight.tally.basic).toBeGreaterThan(2);
  });
});
