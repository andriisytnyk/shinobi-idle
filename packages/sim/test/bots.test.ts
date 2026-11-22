import { content } from '@shinobi/content';
import { defaultRules, perFight, simulateFights } from '@shinobi/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  allEntries,
  buildCharacter,
  buildGeninStart,
  combatSkills,
  craftsReport,
  createFighterBot,
  defaultNature,
  encounterOf,
  equipFor,
  fightRow,
  fightSnapshot,
  modelFood,
  reasonsFor,
  REPORT,
  runCli,
  runHourly,
  type CraftsReport,
  type FightStats,
} from '../src/index.ts';

const run = (args: string[]): string => {
  const r = runCli(args);
  expect(r.err).toEqual([]);
  expect(r.code).toBe(0);
  return r.out.join('\n');
};

interface Row {
  enemy: string;
  model: unknown;
  ratio: number | null;
  flagged: boolean;
  reasons: string[];
  food: string;
  pouch: string;
  level: number;
  requestedLevel: number;
  winRate: number;
  withPouch: unknown;
}

describe('pnpm sim fight', () => {
  it('prints byte-identical JSON for the same seed', () => {
    const enemy = content.enemies[3]?.id ?? '';
    const args = ['fight', '--enemy', enemy, '--runs', '20', '--json'];
    const a = run([...args, '--seed', '1']);
    expect(run([...args, '--seed', '1'])).toBe(a);
    expect(run([...args, '--seed', '2'])).not.toBe(a);
  });

  it('covers every enemy and boss entry in content with a model column and a reason for each mark', () => {
    const entries = allEntries(content);
    expect(entries.length).toBe(content.enemies.length + content.bosses.length);
    const rows = JSON.parse(
      run(['fight', '--all', '--seed', '1', '--runs', '5', '--json']),
    ) as Row[];
    expect(rows.map((r) => r.enemy).sort()).toEqual(entries.map((e) => e.id).sort());
    const bossIds = new Set(content.bosses.map((b) => b.id));
    for (const r of rows) {
      expect(r.model).not.toBeNull();
      expect(r.withPouch).not.toBeNull();
      expect(r.pouch).toBe('none');
      expect(r.food).toBe(bossIds.has(r.enemy) ? 'model' : 'none');
      expect(r.flagged).toBe(r.reasons.length > 0);
      if (r.ratio === null) expect(r.reasons).toContain('noWins');
    }
    // Text mode prints a header with what the model ignores and the thresholds.
    const text = run(['fight', '--all', '--seed', '1', '--runs', '3']);
    expect(text).toContain('Модель не враховує');
    expect(text).toContain('мірило');
  });

  it('builds the character with the engine and agrees with simulateFights', () => {
    const entry = content.enemies[6] ?? content.enemies[0];
    if (!entry) throw new Error('no enemies in content');
    const state = buildCharacter(content, {
      seed: 3,
      level: entry.cl,
      rank: 'genin',
      natures: [defaultNature(content)],
    });
    equipFor(state, entry.id, content, defaultRules, { pouch: 'shop', food: 'none' }, entry.cl);
    expect(state.loadouts.active.length).toBeGreaterThan(0);
    const snap = fightSnapshot(state, entry.id, content, defaultRules);
    const enc = encounterOf(state, entry, content);
    const reference = simulateFights(snap, enc, 30, 3, content, defaultRules);
    const row = fightRow(entry, {
      entries: [entry.id],
      runs: 30,
      seed: 3,
      level: entry.cl,
      rank: 'genin',
      pouch: 'shop',
      food: 'none',
    });
    expect(row.stats.winRate).toBeCloseTo(reference.winRate, 10);
    expect(row.stats.timeSec?.mean ?? 0).toBeCloseTo(reference.timeMs.mean / 1000, 6);
  });

  it('stocks the shop pouch through the engine even with village gating, and none when asked', () => {
    const entry = content.enemies[6];
    if (!entry) throw new Error('no enemies in content');
    const base = { seed: 1, level: 25, rank: 'genin' as const, natures: [defaultNature(content)] };
    const shop = buildCharacter(content, base);
    equipFor(shop, entry.id, content, defaultRules, { pouch: 'shop', food: 'none' }, 25);
    expect(shop.pouch.slots.some((s) => s.id !== '' && s.n > 0)).toBe(true);
    const none = buildCharacter(content, base);
    equipFor(none, entry.id, content, defaultRules, { pouch: 'none', food: 'none' }, 25);
    expect(none.pouch.slots.every((s) => s.id === '')).toBe(true);
  });

  it('gives the meals of the balance model to a boss by default, and none to an ordinary enemy', () => {
    const food = modelFood(30, content);
    expect(food?.n).toBe(perFight(content, 'core:pk_food'));
    const boss = content.bosses[0];
    if (!boss) throw new Error('no bosses in content');
    const row = fightRow(boss, { entries: [boss.id], runs: 3, seed: 1, comparePouch: false });
    expect(row.food).toBe('model');
    expect(
      fightRow(boss, { entries: [boss.id], runs: 3, seed: 1, food: 'none', comparePouch: false })
        .food,
    ).toBe('none');
  });

  it('marks rows by win rate, by too few wins and by the ratio, each with a reason', () => {
    const stats = (winRate: number): FightStats => ({
      runs: 100,
      winRate,
      outcomes: { victory: 0, defeat: 0, fled: 0, timeout: 0 },
      timeSec: null,
      hpLeft: null,
      maxHp: 1,
      damageShare: {},
    });
    expect(reasonsFor(false, stats(1), 100, 1)).toEqual([]);
    expect(reasonsFor(false, stats(REPORT.enemyMinWin - 0.05), 90, 1)).toEqual(['win']);
    expect(reasonsFor(false, stats(1), 100, REPORT.ratioBand[1] + 0.1)).toEqual(['ratio']);
    expect(reasonsFor(true, stats(0.2), 20, 1)).toEqual(['win']);
    expect(reasonsFor(true, stats(REPORT.bossWinBand[0] + 0.05), 70, 1)).toEqual([]);
    expect(reasonsFor(true, stats(0.99), 99, 1)).toEqual(['win']);
    expect(reasonsFor(true, stats(0.03), 3, 1)).toEqual(['fewWins', 'win']);
    expect(reasonsFor(true, stats(0), 0, null)).toEqual(['noWins', 'win']);
  });

  it('notes a level above the skill cap that was cut down', () => {
    const enemy = content.enemies[0]?.id ?? '';
    const r = runCli(['fight', '--enemy', enemy, '--level', '999', '--runs', '3']);
    expect(r.code).toBe(0);
    expect(r.err.join(' ')).toContain(String(content.balance.K.cap));
  });

  it('rejects bad arguments and prints help', () => {
    expect(runCli(['fight', '--help']).out.join('\n')).toContain('--pouch');
    expect(runCli(['fight']).code).toBe(1);
    expect(runCli(['fight', '--enemy', 'core:nobody']).code).toBe(1);
    expect(runCli(['fight', '--all', '--natures', 'nonsense']).code).toBe(1);
    expect(runCli(['fight', '--all', '--pouch', 'bag']).code).toBe(1);
    expect(runCli(['crafts', '--help']).out.join('\n')).toContain('--hours');
    expect(runCli(['fighter', '--help']).out.join('\n')).toContain('--hours');
  });
});

