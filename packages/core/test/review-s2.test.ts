/** Review fixes of S2-3: the knowledge gate on the analysis, the bounty in the book, report hygiene, the order of Intel levels. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  analyzeFight,
  bingoView,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  mergeReport,
  noteFight,
  parseReport,
  blankReport,
  revealAt,
  rollLoot,
  grantLoot,
  noteBounty,
  serialize,
  type GameState,
} from '../src/index.ts';
import { K } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, ids, run, startFight, stock } from './prep-state.ts';

const sessionOf = (state: GameState, zone: string) => {
  const a = analyzeFight(
    state,
    { kind: 'zone', id: zone },
    { samples: 20, sessionMinutes: 30, sessionRuns: 1 },
    content,
    defaultRules,
  );
  if (!a?.session) throw new Error('no session');
  return a.session;
};

/** A state whose Bingo entry for `id` stands at `level` (0 to 3) by the rules of the book. */
function atLevel(state: GameState, id: string, level: number): void {
  const wins = level === 3 ? 100 : level === 2 ? 1 : 0;
  if (level > 0) {
    state.bingo[id] = { seen: 1, wins, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
  }
}

describe('the analysis shows loot only as far as the Bingo book does', () => {
  it('hides the carried part and its chance of an enemy the player has not met, and opens them level by level', () => {
    const part = 'core:scrollpart_wave_of_inspiration';
    for (const level of [0, 1, 2, 3]) {
      const state = fighter(1, 40, 'katon');
      stock(state, { [ids.heal]: 400 });
      atLevel(state, 'core:kumo', level);
      const s = sessionOf(state, 'core:zone_kumo');
      const text = JSON.stringify(s);
      if (level < 2) {
        expect(s.ryoPerHour, `ryo at ${level}`).toBe('unknown');
        expect(s.lootPerHour[part]).toBeUndefined();
        expect(s.lootUnknown).toBeGreaterThanOrEqual(1);
        expect(text).not.toContain('wave_of_inspiration');
      } else {
        expect(typeof s.ryoPerHour).toBe('number');
        expect(s.lootUnknown).toBe(0);
        // The part is named from level 2; its rate is a number only from level 3.
        expect(s.lootPerHour[part]).toBe(level === 3 ? s.lootPerHour[part] : 'unknown');
        if (level === 3) expect(s.lootPerHour[part]).toBeGreaterThan(0);
      }
    }
  });

  it('hides trophies until level 3 as the book does', () => {
    for (const level of [0, 2, 3]) {
      const state = fighter(2, 40, 'katon');
      stock(state, { [ids.heal]: 400 });
      atLevel(state, 'core:wolf', level);
      const s = sessionOf(state, 'core:zone_wolf');
      const view = bingoView(state, 'core:wolf', content);
      const trophies = content.enemies.find((e) => e.id === 'core:wolf')?.drops ?? [];
      for (const d of trophies) {
        if (view?.drops) expect(Object.keys(s.lootPerHour)).toContain(d.item);
        else expect(Object.keys(s.lootPerHour)).not.toContain(d.item);
      }
      if (!view?.drops) expect(s.lootUnknown).toBeGreaterThanOrEqual(0);
    }
  });

  it('is one function: the view reads the same reveal the analysis does', () => {
    for (const level of [0, 1, 2, 3]) {
      const state = fighter(3, 30, 'katon');
      atLevel(state, 'core:kumo', level);
      const view = bingoView(state, 'core:kumo', content);
      const reveal = revealAt(level);
      expect(view?.carries !== null).toBe(reveal.carries);
      expect(view?.drops !== null).toBe(reveal.drops);
    }
  });
});

describe('the bounty in the book', () => {
  it('is written where it is paid: in full, then at the repeat share, through the view', () => {
    const boss = content.bosses.find((b) => b.bounty !== null);
    if (!boss?.bounty) throw new Error('no bounty');
    const state = createState(1, content);
    // Level 3 so that the view shows the bounty.
    state.bingo[boss.id] = { seen: 1, wins: 0, losses: 0, timeouts: 0, bought: 3, bounty: 0 };
    expect(bingoView(state, boss.id, content)?.bounty?.paid).toBe(0);
    const pay = (): number => {
      const loot = rollLoot(state, boss);
      grantLoot(state, boss.id, loot);
      noteBounty(state, boss.id, loot.bounty);
      noteFight(state, boss.id, 'win', content);
      return loot.bounty;
    };
    const first = pay();
    expect(first).toBe(boss.bounty.first);
    expect(bingoView(state, boss.id, content)?.bounty?.paid).toBe(first);
    const repeat = pay();
    expect(repeat).toBe(Math.round(boss.bounty.first * K.bountyRepeat));
    expect(bingoView(state, boss.id, content)?.bounty?.paid).toBe(first + repeat);
  });

  it('is written by a real boss fight', () => {
    const state = fighter(2, 50, 'katon');
    setLevel(state, 'futon', 50);
    run(state, { type: 'loadout.auto', on: true });
    state.flags['boss.wolf.unlocked'] = true;
    expect(startFight(state, 'core:zone_boss_wolf')).toEqual({ ok: true });
    for (let t = 0; t < 600_000 && (state.bingo['core:boss_wolf']?.wins ?? 0) < 2; t += 500) {
      for (const e of state.combat?.fight.enemies ?? []) e.hp = Math.min(e.hp, 1);
      advance(state, 500, content);
    }
    const b = state.bingo['core:boss_wolf'];
    expect(b?.wins).toBeGreaterThanOrEqual(2);
    const bounty = content.bosses.find((x) => x.id === 'core:boss_wolf')?.bounty;
    expect(b?.bounty).toBe(
      (bounty?.first ?? 0) + Math.round((bounty?.first ?? 0) * K.bountyRepeat),
    );
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.bingo['core:boss_wolf']?.bounty).toBe(b?.bounty);
  });
});

