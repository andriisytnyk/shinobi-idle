import { content } from '@shinobi/content';
import { defaultRules, simulateFights } from '@shinobi/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  allEntries,
  buildCharacter,
  buildGeninStart,
  craftsReport,
  createFighterBot,
  defaultNature,
  encounterOf,
  equipFor,
  fightRow,
  fightSnapshot,
  runCli,
  runHourly,
  type CraftsReport,
} from '../src/index.ts';

const run = (args: string[]): string => {
  const r = runCli(args);
  expect(r.err).toEqual([]);
  expect(r.code).toBe(0);
  return r.out.join('\n');
};

describe('pnpm sim fight', () => {
  it('prints byte-identical JSON for the same seed', () => {
    const enemy = content.enemies[3]?.id ?? '';
    const args = ['fight', '--enemy', enemy, '--runs', '20', '--json'];
    const a = run([...args, '--seed', '1']);
    expect(run([...args, '--seed', '1'])).toBe(a);
    expect(run([...args, '--seed', '2'])).not.toBe(a);
  });

  it('covers every enemy and boss entry in content with a model column', () => {
    const entries = allEntries(content);
    expect(entries.length).toBe(content.enemies.length + content.bosses.length);
    const rows = JSON.parse(run(['fight', '--all', '--seed', '1', '--runs', '5', '--json'])) as {
      enemy: string;
      model: unknown;
      ratio: number | null;
      flagged: boolean;
    }[];
    expect(rows.map((r) => r.enemy).sort()).toEqual(entries.map((e) => e.id).sort());
    for (const r of rows) {
      expect(r.model).not.toBeNull();
      if (r.ratio === null) expect(r.flagged).toBe(true);
    }
    const text = run(['fight', '--all', '--seed', '1', '--runs', '5']);
    for (const e of entries) expect(text).toContain(e.id.replace(/^core:/, ''));
    expect(text).toContain('відн.');
  });

  it('builds the character with the engine and agrees with simulateFights', () => {
    const entry = content.enemies[6] ?? content.enemies[0];
    if (!entry) throw new Error('no enemies in content');
    const state = buildCharacter(content, defaultRules, {
      seed: 3,
      level: entry.cl,
      rank: 'genin',
      natures: [defaultNature(content)],
    });
    equipFor(state, entry.id, content, defaultRules);
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
    });
    expect(row.stats.winRate).toBeCloseTo(reference.winRate, 10);
    expect(row.stats.timeSec?.mean ?? 0).toBeCloseTo(reference.timeMs.mean / 1000, 6);
  });

  it('rejects bad arguments and prints help', () => {
    expect(runCli(['fight', '--help']).out.join('\n')).toContain('--all');
    expect(runCli(['fight']).code).toBe(1);
    expect(runCli(['fight', '--enemy', 'core:nobody']).code).toBe(1);
    expect(runCli(['fight', '--all', '--natures', 'nonsense']).code).toBe(1);
    expect(runCli(['crafts', '--help']).out.join('\n')).toContain('--hours');
  });
});

describe('pnpm sim crafts', () => {
  let report: CraftsReport;
  beforeAll(() => {
    report = craftsReport({ seed: 1, hours: 6 });
  });

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

  it('levels every trade skill and earns 400 to 900 ryo per hour from sales once recipes are open', () => {
    const last = report.rows[report.rows.length - 1];
    for (const skill of report.skills) expect(last?.levels[skill] ?? 0).toBeGreaterThan(1);
    // Hours 1 and 2 are the climb through the first tiers; the band is judged after them.
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
    const combat = content.skills.filter((s) => s.group === 'combat').map((s) => s.id);
    for (const row of result.rows) {
      expect(combat.some((id) => (row.xp[id] ?? 0) > 0)).toBe(true);
      expect(row.kills).toBeGreaterThan(0);
      expect(row.idleMs).toBe(0);
    }
    expect(result.state.slots[0]?.action).not.toBeNull();
    // Health lives inside a fight: the fight in progress has a player with health left.
    if (result.state.combat) expect(result.state.combat.fight.player.hp).toBeGreaterThan(0);
  }, 60_000);

  it('is deterministic for a seed', () => {
    const play = () => runHourly(createFighterBot(), { seed: 4, hours: 1, initialState: start(4) });
    expect(JSON.stringify(play().rows)).toBe(JSON.stringify(play().rows));
  }, 60_000);
});
