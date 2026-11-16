/**
 * What one hit does did not change with the fight loop: for every damaging technique of the core
 * pack, against a plain body, against a body of each nature (the wheel), against an armoured one and
 * against bodies already burning or wet (the combos), the damage of the first cast, what it put on
 * the body and what it counted. The fixture was recorded on dev at 3f559af with DUMP=1.
 */
import { content } from '@shinobi/content';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyStatusById, createFight, type FightState } from '../src/index.ts';
import {
  castOnce,
  enemyAt,
  pacify,
  quiet,
  rules,
  runUntil,
  scripted,
  withAi,
} from './fight-helpers.ts';

const FIXTURE = new URL('./fixtures/per-hit.json', import.meta.url);

type Row = {
  damage: number;
  hp: number;
  effects: [string, number | null][];
  statuses: Record<string, number>;
  combos: Record<string, number>;
};

const natures = ['katon', 'futon', 'raiton', 'doton', 'suiton'] as const;
const scenarios: {
  name: string;
  traits: string[];
  nature: (typeof natures)[number] | null;
  prior: string | null;
}[] = [
  { name: 'plain', traits: [], nature: null, prior: null },
  ...natures.map((n) => ({ name: `nature-${n}`, traits: [], nature: n, prior: null })),
  { name: 'armor', traits: ['armor'], nature: null, prior: null },
  { name: 'prior-burn', traits: [], nature: null, prior: 'burn' },
  { name: 'prior-wet', traits: [], nature: null, prior: 'wet' },
];

function one(id: string, s: (typeof scenarios)[number]): Row | null {
  const tech = content.techniques.find((t) => t.id === id);
  if (!tech || tech.rank === null) return null;
  const fight: FightState = createFight(
    {
      ...scripted([id]),
      natures: [tech.skill === 'tai' || tech.skill === 'nin' ? 'katon' : tech.skill],
    },
    enemyAt(30, s.traits as never, s.nature),
    5,
    content,
    rules,
  );
  quiet(pacify(fight), 1e9);
  fight.player.hp = fight.player.maxHp = 1e12;
  fight.player.accuracy = 1e9;
  const kit = fight.kit.techniques[0];
  if (!kit) return null;
  kit.comboChance = 1;
  const enemy = fight.enemies[0];
  if (!enemy) return null;
  enemy.evasion = 0;
  const ctx = { fight, content, rules };
  if (s.prior) applyStatusById(ctx, enemy, s.prior, 'test', { base: 10 });
  runUntil(fight, (f) => (f.tally.uses[id] ?? 0) > 0, withAi(castOnce(id)));
  if ((fight.tally.uses[id] ?? 0) === 0) return null;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    damage: round(fight.tally.damage[id] ?? 0),
    hp: round(enemy.hp),
    effects: enemy.effects
      .map(
        (e) => [e.id, e.kind === 'modifier' ? round(e.value) : round(e.amount)] as [string, number],
      )
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    statuses: { ...fight.tally.statuses },
    combos: { ...fight.tally.combos },
  };
}

function table(): Record<string, Row | null> {
  const out: Record<string, Row | null> = {};
  for (const t of content.techniques) {
    if (t.rank === null || t.noDamage || t.role === 'defense') continue;
    for (const s of scenarios) out[`${t.id}|${s.name}`] = one(t.id, s);
  }
  return out;
}

describe('one hit does what it did', () => {
  if (process.env.DUMP) {
    it('records the fixture', () =>
      writeFileSync(FIXTURE, JSON.stringify(table(), null, 1) + '\n'));
    return;
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Row | null>;
  const now = table();
  it('covers the same cases', () => {
    expect(Object.keys(now).sort()).toEqual(Object.keys(recorded).sort());
    expect(Object.values(recorded).filter((r) => r !== null).length).toBeGreaterThan(100);
  });
  it('gives the same damage, effects, statuses and combos per hit', () => {
    // A burn that was already there ticks while a longer cast is under way: the health left is compared only without a prior state.
    // The one declared change since the recording: a hit of the interrupting tag leaves the `interrupt` status (a slower rhythm); taken out, the rest is what dev gave.
    const without = (row: Row | null | undefined) => {
      if (!row) return row;
      const { interrupt: _s, ...statuses } = row.statuses;
      void _s;
      return { ...row, effects: row.effects.filter(([id]) => id !== 'interrupt'), statuses };
    };
    const plain = (key: string, row: Row | null | undefined) =>
      row && key.includes('|prior-') ? { ...without(row), hp: 0 } : without(row);
    for (const [key, row] of Object.entries(recorded))
      expect(plain(key, now[key]), key).toEqual(plain(key, row));
  });
});
