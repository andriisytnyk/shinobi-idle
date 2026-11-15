/**
 * A game saved in the middle of a fight by `origin/dev` at 31e7746 (save version 13) must play on
 * exactly as it did there: for each of the eight bosses and one enemy of each trait, the fixture holds
 * the save and a hash of the state after twenty more game minutes (the end of the fight and what
 * follows) as dev played it. The keys the engine now derives for a loaded body (the numbers a special
 * publishes) are taken out before comparing. Recorded on dev with `UPDATE_GOLDEN=1`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advance, deserialize, serialize, unlockBoss, type GameState } from '../src/index.ts';
import { ids, fighter, run, startFight, stock } from './prep-state.ts';

const FIXTURE = new URL('./fixtures/dev-saves.json', import.meta.url);
const K = content.balance.K;
const MIN = 60_000;

/** The `c.data` keys a loaded body gets that dev did not write. */
const DERIVED = new Set([
  'caster.everyMs',
  'caster.castMs',
  'caster.mult',
  'caster.stunMs',
  'evasive.rampTo',
  'illusionist.everyMs',
]);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!DERIVED.has(k)) out[k] = strip(v);
    return out;
  }
  return value;
}

const digest = (text: string): string =>
  createHash('sha256')
    .update(JSON.stringify(strip(JSON.parse(text))))
    .digest('hex')
    .slice(0, 32);

function targets(): { name: string; zone: string; level: number; boss: string | null }[] {
  const list: { name: string; zone: string; level: number; boss: string | null }[] = [];
  const zoneOf = (enemy: string) => content.zones.find((z) => z.enemy === enemy)?.id;
  for (const b of content.bosses) {
    const zone = zoneOf(b.id);
    if (zone) list.push({ name: b.id, zone, level: Math.min(K.cap, b.cl), boss: b.id });
  }
  for (const trait of content.traits) {
    const e = content.enemies.find((x) => x.traits.includes(trait.id) && zoneOf(x.id));
    const zone = e ? zoneOf(e.id) : undefined;
    if (e && zone)
      list.push({ name: `trait ${trait.id}`, zone, level: Math.min(K.cap, e.cl), boss: null });
  }
  return list;
}

function savedGame(t: { zone: string; level: number; boss: string | null }): string {
  const state: GameState = fighter(7, Math.max(2, t.level), 'katon');
  for (const n of ['futon', 'raiton', 'doton', 'suiton'] as const) {
    state.skills[n].xp = state.skills.katon.xp;
  }
  stock(state, { [ids.heal]: 60, [ids.kunai]: 12, [ids.tag]: 12 });
  run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
  run(state, { type: 'pouch.medic', slot: 0 });
  if (t.boss) unlockBoss(state, t.boss, content);
  const started = startFight(state, t.zone);
  if (!started.ok) throw new Error(`cannot start ${t.zone}: ${started.reason}`);
  advance(state, 25_000, content);
  return serialize(state, 0);
}

function played(save: string): string {
  const state = deserialize(save, content);
  for (let t = 0; t < 20 * MIN; t += MIN) advance(state, MIN, content);
  return serialize(state, 0);
}

describe('a save made on dev in the middle of a fight', () => {
  const list = targets();

  it('covers the eight bosses and every trait', () => {
    expect(list.filter((t) => t.boss).length).toBe(content.bosses.length);
    expect(list.length).toBe(content.bosses.length + content.traits.length);
  });

  it('plays on as it did there', { timeout: 300_000 }, () => {
    if (process.env.UPDATE_GOLDEN === '1') {
      const out: Record<string, { save: string; expected: string }> = {};
      for (const t of list) {
        const save = savedGame(t);
        out[t.name] = { save, expected: digest(played(save)) };
      }
      writeFileSync(FIXTURE, `${JSON.stringify(out)}\n`);
      return;
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<
      string,
      { save: string; expected: string }
    >;
    for (const t of list) {
      const rec = fixture[t.name];
      if (!rec) throw new Error(`no record for ${t.name}`);
      expect(digest(played(rec.save)), t.name).toBe(rec.expected);
    }
  });
});
