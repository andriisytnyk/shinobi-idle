/** Burn combo, save parsing, encounters, outcomes, the damage pipeline, hooks, signature habituation. */
import { content, type Technique } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addDecoys,
  addEffect,
  advance,
  createFight,
  createState,
  deserialize,
  dispatch,
  encounterFor,
  fightAdvance,
  fightNextEventIn,
  grantWard,
  nextFloatFrom,
  createStream,
  dealDamage,
  parseFight,
  refreshUnlocks,
  rollHit,
  serialize,
  spawnEnemies,
  stat,
  workOf,
  type Combatant,
  type Encounter,
  type FightHook,
  type FightState,
} from '../src/index.ts';
import {
  K,
  castAndHit,
  castOnce,
  castSeq,
  ctxOf,
  enemyAt,
  pacify,
  playerFor,
  quiet,
  rules,
  runUntil,
  scripted,
  sec,
  tech,
  withAi,
  fig,
} from './fight-helpers.ts';
import { fightingGenin as genin, setLevel } from './helpers.ts';

const LEVEL = 34;
const only = (f: FightState): Combatant => {
  const e = f.enemies[0];
  if (!e) throw new Error('no enemy');
  return e;
};
const bandit = (): Technique['id'] => 'core:bandit';

describe('Futon on Burning does not compound', () => {
  it('leaves the burn at x(fanBurn) after five Futon hits in a row', () => {
    // The same Futon technique five times running, with no cooldown, so the burn is still there.
    const palm = 'core:gale_palm';
    const r = withAi(castSeq(palm));
    const fight = quiet(pacify(createFight(scripted([palm]), enemyAt(LEVEL), 3, content, r)));
    for (const kit of fight.kit.techniques) {
      kit.comboChance = 1;
      kit.cooldownMs = 0;
    }
    const enemy = only(fight);
    enemy.evasion = 0;
    addEffect(enemy, {
      kind: 'periodic',
      id: 'burn',
      src: 'test',
      until: sec(1000),
      suppresses: 'regen',
      mode: 'damage',
      amount: 10,
      every: sec(1),
      next: sec(1),
    });
    const amounts: number[] = [];
    for (let n = 1; n <= 5; n++) {
      runUntil(fight, (f) => (f.tally.uses[palm] ?? 0) >= n, r);
      const burn = enemy.effects.find((e) => e.id === 'burn');
      amounts.push(burn?.kind === 'periodic' ? burn.amount : -1);
    }
    expect(fight.tally.combos.fanBurn).toBeGreaterThanOrEqual(3);
    for (const a of amounts) expect([10, 10 * fig('combo.fanBurn')]).toContain(a);
    expect(amounts[amounts.length - 1]).toBe(10 * fig('combo.fanBurn'));
    const burn = enemy.effects.find((e) => e.id === 'burn');
    expect(burn?.until).toBeGreaterThan(fight.t);
  });

  it('a new Katon burn replaces a boosted one with a fresh one', () => {
    const fireball = 'core:great_fireball';
    const { fight } = castAndHit(
      {
        known: [fireball],
        enemy: enemyAt(LEVEL),
        ai: () => castOnce(fireball),
        setup: (f) => {
          addEffect(only(f), {
            kind: 'periodic',
            id: 'burn',
            src: 'test',
            until: sec(1000),
            mode: 'damage',
            amount: 99,
            base: 99,
            every: sec(1),
            next: sec(1),
          });
        },
      },
      fireball,
    );
    const burn = only(fight).effects.find((e) => e.id === 'burn');
    expect(burn?.kind === 'periodic' && burn.amount).toBeCloseTo(
      (K.burn.share * tech(fight, fireball).damage) / K.burn.dur,
      6,
    );
  });
});

// ---------- parsing a saved fight ----------

