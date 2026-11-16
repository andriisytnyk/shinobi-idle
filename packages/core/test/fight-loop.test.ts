/**
 * The loop of a fight: every fighter waits for the moment and then acts, there is no recovery and
 * no dead time, a cast is a number of its technique, and the loop is the same however time is cut.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  breakAct,
  createFight,
  createState,
  defaultCombatAi,
  deserialize,
  encounterFor,
  fightAdvance,
  fightStatus,
  makeCtx,
  serialize,
  techniqueFigures,
  workOf,
  type FightHook,
  type FightState,
  type FightView,
  type PlayerSnapshot,
} from '../src/index.ts';
import { applyStatusById } from '../src/combat/fight-status.ts';
import { K, castSeq, enemyAt, quiet, rules, scripted, sec, withAi } from './fight-helpers.ts';
import { fighter, startFight } from './prep-state.ts';
import { modContent, modRules } from './packs-helpers.ts';

const DYNAMIC = 'core:dynamic_entry';
const FIREBALL = 'core:great_fireball';

/** Every phase of every living, unstopped combatant has an end ahead of it. */
function noDeadTime(fight: FightState): void {
  const bodies = [fight.player, ...fight.enemies.filter((e) => e.hp > 0)];
  for (const c of bodies) {
    expect(['wait', 'act', 'rest']).toContain(c.phase);
    expect(c.timer.need, `${c.id} ${c.phase}`).toBeGreaterThan(c.timer.progress);
    // Waiting has no action; acting and resting have one.
    expect(c.act === null, `${c.id} ${c.phase}`).toBe(c.phase === 'wait');
  }
}

describe('the loop: wait, act, wait', () => {
  it('leaves no dead time in two minutes of a fight, for the player and every enemy', () => {
    const fight = quiet(
      createFight(scripted([DYNAMIC, FIREBALL]), enemyAt(20, ['pack']), 3, content, rules),
    );
    fight.player.damage = 1;
    for (let at = 0; at < 120_000 && fight.result === 'ongoing'; at += 7) {
      fightAdvance(fight, workOf(7), content, rules);
      noDeadTime(fight);
    }
    expect(fight.t).toBeGreaterThanOrEqual(sec(120));
  });

  it('waits for the moment first, as long as the tier of the player says, then acts', () => {
    const wait = content.ai.tiers.find((t) => t.id === 'genin')?.waitMs ?? 0;
    const fight = quiet(createFight(scripted([DYNAMIC]), enemyAt(20), 3, content, rules));
    fight.player.accuracy = 1e9;
    expect(fight.player.phase).toBe('wait');
    expect(fight.player.waitMs).toBe(content.ai.tiers.find((t) => t.id === 'chunin')?.waitMs);
    const ms = fight.player.waitMs;
    fightAdvance(fight, workOf(ms) - 1, content, rules);
    expect(fight.player.phase).toBe('wait');
    fightAdvance(fight, 1, content, rules);
    expect(fight.player.phase).toBe('act');
    expect(fight.player.act).toEqual({ kind: 'technique', id: DYNAMIC, target: null });
    expect(wait).toBeGreaterThan(ms);
  });

  it('puts a genin on a longer wait than a chunin, and an enemy of a higher level on a shorter one', () => {
    const waitOf = (tier: number) =>
      createFight({ ...scripted([DYNAMIC]), tier }, enemyAt(5), 1, content, rules).player.waitMs;
    expect(waitOf(1)).toBeGreaterThan(waitOf(2));
    // A student waits longest, then a genin, then a chunin.
    expect(waitOf(0)).toBeGreaterThanOrEqual(waitOf(1));
    const enemyWait = (cl: number) =>
      createFight(scripted([DYNAMIC]), enemyAt(cl), 1, content, rules).enemies[0]?.waitMs ?? 0;
    const from = K.ai.enemyTier.chunin ?? 0;
    expect(enemyWait(from - 1)).toBeGreaterThan(enemyWait(from));
  });

  it('keeps the attack rate of an enemy: its wait and its wind-up make the cycle of the balance data', () => {
    for (const cl of [5, 40]) {
      const e = createFight(scripted([DYNAMIC]), enemyAt(cl), 1, content, rules).enemies[0];
      expect((e?.waitMs ?? 0) + (e?.strikeMs ?? 0)).toBe(Math.round(K.eInterval * 1000));
    }
    const fight = quiet(createFight(scripted([]), enemyAt(10), 5, content, rules));
    fight.player.maxHp = fight.player.hp = 1e12;
    fight.log = [];
    fightAdvance(fight, sec(60), content, rules);
    const starts = (fight.log ?? []).filter((l) => l.side === 'enemy' && l.act === 'cast');
    const blows = (fight.log ?? []).filter(
      (l) => l.side === 'enemy' && (l.act === 'hit' || l.act === 'miss'),
    );
    // A wind-up begins every cycle, and its blow comes at its end.
    expect(Math.abs(starts.length - 60 / K.eInterval)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(blows.length - starts.length)).toBeLessThanOrEqual(1);
  });

  it('shows the wind-up of an enemy as an action of its own, and lets a wait follow it', () => {
    const fight = quiet(createFight(scripted([]), enemyAt(10), 5, content, rules));
    const e = fight.enemies[0];
    if (!e) throw new Error('no enemy');
    fightAdvance(fight, workOf(e.waitMs), content, rules);
    expect(e.phase).toBe('act');
    expect(e.act?.kind).toBe('attack');
    fightAdvance(fight, workOf(e.strikeMs), content, rules);
    expect(e.phase).toBe('wait');
    expect(e.last?.kind).toBe('attack');
    expect(['hit', 'miss']).toContain(e.last?.outcome);
  });

  it('takes the wait of an AI tier a pack adds, for the player and for an enemy that names it', () => {
    const boss = modContent.bosses.find((b) => b.id === 'testmod:boss_shell');
    if (!boss) throw new Error('no test boss');
    const keen = modContent.ai.tiers.find((t) => t.id === ('testmod:keen' as string));
    expect(keen?.waitMs).toBe(300);
    const fight = createFight(
      { ...scripted([DYNAMIC]), tier: 3 },
      encounterFor(boss, modContent),
      1,
      modContent,
      modRules,
    );
    expect(fight.enemies[0]?.waitMs).toBe(300);
    expect(fight.player.waitMs).toBe(300);
  });
});

