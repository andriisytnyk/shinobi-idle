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
  unlockBoss,
  UNKNOWN,
  type AnalysisTarget,
  rollLoot,
  grantLoot,
  noteBounty,
  serialize,
  type GameState,
} from '../src/index.ts';
import { K } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, ids, run, startFight, stock } from './prep-state.ts';

/** What the analysis may show of one target at a Bingo level, so that two targets can be compared. */
function gated(state: GameState, target: AnalysisTarget) {
  const a = analyzeFight(
    state,
    target,
    { samples: 20, minSessions: 1, maxSessions: 1, sessionMinutes: 20 },
    content,
    defaultRules,
  );
  if (!a?.session) throw new Error('no session');
  return {
    ryo: a.session.ryoPerHour,
    bounty: a.session.bountyPerHour,
    loot: a.session.loot,
    once: a.once.bounty,
    session: a.session,
  };
}

/** A state whose Bingo entry for `id` stands at `level` (0 to 3) by the rules of the book. */
function atLevel(state: GameState, id: string, level: number): void {
  const wins = level === 3 ? 100 : level === 2 ? 1 : 0;
  delete state.bingo[id];
  if (level > 0) {
    state.bingo[id] = { seen: 1, wins, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
  }
}

const withBounty = content.bosses.find((x) => x.bounty !== null);
const withoutBounty = content.bosses.find((x) => x.bounty === null && x.scrollPart === null);
const zoneOf = (id: string): AnalysisTarget => ({
  kind: 'boss',
  id: content.zones.find((z) => z.enemy === id)?.id ?? id,
});

describe('the analysis shows loot only as far as the Bingo book does, and hides it without a trace', () => {
  function player(seed: number): GameState {
    const state = fighter(seed, 50, 'katon');
    setLevel(state, 'futon', 50);
    stock(state, { [ids.heal]: 100 });
    for (const b of content.bosses) unlockBoss(state, b.id, content);
    return state;
  }

  it('gives the same constant markers for a boss with a bounty and a boss without one, until the book shows them', () => {
    if (!withBounty || !withoutBounty) throw new Error('no bosses to compare');
    for (const level of [0, 1, 2]) {
      const x = player(1);
      const y = player(2);
      atLevel(x, withBounty.id, level);
      atLevel(y, withoutBounty.id, level);
      const a = gated(x, zoneOf(withBounty.id));
      const b = gated(y, zoneOf(withoutBounty.id));
      // The bounty is hidden below level 3 in every way: the per-hour figure and the one-off alike.
      expect(a.bounty, `bounty at ${level}`).toBe(UNKNOWN);
      expect(b.bounty).toBe(UNKNOWN);
      expect(a.once).toBe(UNKNOWN);
      expect(b.once).toBe(UNKNOWN);
      if (level < 2) {
        expect(a.ryo).toBe(UNKNOWN);
        expect(b.ryo).toBe(UNKNOWN);
        expect(a.loot).toBe(UNKNOWN);
        expect(b.loot).toBe(UNKNOWN);
      } else {
        expect(typeof a.ryo).toBe('number');
        expect(typeof b.ryo).toBe('number');
      }
    }
    // Studied by Intel, not yet beaten: the first-kill bounty is still to come.
    const x = player(3);
    x.bingo[withBounty.id] = { seen: 1, wins: 0, losses: 0, timeouts: 0, bought: 3, bounty: 0 };
    expect(gated(x, zoneOf(withBounty.id)).once).toBe(withBounty.bounty?.first);
  });

  it('keeps the bounty out of ryo per hour: ryo is the same with and without a bounty on the boss', () => {
    if (!withBounty) throw new Error('no boss with a bounty');
    const x = player(4);
    atLevel(x, withBounty.id, 2);
    const a = gated(x, zoneOf(withBounty.id));
    // Each win pays a ryo drop inside the boss's range; a bounty of hundreds would put the mean far above it.
    const wins = (a.session.winsPerHour.mean * a.session.minutes) / 60;
    if (wins > 0 && typeof a.ryo === 'number') {
      expect(a.ryo / a.session.winsPerHour.mean).toBeLessThanOrEqual(withBounty.ryo[1]);
    }
  });

  it('opens loot level by level: nothing, nothing, the rows without chances, the chances', () => {
    const part = 'core:scrollpart_wave_of_inspiration';
    for (const level of [0, 1, 2, 3]) {
      const state = fighter(5, 40, 'katon');
      stock(state, { [ids.heal]: 400 });
      atLevel(state, 'core:kumo', level);
      const s = gated(state, { kind: 'zone', id: 'core:zone_kumo' }).session;
      const text = JSON.stringify(s);
      if (level < 2) {
        expect(s.loot).toBe(UNKNOWN);
        expect(s.ryoPerHour).toBe(UNKNOWN);
        expect(text).not.toContain('wave_of_inspiration');
      } else {
        expect(typeof s.ryoPerHour).toBe('number');
        expect(Object.keys(s.loot)).toContain(part);
        const row = (s.loot as Record<string, unknown>)[part];
        if (level === 2) expect(row).toBe(UNKNOWN);
        else expect(typeof row).toBe('number');
      }
    }
  });

  it('shows trophies from level 2 and their chances from level 3, as the book does', () => {
    for (const level of [0, 2, 3]) {
      const state = fighter(6, 40, 'katon');
      stock(state, { [ids.heal]: 400 });
      atLevel(state, 'core:wolf', level);
      const s = gated(state, { kind: 'zone', id: 'core:zone_wolf' }).session;
      const view = bingoView(state, 'core:wolf', content);
      const trophies = content.enemies.find((e) => e.id === 'core:wolf')?.drops ?? [];
      for (const d of trophies) {
        if (level < 2) expect(s.loot).toBe(UNKNOWN);
        else {
          const row = (s.loot as Record<string, unknown>)[d.item];
          expect(typeof row === 'number', `${d.item} at ${level}`).toBe(level === 3);
          expect(view?.drops?.find((x) => x.item === d.item)?.chance === null).toBe(level === 2);
        }
      }
    }
  });

  it('is one function: the view reads the same reveal the analysis does', () => {
    for (const level of [0, 1, 2, 3]) {
      const state = fighter(7, 30, 'katon');
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

  it('drops a defeat whose enemy the content does not know', () => {
    const forged = {
      defeats: [
        { at: 1, enemy: 'core:ghost', tMs: 1, chakra: 1, stamina: 1 },
        { at: 2, enemy: 'core:bandit', tMs: 1, chakra: 1, stamina: 1 },
      ],
    };
    expect(parseReport(forged, content)?.defeats.map((d) => d.enemy)).toEqual(['core:bandit']);
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