describe('a saved fight is parsed strictly', () => {
  function sample(): FightState {
    const fight = createFight(
      playerFor(34, 'katon'),
      enemyAt(34, ['caster', 'regen', 'poisoner']),
      5,
      content,
      rules,
    );
    fightAdvance(fight, sec(20), content, rules);
    return fight;
  }
  const json = (f: FightState): Record<string, unknown> =>
    JSON.parse(JSON.stringify(f)) as Record<string, unknown>;
  const at = (o: Record<string, unknown>, ...path: string[]): Record<string, unknown> =>
    path.reduce((acc, k) => acc[k] as Record<string, unknown>, o);

  it('reads back a valid fight unchanged', () => {
    const fight = sample();
    expect(parseFight(json(fight), content)).toEqual(fight);
  });

  it('refuses a player in an enemy phase and an enemy in a player phase', () => {
    const a = json(sample());
    at(a, 'player').phase = 'attack';
    expect(parseFight(a, content)).toBeNull();
    const b = json(sample());
    (b.enemies as Record<string, unknown>[])[0]!.phase = 'idle';
    expect(parseFight(b, content)).toBeNull();
  });

  it('refuses a technique with no cast time, a negative cost or damage', () => {
    for (const [key, value] of [
      ['castMs', 0],
      ['cost', -1],
      ['damage', -5],
      ['cooldownMs', -1],
    ] as const) {
      const a = json(sample());
      ((at(a, 'kit').techniques as Record<string, unknown>[])[0] as Record<string, unknown>)[key] =
        value;
      expect(parseFight(a, content), key).toBeNull();
    }
  });

  it('refuses a cast of a technique that is not in the kit', () => {
    const a = json(sample());
    const player = at(a, 'player');
    player.phase = 'cast';
    player.cast = 'core:nope';
    player.timer = { progress: 0, need: sec(1) * 1000 };
    expect(parseFight(a, content)).toBeNull();
  });

  it('refuses timers and ticks that could not run, and negative numbers', () => {
    const a = json(sample());
    (a.enemies as Record<string, unknown>[])[0]!.timer = { progress: 0, need: 0 };
    expect(parseFight(a, content)).toBeNull();
    const b = json(sample());
    ((b.enemies as Record<string, unknown>[])[0]!.timers as Record<string, unknown>).caster = {
      progress: 0,
      need: 0,
    };
    expect(parseFight(b, content)).toBeNull();
    const c = json(sample());
    at(c, 'player').hp = -3;
    expect(parseFight(c, content)).toBeNull();
    const d = json(sample());
    (d.enemies as Record<string, unknown>[])[0]!.effects = [
      {
        kind: 'periodic',
        id: 'x',
        src: 'x',
        until: null,
        mode: 'damage',
        amount: 1,
        every: 1,
        next: 0,
      },
    ];
    expect(parseFight(d, content)).toBeNull();
  });

  it('clamps an effect tick and a regeneration step that are far behind the clock', () => {
    const fight = sample();
    const a = json(fight);
    (a.enemies as Record<string, unknown>[])[0]!.effects = [
      {
        kind: 'periodic',
        id: 'x',
        src: 'x',
        until: null,
        mode: 'damage',
        amount: 1,
        every: sec(1),
        next: 0,
      },
    ];
    a.poolAt = 0;
    const parsed = parseFight(a, content);
    expect(parsed).not.toBeNull();
    const effect = parsed?.enemies[0]?.effects[0];
    expect(effect?.kind === 'periodic' && effect.next).toBeGreaterThanOrEqual(fight.t);
    expect(parsed?.poolAt).toBeGreaterThanOrEqual(fight.t);
    if (parsed) fightAdvance(parsed, sec(30), content, rules);
  });

  it('refuses too many enemies, an empty enemy list and a bad encounter', () => {
    const a = json(sample());
    const e = (a.enemies as unknown[])[0];
    a.enemies = Array.from({ length: K.combat.maxEnemies * 2 + 1 }, () => e);
    expect(parseFight(a, content)).toBeNull();
    const b = json(sample());
    b.enemies = [];
    expect(parseFight(b, content)).toBeNull();
    const c = json(sample());
    at(c, 'encounter').spawns = [];
    expect(parseFight(c, content)).toBeNull();
  });

  it('restarts the fight on load instead of throwing', () => {
    const state = genin(4);
    for (const skill of ['tai', 'nin', 'katon', 'vit'] as const) setLevel(state, skill, 20);
    refreshUnlocks(state, content, true);
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:bandit' }, content);
    advance(state, 5000, content);
    const doc = JSON.parse(serialize(state, 0)) as {
      state: { combat: { fight: Record<string, unknown> } };
    };
    (doc.state.combat.fight.player as Record<string, unknown>).phase = 'attack';
    const loaded = deserialize(JSON.stringify(doc), content);
    expect(loaded.combat?.fight.t).toBe(0);
    expect(() => advance(loaded, 30_000, content)).not.toThrow();
    expect(loaded.combat?.fight.t).toBeGreaterThan(0);
  });

  it('survives random corruption of a valid fight: never throws or loops', () => {
    const rngState = createStream(99, 'fuzz');
    const pick = (n: number) => Math.floor(nextFloatFrom(rngState) * n);
    const junk: unknown[] = [null, -1, 0, 1, 2, 1e18, -1e18, 0.5, 'x', [], {}, true, false, 7e5];
    const base = sample();
    let parsedCount = 0;
    for (let i = 0; i < 600; i++) {
      const doc = json(base);
      // Walk to a random leaf and replace it, or remove it.
      let node: Record<string, unknown> | unknown[] = doc;
      for (;;) {
        const keys = Object.keys(node);
        if (keys.length === 0) break;
        const key = keys[pick(keys.length)] as string;
        const child = (node as Record<string, unknown>)[key];
        const deeper = typeof child === 'object' && child !== null && pick(3) > 0;
        if (deeper) {
          node = child as Record<string, unknown>;
          continue;
        }
        if (pick(4) === 0) {
          if (Array.isArray(node)) node.splice(Number(key), 1);
          else delete (node as Record<string, unknown>)[key];
        } else (node as Record<string, unknown>)[key] = junk[pick(junk.length)];
        break;
      }
      const parsed = parseFight(doc, content);
      if (!parsed) continue;
      parsedCount++;
      expect(() => fightAdvance(parsed, sec(30), content, rules)).not.toThrow();
    }
    expect(parsedCount).toBeGreaterThan(0);
  }, 60_000);
});