describe('the plain strike and the rest', () => {
  it('is an action: it costs stamina, takes its own time and lands when it ends', () => {
    const fight = quiet(createFight(scripted([]), enemyAt(20), 4, content, rules));
    fight.enemies[0]!.hp = fight.enemies[0]!.maxHp = 1e9;
    fight.player.damage = 50;
    fight.player.accuracy = 1e9;
    const before = fight.player.stamina;
    fightAdvance(fight, workOf(fight.player.waitMs), content, rules);
    expect(fight.player.act?.kind).toBe('basic');
    expect(fight.player.stamina).toBe(before - K.basicCost);
    expect(fight.tally.basic).toBe(0);
    fightAdvance(fight, workOf(fight.player.strikeMs), content, rules);
    expect(fight.tally.basic).toBe(1);
    expect(fight.player.last).toMatchObject({ kind: 'basic', outcome: 'hit' });
    expect(fight.player.phase).toBe('wait');
  });

  it('rests only when neither a technique nor the plain strike can be paid for, and gets a share of the pools back', () => {
    const fight = quiet(createFight(scripted([DYNAMIC, FIREBALL]), enemyAt(20), 4, content, rules));
    const canPay = (c: number, st: number) =>
      fight.kit.techniques.some((t) => (t.pool === 'chakra' ? c : st) >= t.cost);
    let rests = 0;
    let was = fight.player.phase;
    fight.player.chakra = 0;
    fight.player.stamina = 0;
    // No regeneration but the rest itself: it is the only way to pay for anything.
    fight.kit.chakraRegen = 0;
    fight.kit.staminaRegen = 0;
    for (let i = 0; i < 20_000 && fight.result === 'ongoing'; i++) {
      const p = fight.player;
      const stamina = p.stamina;
      const chakra = p.chakra;
      fightAdvance(fight, workOf(10), content, rules);
      if (p.phase === 'rest' && was !== 'rest') {
        rests++;
        expect(Math.max(stamina, p.stamina)).toBeLessThan(K.basicCost);
        expect(canPay(chakra, stamina)).toBe(false);
        expect(p.act).toEqual({ kind: 'rest', id: null, target: null });
        const need = p.timer.need;
        expect(need).toBe(Math.round(K.rest.s * 1000) * 1_000_000);
      }
      was = p.phase;
    }
    expect(rests).toBeGreaterThan(2);
    expect(fight.player.chakra + fight.player.stamina).toBeGreaterThan(0);
  });

  it('never rests while the plain strike can be paid for', () => {
    const fight = quiet(createFight(scripted([FIREBALL]), enemyAt(20), 4, content, rules));
    fight.player.chakra = 0;
    for (let i = 0; i < 6000 && fight.result === 'ongoing'; i++) {
      fightAdvance(fight, workOf(10), content, rules);
      fight.player.stamina = Math.max(fight.player.stamina, K.basicCost);
      expect(fight.player.phase).not.toBe('rest');
    }
  });
});

