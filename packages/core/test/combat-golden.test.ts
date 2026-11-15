/**
 * T1: the combat of the core pack must not change when the engine is refactored. The fixture was
 * recorded from the engine before the vocabulary of fights moved into data and hooks (origin/dev at
 * 31e7746); this test replays it and demands the same bytes. Regenerate on purpose with
 * `UPDATE_GOLDEN=1`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  analyzeFight,
  createFight,
  defaultRules,
  encounterFor,
  fightAdvance,
  fightTimeMs,
  serialize,
  unlockBoss,
  workOf,
  type AnalysisTarget,
  type GameState,
} from '../src/index.ts';
import { HOUR, setLevel } from './helpers.ts';
import { NATURES, yardstick } from './combat-golden-lib.ts';
import { fighter, ids, know, run, startFight, stock, unlock } from './prep-state.ts';

const FIXTURE = new URL('./fixtures/combat-golden.json', import.meta.url);
const K = content.balance.K;
const RESULTS: Record<string, number> = { victory: 1, defeat: 2, fled: 3, timeout: 4, ongoing: 5 };

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 24);

function fights(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const entry of [...content.enemies, ...content.bosses]) {
    const rows: unknown[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const nature = NATURES[seed % NATURES.length] ?? 'katon';
      const snap = yardstick(Math.max(1, Math.min(K.cap, entry.cl)), nature);
      const fight = createFight(snap, encounterFor(entry, content), seed, content, defaultRules);
      fightAdvance(fight, workOf(K.combat.fightCapMs), content, defaultRules);
      const t = fight.tally;
      rows.push([
        RESULTS[fight.result],
        fightTimeMs(fight),
        t.damage,
        t.statuses,
        t.combos,
        t.taken,
        t.kills,
      ]);
    }
    out[entry.id] = rows;
  }
  return out;
}

function session(seed: number, level: number, nature: string, zone: string): string {
  const state = fighter(seed, level, nature as 'katon');
  for (const n of NATURES) setLevel(state, n, level);
  stock(state, { [ids.heal]: 40, [ids.kunai]: 20, [ids.tag]: 20 });
  run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
  run(state, { type: 'pouch.set', slot: 1, item: ids.tag });
  run(state, { type: 'pouch.medic', slot: 0 });
  const started = startFight(state, zone);
  if (!started.ok) throw new Error(`cannot start ${zone}: ${started.reason}`);
  for (let t = 0; t < 2 * HOUR; t += 5000) advance(state, 5000, content);
  return sha(serialize(state, 0));
}

function sessions(): Record<string, string> {
  return {
    'wolfmask lvl 12 katon': session(11, 12, 'katon', 'core:zone_wolfmask'),
    'kiri_hunter lvl 30 futon': session(12, 30, 'futon', 'core:zone_kiri_hunter'),
    'merc_pack lvl 20 raiton': session(13, 20, 'raiton', 'core:zone_merc_pack'),
  };
}

function analyses(): Record<string, string> {
  const opts = { seed: 7, samples: 30, minSessions: 6, maxSessions: 6 };
  const make = (level: number, target: AnalysisTarget, prepare: (s: GameState) => void) => {
    const state = fighter(3, level, 'katon');
    setLevel(state, 'futon', level);
    setLevel(state, 'raiton', level);
    stock(state, { [ids.heal]: 150 });
    prepare(state);
    const a = analyzeFight(state, target, opts, content, defaultRules);
    return sha(JSON.stringify(a));
  };
  return {
    zone: make(2, { kind: 'zone', id: 'core:zone_wolfmask' }, (s) =>
      run(s, { type: 'loadout.prepare', encounter: 'core:zone_wolfmask' }),
    ),
    boss: make(46, { kind: 'boss', id: 'core:zone_boss_hunter' }, (s) => {
      know(s, 'core:boss_hunter');
      unlockBoss(s, 'core:boss_hunter', content);
      run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_hunter' });
    }),
    operation: make(50, { kind: 'operation', id: 'core:op_hideout' }, (s) => {
      for (const id of ['core:guard_pack', 'core:boss_twins', 'core:boss_mist']) know(s, id);
      unlock(s, 'op.hideout.unlocked');
      run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_twins' });
    }),
  };
}

describe('the golden record of the core pack combat', () => {
  it('stays byte-identical', { timeout: 600_000 }, () => {
    const record = JSON.stringify(
      { fights: fights(), sessions: sessions(), analyses: analyses() },
      null,
      1,
    );
    if (process.env.UPDATE_GOLDEN === '1') {
      writeFileSync(FIXTURE, record + '\n');
      return;
    }
    expect(record + '\n').toBe(readFileSync(FIXTURE, 'utf8'));
  });
});