// ---------- encounters ----------

describe('encounters', () => {
  const entry = (id: string) => {
    const e = content.enemies.find((x) => x.id === id);
    if (!e) throw new Error(id);
    return e;
  };

  it('builds spawns from an enemy entry: a pack becomes several weaker bodies', () => {
    const wolf = encounterFor(entry('core:wolf'), content);
    expect(wolf.spawns).toEqual([
      expect.objectContaining({
        enemy: 'core:wolf',
        count: K.pack.n,
        hpMult: K.pack.hp,
        dmgMult: K.pack.dmg,
      }),
    ]);
    const plain = encounterFor(entry(bandit()), content);
    expect(plain.spawns[0]).toMatchObject({
      count: 1,
      hpMult: 1,
      dmgMult: 1,
      fleeAt: null,
      specials: [],
    });
    expect(plain.specials).toEqual([]);
  });

  it('builds spawns from a boss entry: health and damage are scaled', () => {
    // The fighter has no mechanic that changes its body: one spawn with the boss numbers.
    const boss = content.bosses.find((b) => b.id === 'core:boss_fighter');
    if (!boss) throw new Error('no boss');
    const encounter = encounterFor(boss, content, ['test:special']);
    expect(encounter.spawns).toHaveLength(1);
    expect(encounter.spawns[0]?.hpMult).toBeCloseTo(K.boss.hp, 9);
    expect(encounter.spawns[0]?.dmgMult).toBeCloseTo(K.boss.dmg, 9);
    expect(encounter.specials).toEqual(['test:special']);
    const fight = createFight(scripted([]), encounter, 1, content, rules);
    expect(only(fight).maxHp).toBeCloseTo((K.eHp[0] + K.eHp[1] * boss.cl) * K.boss.hp, 6);
    expect(only(fight).specials).toEqual(['test:special', 'special:evasionByMissingHp']);
  });

  it('holds several kinds of body, each with its own scaling', () => {
    const encounter: Encounter = {
      id: 'core:mixed',
      specials: [],
      spawns: [
        {
          enemy: 'core:wolf',
          cl: 10,
          traits: [],
          nature: null,
          count: 2,
          hpMult: 1,
          dmgMult: 1,
          fleeAt: null,
          specials: [],
        },
        {
          enemy: 'core:bandit',
          cl: 6,
          traits: ['armor'],
          nature: 'katon',
          count: 1,
          hpMult: 2,
          dmgMult: 3,
          fleeAt: 0.5,
          specials: [],
        },
      ],
    };
    const fight = createFight(scripted([]), encounter, 1, content, rules);
    expect(fight.enemies.map((e) => e.entry)).toEqual(['core:wolf', 'core:wolf', 'core:bandit']);
    const last = fight.enemies[2];
    expect(last?.maxHp).toBeCloseTo((K.eHp[0] + K.eHp[1] * 6) * 2, 9);
    expect(last?.damage).toBeCloseTo((K.eDmg[0] + K.eDmg[1] * 6) * 3, 9);
    expect(last?.fleeAt).toBe(0.5);
    expect(last?.nature).toBe('katon');
    expect(new Set(fight.enemies.map((e) => e.id)).size).toBe(3);
  });

  it('caps the bodies at the balance limit, not at three', () => {
    const big: Encounter = {
      id: 'core:horde',
      specials: [],
      spawns: [
        {
          enemy: 'core:wolf',
          cl: 10,
          traits: [],
          nature: null,
          count: K.combat.maxEnemies,
          hpMult: 1,
          dmgMult: 1,
          fleeAt: null,
          specials: [],
        },
      ],
    };
    const fight = createFight(scripted([]), big, 1, content, rules);
    expect(fight.enemies).toHaveLength(K.combat.maxEnemies);
    expect(K.combat.maxEnemies).toBeGreaterThan(K.pack.n);
    expect(spawnEnemies(fight, 0, content, rules, 3)).toEqual([]);
    expect(JSON.parse(JSON.stringify(fight))).toEqual(fight);
    expect(parseFight(JSON.parse(JSON.stringify(fight)), content)).toEqual(fight);
    const clipped = { ...big, spawns: [{ ...big.spawns[0]!, count: K.combat.maxEnemies + 5 }] };
    expect(createFight(scripted([]), clipped, 1, content, rules).enemies).toHaveLength(
      K.combat.maxEnemies,
    );
  });

  it('adds enemies during a fight, up to the cap, dropping the dead first', () => {
    const fight = quiet(createFight(scripted([]), enemyAt(10, ['pack']), 1, content, rules));
    fightAdvance(fight, sec(1), content, rules);
    const added = spawnEnemies(fight, 0, content, rules, 2);
    expect(added).toHaveLength(2);
    expect(fight.enemies).toHaveLength(K.pack.n + 2);
    expect(new Set(fight.enemies.map((e) => e.id)).size).toBe(fight.enemies.length);
    // A new body waits for the moment first, and its attack comes a full attack interval after its arrival.
    const body = added[0];
    expect(body?.phase).toBe('wait');
    expect(body?.timer.progress).toBe(0);
    expect(body?.timer.need).toBe(sec((body?.waitMs ?? 0) / 1000) * 1000);
    expect((body?.waitMs ?? 0) + (body?.strikeMs ?? 0)).toBe(Math.round(K.eInterval * 1000));
    // Dead bodies make room.
    for (const e of fight.enemies.slice(0, 3)) e.hp = 0;
    const more = spawnEnemies(fight, 0, content, rules, 7);
    expect(more).toHaveLength(K.combat.maxEnemies - 2);
    expect(fight.enemies.every((e) => e.hp > 0)).toBe(true);
    expect(fight.result).toBe('ongoing');
    fightAdvance(fight, sec(30), content, rules);
    expect(JSON.parse(JSON.stringify(fight))).toEqual(fight);
  });

  it('gives every body the encounter specials', () => {
    const calls: string[] = [];
    const hook: FightHook = { id: 'test:mark', init: (_ctx, c) => void calls.push(c.id) };
    const custom = { ...rules, fightHooks: [...rules.fightHooks, hook] };
    const encounter = encounterFor(
      content.enemies.find((e) => e.id === 'core:wolf')!,
      content,
      ['test:mark'],
    );
    const fight = createFight(scripted([]), encounter, 1, content, custom);
    expect(calls).toHaveLength(K.pack.n);
    spawnEnemies(fight, 0, content, custom);
    expect(calls).toHaveLength(K.pack.n + 1);
  });
});