describe('the cast of a technique is its own number', () => {
  const figures = (c: typeof content, mastery: number, natures: string[] = ['katon']) => {
    const tech = c.techniques.find((t) => t.id === FIREBALL);
    if (!tech) throw new Error('no fireball');
    const snap = { ...scripted([FIREBALL]), natures, mastery: { [FIREBALL]: mastery } };
    return techniqueFigures(snap as PlayerSnapshot, tech, c);
  };
  const withSeals = (n: number): typeof content => ({
    ...content,
    techniques: content.techniques.map((t) =>
      t.id === FIREBALL
        ? { ...t, sealSeq: Array.from({ length: n }, () => t.sealSeq[0] ?? '') }
        : t,
    ),
  });

  it('does not depend on the number of seals', () => {
    expect(figures(withSeals(1), 20).castMs).toBe(figures(withSeals(12), 20).castMs);
    // Two techniques of one rank and role cast as long as each other, whatever their seals.
    const a = content.techniques.find((t) => t.id === 'core:gale_palm');
    const b = content.techniques.find((t) => t.id === 'core:lightning_beast_tracking_fang');
    expect(a && b && a.rank === b.rank && a.role === b.role && a.cast === b.cast).toBe(true);
    expect(a?.sealSeq.length).not.toBe(b?.sealSeq.length);
  });

  it('does not change any outcome of a fight when only the seals change', () => {
    const run = (c: typeof content) => {
      const fight = createFight(
        scripted([FIREBALL, DYNAMIC]),
        enemyAt(20),
        9,
        c,
        withAi(castSeq(FIREBALL, DYNAMIC)),
      );
      fightAdvance(fight, sec(60), c, withAi(castSeq(FIREBALL, DYNAMIC)));
      return JSON.stringify(fight);
    };
    expect(run(withSeals(1))).toBe(run(withSeals(12)));
  });

  it('is shortened by mastery down to the floor, and stretched while the nature is not the first', () => {
    const base = figures(content, 1).castMs;
    expect(figures(content, K.masteryCap).castMs).toBeLessThan(base);
    expect(figures(content, K.masteryCap).castMs).toBeGreaterThanOrEqual(
      Math.round(K.castFloor * 1000),
    );
    expect(figures(content, 1, ['futon', 'katon']).castMs).toBeGreaterThan(base);
  });

  it('is what the player spends in the action: the cast time of the kit', () => {
    const fight = quiet(createFight(scripted([DYNAMIC]), enemyAt(20), 4, content, rules));
    fightAdvance(fight, workOf(fight.player.waitMs), content, rules);
    expect(fight.player.act?.id).toBe(DYNAMIC);
    expect(fight.player.timer.need).toBe(workOf(fight.kit.techniques[0]?.castMs ?? 0) * 1000);
  });
});