describe('pnpm sim crafts', () => {
  let report: CraftsReport;
  // Six game hours of the crafts bot take about 5 s alone and more on a loaded runner (the village,
  // modifier and world ticks dominate the profile since the balance fit). There is no wall-clock
  // assertion here, so the hook gets a generous explicit timeout instead of the 10 s default.
  beforeAll(() => {
    report = craftsReport({ seed: 1, hours: 6 });
  }, 120_000);

  it('prints byte-identical JSON for the same seed', () => {
    const args = ['crafts', '--seed', '2', '--hours', '1', '--json'];
    expect(run(args)).toBe(run(args));
  });

  it('is never idle more than 5% of six game hours and sends no refused command', () => {
    expect(report.rows).toHaveLength(6);
    expect(report.totals.idle).toBeLessThanOrEqual(0.05);
    expect(report.rejected).toBe(0);
    expect(report.totals.crafted).toBeGreaterThan(0);
  });

  it('reports net ryo as sold minus spent, per hour and in total', () => {
    for (const r of report.rows) expect(r.ryoNet).toBe(r.ryoSold - r.ryoSpent);
    expect(report.totals.ryoNet).toBe(report.totals.ryoSold - report.totals.ryoSpent);
  });

  it('levels every trade skill, and the MEAN ryo from sales over hours 3-6 is inside the documented 400-900 band', () => {
    const last = report.rows[report.rows.length - 1];
    for (const skill of report.skills) expect(last?.levels[skill] ?? 0).toBeGreaterThan(1);
    // The documented band is for the whole cycle with the recipes open; single hours swing around it
    // (the per-hour values are printed by `pnpm sim crafts` and quoted in the PR as a finding).
    const open = report.rows.slice(2);
    const mean = open.reduce((s, r) => s + r.ryoSold, 0) / open.length;
    expect(mean).toBeGreaterThanOrEqual(400);
    expect(mean).toBeLessThanOrEqual(900);
  });
});

describe('fighter bot', () => {
  const start = (seed: number) => buildGeninStart(content, seed, 500, [defaultNature(content)]);

  it('gains combat XP every hour over three game hours and never gets stuck', () => {
    const result = runHourly(createFighterBot(), { seed: 1, hours: 3, initialState: start(1) });
    expect(result.rows).toHaveLength(3);
    expect(result.rejected).toBe(0);
    const combat = combatSkills(content);
    for (const row of result.rows) {
      expect(combat.some((id) => (row.xp[id] ?? 0) > 0)).toBe(true);
      expect(row.kills).toBeGreaterThan(0);
      expect(row.idleMs).toBe(0);
    }
    expect(result.state.slots[0]?.action).not.toBeNull();
    // Health lives inside a fight: the fight in progress has a player with health left.
    if (result.state.combat) expect(result.state.combat.fight.player.hp).toBeGreaterThan(0);
  }, 60_000);

  it('is deterministic for a seed, as a bot and through `pnpm sim fighter`', () => {
    const play = () => runHourly(createFighterBot(), { seed: 4, hours: 1, initialState: start(4) });
    expect(JSON.stringify(play().rows)).toBe(JSON.stringify(play().rows));
    const args = ['fighter', '--seed', '4', '--hours', '1', '--json'];
    const a = run(args);
    expect(run(args)).toBe(a);
    const rows = (JSON.parse(a) as { rows: { kills: number; combatXp: Record<string, number> }[] })
      .rows;
    expect(rows[0]?.kills).toBeGreaterThan(0);
  }, 60_000);
});