// ---------- outcomes ----------

describe('outcomes', () => {
  it('ends as fled, with no kill, when an enemy leaves at its health share', () => {
    const encounter = enemyAt(LEVEL);
    encounter.spawns[0]!.fleeAt = 0.5;
    const fight = quiet(createFight(scripted([]), encounter, 1, content, rules), 1000);
    const e = only(fight);
    dealDamage(ctxOf(fight), e, 400, 'x');
    expect(e.hp).toBe(600);
    expect(fight.result).toBe('ongoing');
    dealDamage(ctxOf(fight), e, 200, 'x');
    expect(e.fled).toBe(true);
    fightAdvance(fight, 0, content, rules);
    expect(fight.result).toBe('fled');
    expect(fight.tally.kills).toBe(0);
    expect(fightNextEventIn(fight, content, rules)).toBeNull();
  });

  it('ends as a timeout at the cap, which comes from the balance object', () => {
    const fight = quiet(pacify(createFight(scripted([]), enemyAt(LEVEL), 1, content, rules)));
    expect(fight.cap).toBe(workOf(K.combat.fightCapMs));
    fight.cap = sec(5);
    const left = fightAdvance(fight, sec(20), content, rules);
    expect(fight.result).toBe('timeout');
    expect(fight.t).toBe(sec(5));
    expect(left).toBe(sec(15));
    expect(fight.tally.kills).toBe(0);
  });

  it('lets the player fall first when both fall in the same moment', () => {
    const fight = quiet(createFight(scripted([]), enemyAt(LEVEL), 1, content, rules), 100);
    fight.player.hp = 5;
    const c = ctxOf(fight);
    dealDamage(c, only(fight), 1000, 'x');
    dealDamage(c, fight.player, 1000, 'x');
    fightAdvance(fight, 0, content, rules);
    expect(fight.result).toBe('defeat');
  });

  function fighting(seed: number) {
    const state = genin(seed);
    for (const skill of ['tai', 'nin', 'katon', 'vit', 'med'] as const) setLevel(state, skill, 25);
    refreshUnlocks(state, content, true);
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:bandit' }, content);
    return state;
  }

  it('pays a fled enemy like a win: a kill, an event and the pause', () => {
    const state = fighting(5);
    const fight = state.combat!.fight;
    fight.encounter.spawns[0]!.fleeAt = 0.99;
    only(fight).fleeAt = 0.99;
    advance(state, 30_000, content);
    expect(state.counters['kills.core:bandit']).toBeGreaterThanOrEqual(1);
    expect(state.events.some((e) => e.type === 'enemyDefeated')).toBe(true);
  });

  it('on a timeout pays nothing, costs nothing and starts a new fight', () => {
    const state = fighting(6);
    const old = state.combat!.fight;
    for (const e of old.enemies) e.hp = e.maxHp = 1e9;
    old.cap = sec(2);
    const hp = old.player.hp;
    advance(state, 2500, content);
    expect(state.combat?.fight).not.toBe(old);
    expect(state.combat?.fight.t).toBeLessThan(sec(2));
    expect(state.combat?.fight.result).toBe('ongoing');
    expect(state.counters['kills.core:bandit'] ?? 0).toBe(0);
    expect(
      state.events.some((e) => e.type === 'playerDefeated' || e.type === 'enemyDefeated'),
    ).toBe(false);
    expect(state.slots[0]?.action?.kind).toBe('fight');
    expect(state.combat?.phase).toBe('fight');
    // No healing and no pause: the health carried over is at most what the old fight left.
    expect(state.combat?.fight.player.hp).toBeLessThanOrEqual(hp);
  });
});