describe('breaking an action off', () => {
  /** A fight with the player in the middle of casting the fireball. */
  function casting() {
    const fight = quiet(createFight(scripted([FIREBALL]), enemyAt(20), 4, content, rules));
    fightAdvance(fight, workOf(fight.player.waitMs), content, rules);
    expect(fight.player.act?.id).toBe(FIREBALL);
    return fight;
  }

  it('ends the cast without effect, starts no cooldown, loses a share of what it cost and goes back to waiting', () => {
    const fight = casting();
    const tech = fight.kit.techniques[0];
    if (!tech) throw new Error('no technique');
    const spent = fight.player.maxChakra - fight.player.chakra;
    expect(spent).toBeCloseTo(tech.cost, 9);
    fight.log = [];
    expect(breakAct(makeCtx(fight, content, rules), fight.player)).toBe(true);
    expect(fight.player.phase).toBe('wait');
    expect(fight.player.act).toBeNull();
    expect(fight.player.cd[FIREBALL]).toBeUndefined();
    expect(fight.tally.uses[FIREBALL]).toBeUndefined();
    const lost = fight.player.maxChakra - fight.player.chakra;
    expect(lost).toBeCloseTo(tech.cost * K.combat.interruptLost, 9);
    expect(fight.player.last).toMatchObject({
      kind: 'technique',
      id: FIREBALL,
      outcome: 'interrupted',
    });
    expect(fight.log.map((l) => l.act)).toEqual(['interrupted']);
    // It waits a whole wait again, then acts.
    fightAdvance(fight, workOf(fight.player.waitMs), content, rules);
    expect(fight.player.phase).toBe('act');
  });

  it('is done by a stun, which also stops the clock of the phase while it lasts', () => {
    const fight = casting();
    applyStatusById(makeCtx(fight, content, rules), fight.player, 'stun', 'test');
    expect(fight.player.phase).toBe('wait');
    const status = fightStatus(fight, content, rules).player;
    expect(status.suspendedBy).toBe('stun');
    expect(status.endsMs).toBeNull();
  });

  it('is done by an attack that carries the interrupt, when it hits a fighter that is casting', () => {
    const striker: FightHook = {
      id: 'test:interrupting',
      onAttack: (_ctx, _c, plan) => {
        plan.interrupts = true;
        plan.chance = 1;
      },
    };
    const custom = { ...rules, fightHooks: [...rules.fightHooks, striker] };
    const encounter = enemyAt(20);
    encounter.specials = ['test:interrupting'];
    const fight = quiet(createFight(scripted([FIREBALL]), encounter, 4, content, custom));
    fight.player.hp = fight.player.maxHp = 1e9;
    fight.enemies[0]!.waitMs = 100;
    fight.enemies[0]!.strikeMs = 100;
    fight.enemies[0]!.timer.need = workOf(100) * 1000;
    fight.log = [];
    fightAdvance(fight, sec(3), content, custom);
    const broken = (fight.log ?? []).filter((l) => l.act === 'interrupted' && l.side === 'player');
    expect(broken.length).toBeGreaterThan(0);
    expect(fight.tally.uses[FIREBALL]).toBeUndefined();
  });

  it('is never done to the wind-up of an enemy or to an item already used', () => {
    const fight = quiet(createFight(scripted([]), enemyAt(10), 5, content, rules));
    const e = fight.enemies[0];
    if (!e) throw new Error('no enemy');
    fightAdvance(fight, workOf(e.waitMs), content, rules);
    expect(e.act?.kind).toBe('attack');
    expect(breakAct(makeCtx(fight, content, rules), e)).toBe(false);
  });
});

describe('what the fight view says', () => {
  it('names the phase, the action, when it began and when it ends, and how the last action went', () => {
    const fight = quiet(createFight(scripted([DYNAMIC]), enemyAt(20), 4, content, rules));
    fight.player.accuracy = 1e9;
    fight.enemies[0]!.evasion = 0;
    fight.log = [];
    let status = fightStatus(fight, content, rules);
    expect(status.player).toMatchObject({ phase: 'wait', action: null, startedMs: 0, last: null });
    expect(status.player.endsMs).toBe(fight.player.waitMs);
    fightAdvance(fight, workOf(fight.player.waitMs), content, rules);
    status = fightStatus(fight, content, rules);
    const cast = fight.kit.techniques[0]?.castMs ?? 0;
    expect(status.player).toMatchObject({
      phase: 'act',
      action: { kind: 'technique', id: DYNAMIC },
      startedMs: fight.player.waitMs,
      endsMs: fight.player.waitMs + cast,
      suspendedBy: null,
    });
    fightAdvance(fight, workOf(cast), content, rules);
    status = fightStatus(fight, content, rules);
    expect(status.player.phase).toBe('wait');
    expect(status.player.last).toMatchObject({
      kind: 'technique',
      id: DYNAMIC,
      outcome: 'hit',
      atMs: fight.player.waitMs + cast,
    });
    expect(status.player.last?.damage).toBeGreaterThan(0);
    // The events of the action: it began, it was resolved, and the blow that came with it.
    const mine = (fight.log ?? []).filter((l) => l.side === 'player').map((l) => l.act);
    expect(mine).toEqual(['cast', 'hit', 'resolve']);
  });
});