describe('Intel buys the levels in order', () => {
  const study = (state: GameState, enemy: string) =>
    dispatch(state, { type: 'bingo.study', enemy }, content);

  it('gives the first sight, refuses the level that a fight earns, and sells the studied level after it', () => {
    const state = fighter(4, 30, 'katon');
    state.currencies.intel = 20;
    expect(study(state, 'core:wolf')).toEqual({ ok: true });
    expect(study(state, 'core:wolf')).toEqual({ ok: false, reason: 'error.bingoNeedsFight' });
    expect(bingoView(state, 'core:wolf', content)?.canStudy).toBe(false);
    noteFight(state, 'core:wolf', 'win', content);
    expect(bingoView(state, 'core:wolf', content)?.level).toBe(2);
    expect(study(state, 'core:wolf')).toEqual({ ok: true });
    expect(bingoView(state, 'core:wolf', content)?.level).toBe(3);
    expect(state.currencies.intel).toBe(20 - 2 * K.intel.bingoLevel);
  });
});

describe('the report counts the combos of every combo in the content', () => {
  for (const combo of content.combos) {
    it(`${combo.id}: a technique of ${combo.nature} after one that applies ${combo.onState}`, () => {
      const usable = (t: (typeof content.techniques)[number]) =>
        t.rank !== null && t.combat !== null;
      const lowest = (list: typeof content.techniques) =>
        [...list].sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : 1))[0];
      const applier = lowest(
        content.techniques.filter(
          (t) => usable(t) && t.state === combo.onState && t.skill !== combo.nature,
        ),
      );
      const hitter = lowest(
        content.techniques.filter((t) => usable(t) && t.skill === combo.nature && !t.noDamage),
      );
      if (!applier || !hitter) throw new Error(`no pair for ${combo.id}`);
      const state = fighter(9, 70, 'katon');
      state.player.rank = 'chunin';
      state.player.natures = [applier.skill, hitter.skill] as GameState['player']['natures'];
      for (const skill of [applier.skill, hitter.skill]) setLevel(state, skill, 70);
      state.known[applier.id] = true;
      state.known[hitter.id] = true;
      run(state, { type: 'loadout.set', techniques: [applier.id, hitter.id] });
      expect(startFight(state, 'core:zone_bandit')).toEqual({ ok: true });
      // An enemy that does not fall, a player who does not either: the fight runs to its time cap and is reported.
      for (let t = 0; t < K.combat.fightCapMs + 10_000; t += 500) {
        for (const e of state.combat?.fight.enemies ?? []) e.hp = e.maxHp = 1e12;
        const p = state.combat?.fight.player;
        if (p) p.hp = p.maxHp = 1e12;
        advance(state, 500, content);
      }
      const report = state.report['core:zone_bandit'];
      expect(report?.timeouts).toBeGreaterThanOrEqual(1);
      expect(report?.combos[combo.id] ?? 0).toBeGreaterThan(0);
    });
  }
});

describe('the report stays clean', () => {
  it('keeps only keys the content names when a tampered save is read, and caps the maps by that', () => {
    const state = fighter(5, 30, 'katon');
    startFight(state, 'core:zone_bandit');
    advance(state, 30_000, content);
    const raw = JSON.parse(serialize(state, 0)) as {
      state: { report: Record<string, Record<string, unknown>> };
    };
    const forged: Record<string, number> = {};
    for (let i = 0; i < 50_000; i++) forged[`core:forged_${i}`] = 1;
    const target = raw.state.report['core:zone_bandit'];
    if (!target) throw new Error('no report');
    for (const field of ['damage', 'uses', 'statuses', 'combos', 'habLow', 'items']) {
      target[field] = { ...(target[field] as object), ...forged };
    }
    (target.loot as { items: object }).items = { ...forged };
    const loaded = deserialize(JSON.stringify(raw), content);
    const r = loaded.report['core:zone_bandit'];
    const keys = (o: Record<string, number> | undefined) => Object.keys(o ?? {});
    expect(
      keys(r?.damage).every(
        (k) => k === 'basic' || k.startsWith('trait:') || k.startsWith('core:'),
      ),
    ).toBe(true);
    for (const field of [
      r?.damage,
      r?.uses,
      r?.statuses,
      r?.combos,
      r?.habLow,
      r?.items,
      r?.loot.items,
    ]) {
      expect(keys(field).some((k) => k.startsWith('core:forged_'))).toBe(false);
    }
    expect(JSON.stringify(loaded.report).length).toBeLessThan(6000);
    expect(parseReport({ fights: 1 }, content)?.fights).toBe(1);
  });

  it('copies defeats when reports merge, so the source is never shared', () => {
    const a = blankReport();
    const b = blankReport();
    b.defeats.push({ at: 5, enemy: 'core:x', tMs: 1, chakra: 2, stamina: 3 });
    mergeReport(a, b, K.report.defeats);
    expect(a.defeats).toEqual(b.defeats);
    const first = a.defeats[0];
    if (!first) throw new Error('no defeat');
    first.chakra = 99;
    expect(b.defeats[0]?.chakra).toBe(2);
  });
});