// ---------- the incoming-damage pipeline ----------

describe('the incoming-damage pipeline', () => {
  const fresh = () =>
    quiet(pacify(createFight(scripted([]), enemyAt(LEVEL), 1, content, rules)), 1e6);

  it('turns a hit into a miss with a decoy charge, one charge per hit', () => {
    const fight = fresh();
    const p = fight.player;
    addDecoys(p, 2);
    expect(rollHit(ctxOf(fight), p, 1)).toBe(false);
    expect(p.decoys).toBe(1);
    expect(rollHit(ctxOf(fight), p, null)).toBe(false);
    expect(p.decoys).toBe(0);
    expect(rollHit(ctxOf(fight), p, null)).toBe(true);
    // A roll that misses keeps the charge.
    addDecoys(p, 1);
    expect(rollHit(ctxOf(fight), p, 0)).toBe(false);
    expect(p.decoys).toBe(1);
  });

  it('applies damage-taken modifiers, then drains the ward, then health', () => {
    const fight = fresh();
    const p = fight.player;
    p.hp = p.maxHp = 1000;
    addEffect(p, {
      kind: 'modifier',
      id: 'half',
      src: 'test',
      until: null,
      stat: 'damageTaken',
      op: 'mul',
      value: 0.5,
    });
    grantWard(p, 30, null);
    expect(dealDamage(ctxOf(fight), p, 100, 'x')).toBeCloseTo(20, 9);
    expect(p.hp).toBeCloseTo(980, 9);
    expect(p.ward).toBe(0);
    expect(p.wardUntil).toBeNull();
    // A ward bigger than the hit survives it.
    grantWard(p, 100, null);
    expect(dealDamage(ctxOf(fight), p, 100, 'x')).toBe(0);
    expect(p.ward).toBeCloseTo(50, 9);
    expect(p.hp).toBeCloseTo(980, 9);
  });

  it('lets a ward lapse at its time, through the event search', () => {
    const fight = fresh();
    const p = fight.player;
    fightAdvance(fight, 0, content, rules);
    grantWard(p, 50, fight.t + sec(0.3));
    expect(fightNextEventIn(fight, content, rules)).toBe(sec(0.3));
    fightAdvance(fight, sec(0.3), content, rules);
    expect(p.ward).toBe(0);
    expect(p.wardUntil).toBeNull();
  });

  it('puts enemy attacks through the same pipeline', () => {
    for (let seed = 1; seed < 80; seed++) {
      const fight = quiet(createFight(scripted([]), enemyAt(LEVEL), seed, content, rules));
      const p = fight.player;
      only(fight).accuracy = 1e9;
      addDecoys(p, 1);
      grantWard(p, 1e6, null);
      fightAdvance(fight, sec(K.eInterval), content, rules);
      if (p.decoys === 1) continue; // the attack missed outright
      // The decoy took the hit: no damage, the ward untouched.
      expect(fight.tally.taken).toBe(0);
      expect(p.ward).toBe(1e6);
      fightAdvance(fight, sec(K.eInterval), content, rules);
      // The next hit is drained by the ward before health.
      expect(fight.tally.taken).toBe(0);
      expect(p.ward).toBeLessThan(1e6);
      return;
    }
    throw new Error('no seed');
  });

  it('also protects an enemy', () => {
    const fight = fresh();
    const e = only(fight);
    addDecoys(e, 1);
    expect(rollHit(ctxOf(fight), e, null)).toBe(false);
    grantWard(e, 10, null);
    expect(dealDamage(ctxOf(fight), e, 25, 'x')).toBe(15);
  });
});

// ---------- hooks ----------