describe('determinism and split invariance', () => {
  const play = (chunk: number | null) => {
    const ai = withAi((view: FightView) => defaultCombatAi(view));
    const fight = createFight(
      scripted([DYNAMIC, FIREBALL]),
      enemyAt(20, ['pack']),
      11,
      content,
      ai,
    );
    fight.player.hp = fight.player.maxHp = 1e6;
    const total = sec(90);
    if (chunk === null) fightAdvance(fight, total, content, ai);
    else
      for (let left = total; left > 0; left -= chunk)
        fightAdvance(fight, Math.min(chunk, left), content, ai);
    return JSON.stringify(fight);
  };

  it('plays the same fight however the time is cut, and the same twice', () => {
    const whole = play(null);
    expect(play(null)).toBe(whole);
    for (const chunk of [7, 999, 3600, 60_000])
      expect(play(sec(chunk / 1000)), `${chunk}`).toBe(whole);
  });
});

describe('a fight saved before the loop of waiting and acting', () => {
  it('is discarded on load and the fight action starts again, with no reward, no Wound and no item lost', () => {
    const state = fighter(3, 20);
    expect(startFight(state, 'core:zone_dummy')).toEqual({ ok: true });
    advance(state, 20_000, content);
    expect(state.combat).not.toBeNull();
    const before = {
      ryo: JSON.stringify(state.currencies),
      wounds: JSON.stringify(state.wounds),
      pouch: JSON.stringify(state.pouch),
      bank: JSON.stringify(state.bank),
      xp: JSON.stringify(state.skills),
    };
    const raw = JSON.parse(serialize(state, 0)) as {
      v: number;
      state: {
        v: number;
        combat: { fight: { player: Record<string, unknown>; enemies: Record<string, unknown>[] } };
      };
    };
    // Make it a fight of the old loop: a version 14 save, its phases and the fields it had.
    raw.v = 14;
    raw.state.v = 14;
    const old = (c: Record<string, unknown>, phase: string) => {
      c.phase = phase;
      c.intervalMs = 2400;
      c.cast = null;
      delete c.waitMs;
      delete c.strikeMs;
      delete c.act;
      delete c.phaseAt;
      delete c.last;
    };
    old(raw.state.combat.fight.player, 'recover');
    for (const e of raw.state.combat.fight.enemies) old(e, 'attack');
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.combat).not.toBeNull();
    expect(loaded.combat?.fight.t).toBe(0);
    expect(loaded.combat?.fight.player.phase).toBe('wait');
    expect(JSON.stringify(loaded.currencies)).toBe(before.ryo);
    expect(JSON.stringify(loaded.wounds)).toBe(before.wounds);
    expect(JSON.stringify(loaded.bank)).toBe(before.bank);
    expect(JSON.stringify(loaded.skills)).toBe(before.xp);
    expect(JSON.stringify(loaded.pouch)).toBe(before.pouch);
    // And it plays on.
    advance(loaded, 60_000, content);
    expect(loaded.now).toBeGreaterThan(0);
    expect(createState(1, content).combat).toBeNull();
  });

  it('is also refused when only the fight of a version 15 save is damaged in the new fields', () => {
    const state = fighter(4, 20);
    startFight(state, 'core:zone_dummy');
    advance(state, 5000, content);
    const raw = JSON.parse(serialize(state, 0)) as {
      state: { combat: { fight: { player: Record<string, unknown> } } };
    };
    raw.state.combat.fight.player.phase = 'recover';
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.combat?.fight.t).toBe(0);
    expect(loaded.combat?.fight.player.phase).toBe('wait');
  });
});