describe('fight hooks', () => {
  const desperate: FightHook = {
    id: 'test:desperate',
    init(ctx, c) {
      c.timers['test:pulse'] = { progress: 0, need: sec(1) * 1000 };
      c.data.pulses = 0;
      c.data.hits = 0;
      void ctx;
    },
    stat: (_ctx, c, which) => (which === 'evasion' ? 2 - c.hp / c.maxHp : 1),
    onTimer(_ctx, c, name) {
      if (name === 'test:pulse') c.data.pulses = (c.data.pulses ?? 0) + 1;
    },
    onDamaged(_ctx, c) {
      c.data.hits = (c.data.hits ?? 0) + 1;
    },
    onDeath(ctx) {
      ctx.fight.tally.statuses.testDeath = 1;
    },
  };
  const custom = { ...rules, fightHooks: [...rules.fightHooks, desperate] };
  const special = () =>
    encounterFor(
      content.enemies.find((e) => e.id === 'core:bandit')!,
      content,
      ['test:desperate'],
    );

  it('contributes a stat computed from the current state', () => {
    const fight = createFight(scripted([]), special(), 1, content, custom);
    const e = only(fight);
    const ctx = { fight, content, rules: custom };
    expect(stat(ctx, e, 'evasion', 100)).toBeCloseTo(100, 9);
    e.hp = e.maxHp / 2;
    expect(stat(ctx, e, 'evasion', 100)).toBeCloseTo(150, 9);
    expect(stat(ctx, e, 'accuracy', 100)).toBe(100);
  });

  it('schedules its own timed events through the event search', () => {
    const fight = quiet(pacify(createFight(scripted([]), special(), 1, content, custom)));
    fightAdvance(fight, 0, content, custom);
    let next = fightNextEventIn(fight, content, custom);
    expect(next).not.toBeNull();
    expect(next).toBeLessThanOrEqual(sec(1));
    fightAdvance(fight, sec(10), content, custom);
    expect(only(fight).data.pulses).toBe(10);
    next = fightNextEventIn(fight, content, custom);
    expect(next).toBeLessThanOrEqual(sec(1));
  });

  it('reacts to damage and to death', () => {
    const fight = quiet(createFight(scripted([]), special(), 1, content, custom), 1000);
    const e = only(fight);
    dealDamage({ fight, content, rules: custom }, e, 10, 'x');
    dealDamage({ fight, content, rules: custom }, e, 10, 'x');
    expect(e.data.hits).toBe(2);
    dealDamage({ fight, content, rules: custom }, e, 5000, 'x');
    expect(fight.tally.statuses.testDeath).toBe(1);
  });

  it('keeps split invariance and determinism with a hook that has timers', () => {
    const run = (chunk: number) => {
      const fight = createFight(playerFor(34, 'katon'), special(), 4, content, custom);
      for (let done = 0; done < sec(40); done += chunk) {
        fightAdvance(fight, Math.min(chunk, sec(40) - done), content, custom);
      }
      return JSON.stringify(fight);
    };
    const whole = run(sec(40));
    for (const chunk of [777, 123_457, sec(1)]) expect(run(chunk)).toBe(whole);
    expect(run(sec(40))).toBe(whole);
  });

  it('gives the traits their behaviour through the rule set: without hooks they do nothing', () => {
    const bare = { ...rules, fightHooks: [] };
    const run = (r: typeof rules) => {
      const fight = quiet(
        createFight(scripted(['core:dynamic_entry']), enemyAt(LEVEL, ['armor']), 1, content, r),
      );
      runUntil(
        fight,
        (f) => (f.tally.uses['core:dynamic_entry'] ?? 0) > 0,
        withAi(castOnce('core:dynamic_entry'), r),
      );
      return fight.tally.damage['core:dynamic_entry'] ?? 0;
    };
    // With the armour hook the first cast is cut; without it, not (same seed, same rolls).
    expect(run(bare)).toBeGreaterThanOrEqual(run(rules));
    const hooks = rules.fightHooks.map((h) => h.id).sort();
    expect(hooks).toEqual([
      'passiveNegate',
      'special:evasionByMissingHp',
      'special:heavyCast',
      'special:illusion',
      'special:packRespawn',
      'special:rehide',
      'special:rival.duel',
      'special:rival.tournament',
      'special:team',
      'special:twins',
      'trait:caster',
      'trait:evasive',
      'trait:hidden',
      'trait:illusionist',
      'trait:poisoner',
    ]);
  });
});

// ---------- signature habituation ----------

describe('signature habituation', () => {
  const palm = 'core:gale_palm';
  function perCast(signature: string | undefined, casts: number) {
    const r = withAi(castSeq(palm));
    const snap = { ...scripted([palm]), ...(signature ? { signature } : {}) };
    const fight = quiet(pacify(createFight(snap, enemyAt(LEVEL), 3, content, r)));
    only(fight).evasion = 0;
    const damage: number[] = [];
    let before = 0;
    for (let n = 1; n <= casts; n++) {
      runUntil(fight, (f) => (f.tally.uses[palm] ?? 0) >= n, r);
      const total = fight.tally.damage[palm] ?? 0;
      damage.push(total - before);
      before = total;
    }
    return { fight, damage };
  }

  it('slows the step of the signature technique by the configured factor', () => {
    const { fight, damage } = perCast(palm, 8);
    const base = tech(fight, palm).damage;
    expect(tech(fight, palm).habituationMult).toBe(K.signatureHabituation);
    let hits = 0;
    damage.forEach((d, i) => {
      if (d === 0) return;
      hits++;
      expect(d / base).toBeCloseTo(
        1 - Math.min(K.habituationCap, K.habituation * K.signatureHabituation * i),
        5,
      );
    });
    expect(hits).toBeGreaterThanOrEqual(6);
  });

  it('leaves other techniques at the normal step', () => {
    const { fight } = perCast(undefined, 1);
    expect(tech(fight, palm).habituationMult).toBe(1);
    const other = perCast('core:dynamic_entry', 1);
    expect(tech(other.fight, palm).habituationMult).toBe(1);
  });
});

void createState;

// ---------- saving around the follow-up of an outcome ----------

describe('a fight saved while it follows up an outcome', () => {
  function fighting(seed: number) {
    const state = genin(seed);
    for (const skill of ['tai', 'nin', 'katon', 'vit', 'med'] as const) setLevel(state, skill, 25);
    refreshUnlocks(state, content, true);
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:bandit' }, content);
    return state;
  }

  it('keeps the pause, carry and paid work of a fled fight across a save', () => {
    const state = fighting(8);
    const fight = state.combat!.fight;
    fight.encounter.spawns[0]!.fleeAt = 0.99;
    only(fight).fleeAt = 0.99;
    for (let i = 0; i < 400 && state.combat?.phase !== 'respawn'; i++) advance(state, 100, content);
    expect(state.combat?.phase).toBe('respawn');
    expect(state.combat?.fight.result).toBe('fled');
    const before = state.combat!;
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.combat?.phase).toBe('respawn');
    expect(loaded.combat?.pause).toBe(before.pause);
    expect(loaded.combat?.carry).toBe(before.carry);
    expect(loaded.combat?.paid).toEqual(before.paid);
    advance(state, 40_000, content);
    advance(loaded, 40_000, content);
    expect(serialize(loaded, 0)).toBe(serialize(state, 0));
  });

  it('keeps the new fight that follows a timeout across a save', () => {
    const state = fighting(9);
    const old = state.combat!.fight;
    for (const e of old.enemies) e.hp = e.maxHp = 1e9;
    old.cap = sec(2);
    advance(state, 2300, content);
    expect(state.combat?.fight).not.toBe(old);
    expect(state.combat?.phase).toBe('fight');
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.combat?.fight.t).toBe(state.combat?.fight.t);
    advance(state, 40_000, content);
    advance(loaded, 40_000, content);
    expect(serialize(loaded, 0)).toBe(serialize(state, 0));
  });
});

// ---------- per-spawn specials, leaving, lifetimes, hook-owned casts ----------

describe('spawn specials', () => {
  it('apply only to the bodies of their spawn, besides the encounter-wide ones', () => {
    const seen: Record<string, string[]> = {};
    const mark = (id: string): FightHook => ({
      id,
      init: (_ctx, c) => void (seen[id] ??= []).push(c.id),
    });
    const custom = { ...rules, fightHooks: [mark('test:leader'), mark('test:all')] };
    const spawn = (enemy: string, count: number, specials: string[]) => ({
      enemy,
      cl: 10,
      traits: [],
      nature: null,
      count,
      hpMult: 1,
      dmgMult: 1,
      fleeAt: null,
      specials,
    });
    const encounter: Encounter = {
      id: 'core:pack',
      specials: ['test:all'],
      spawns: [spawn('core:leader', 1, ['test:leader']), spawn('core:wolf', 3, [])],
    };
    const fight = createFight(scripted([]), encounter, 1, content, custom);
    expect(seen['test:leader']).toHaveLength(1);
    expect(seen['test:all']).toHaveLength(4);
    expect(fight.enemies[0]?.specials).toEqual(['test:all', 'test:leader']);
    expect(fight.enemies[1]?.specials).toEqual(['test:all']);
    expect(parseFight(JSON.parse(JSON.stringify(fight)), content)).toEqual(fight);
    // A body added later gets the same.
    spawnEnemies(fight, 1, content, custom);
    expect(seen['test:leader']).toHaveLength(1);
    expect(seen['test:all']).toHaveLength(5);
  });
});

describe('leaving the fight', () => {
  const pair = (): FightState => {
    const encounter: Encounter = {
      id: 'core:two',
      specials: ['test:watch'],
      spawns: [
        {
          enemy: 'core:bandit',
          cl: 6,
          traits: [],
          nature: null,
          count: 2,
          hpMult: 1,
          dmgMult: 1,
          fleeAt: 0.5,
          specials: [],
        },
      ],
    };
    return quiet(createFight(scripted([]), encounter, 1, content, rules), 1000);
  };
  const left: string[] = [];
  const watch: FightHook = { id: 'test:watch', onLeave: (_ctx, c) => void left.push(c.id) };
  const custom = { ...rules, fightHooks: [...rules.fightHooks, watch] };
  const aura = (id: string, owner: string) => ({
    kind: 'modifier' as const,
    id,
    src: 'test',
    until: null,
    stat: 'evasion' as const,
    op: 'mul' as const,
    value: 2,
    whileAlive: owner,
  });

  it('fires once for a death and once for a flight, and ends effects that last while the body lives', () => {
    left.length = 0;
    const fight = pair();
    const [a, b] = fight.enemies;
    if (!a || !b) throw new Error('no bodies');
    addEffect(fight.player, aura('auraA', a.id));
    addEffect(fight.player, aura('auraB', b.id));
    addEffect(a, aura('selfOfB', b.id));
    const ctx = { fight, content, rules: custom };
    dealDamage(ctx, a, 1e9, 'x');
    expect(left).toEqual([a.id]);
    expect(fight.player.effects.map((e) => e.id)).toEqual(['auraB']);
    // The second body flees instead of dying.
    dealDamage(ctx, b, b.maxHp * 0.6, 'x');
    expect(b.fled).toBe(true);
    expect(left).toEqual([a.id, b.id]);
    expect(fight.player.effects).toEqual([]);
    expect(a.effects).toEqual([]);
    // Nothing fires twice.
    dealDamage(ctx, a, 10, 'x');
    dealDamage(ctx, b, 10, 'x');
    expect(left).toEqual([a.id, b.id]);
  });

  it('ends such an effect through the event path: split invariance holds', () => {
    const run = (chunk: number) => {
      const fight = pair();
      const [a] = fight.enemies;
      if (!a) throw new Error('no bodies');
      addEffect(fight.player, aura('auraA', a.id));
      a.hp = a.maxHp = 40;
      // It bleeds to death on a tick, so the aura ends at an event of the fight.
      addEffect(a, {
        kind: 'periodic',
        id: 'bleed',
        src: 'test',
        until: null,
        mode: 'damage',
        amount: 10,
        every: sec(1),
        next: sec(1),
      });
      for (let done = 0; done < sec(30); done += chunk) {
        fightAdvance(fight, Math.min(chunk, sec(30) - done), content, custom);
      }
      return JSON.stringify(fight);
    };
    const whole = run(sec(30));
    for (const chunk of [1_000_003, 777_777]) expect(run(chunk)).toBe(whole);
    const player = (JSON.parse(whole) as FightState).player;
    expect(player.effects.some((e) => e.id === 'auraA')).toBe(false);
  });
});

describe('casts owned by a hook', () => {
  // A special with its own wind-up: wait, then cast for three seconds, then a heavy blow.
  const charge: FightHook = {
    id: 'test:charge',
    init(_ctx, c) {
      c.timers.charge = { progress: 0, need: sec(2) * 1000 };
      c.data.charging = 0;
    },
    onTimer(ctx, c) {
      const timer = c.timers.charge;
      if (!timer) return;
      if (c.data.charging === 0) {
        c.data.charging = 1;
        timer.need = sec(3) * 1000;
      } else {
        ctx.fight.tally.taken += 1000;
        c.data.charging = 0;
        timer.need = sec(2) * 1000;
      }
    },
    onCancel(_ctx, c) {
      c.data.charging = 0;
      c.timers.charge = { progress: 0, need: sec(2) * 1000 };
    },
    castInfo(_ctx, c) {
      const timer = c.timers.charge;
      if (!timer) return null;
      return {
        kind: 'charge',
        interruptible: true,
        casting: c.data.charging === 1,
        inWork: Math.max(0, Math.ceil((timer.need - timer.progress) / 1000)),
        total: sec(2),
        mult: 1,
      };
    },
  };
  const custom = { ...rules, fightHooks: [...rules.fightHooks, charge] };
  const encounter = () =>
    encounterFor(
      content.enemies.find((e) => e.id === 'core:bandit')!,
      content,
      ['test:charge'],
    );

  it('is interrupted by the default AI, which reads the cast from the view', () => {
    let interrupted = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const fight = quiet(
        pacify(createFight(scripted(['core:dynamic_entry']), encounter(), seed, content, custom)),
      );
      fightAdvance(fight, sec(5.5), content, custom);
      if (fight.tally.interrupts === 1) {
        interrupted++;
        // The blow of this wind-up never came.
        expect(fight.tally.taken).toBe(0);
      } else expect(fight.tally.taken).toBe(1000);
    }
    expect(interrupted).toBeGreaterThan(10);
  });

  it('is not interrupted when there is no interrupt technique', () => {
    const fight = quiet(pacify(createFight(scripted([]), encounter(), 1, content, custom)));
    fightAdvance(fight, sec(5.5), content, custom);
    expect(fight.tally.interrupts).toBe(0);
    expect(fight.tally.taken).toBe(1000);
  });
});
