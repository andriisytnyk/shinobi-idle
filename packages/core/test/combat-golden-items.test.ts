/**
 * T1, part two: the fights where the player uses items and where enemies put effects on the player.
 * Recorded from `origin/dev` at 31e7746 before the engine changed. `items` (a pouch with the
 * sleeping powder used on a timer, an antidote, a heal, tools) must stay byte-identical. `poison` is
 * the one declared change: the burn ointment sits before the antidote in the pouch, and the AI used
 * to reach for it against poison; the fixture holds what dev did (`dev`) and what is intended now.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createFight,
  defaultCombatAi,
  defaultRules,
  encounterFor,
  fightAdvance,
  fightTimeMs,
  workOf,
  type CombatAi,
  type PlayerSnapshot,
} from '../src/index.ts';
import { NATURES, yardstick } from './combat-golden-lib.ts';

const FIXTURE = new URL('./fixtures/combat-golden-items.json', import.meta.url);
const K = content.balance.K;
const RESULTS: Record<string, number> = { victory: 1, defeat: 2, fled: 3, timeout: 4, ongoing: 5 };
const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
const POWDER = 'core:sonnyi_poroshok';

type Pouch = { id: string; n: number }[];

/** The AI of the yardstick, plus the powder thrown every two seconds while there is any. */
function powderAi(): CombatAi {
  let next = 0;
  return (view) => {
    if (view.t >= next && view.pouch.some((p) => p.id === POWDER && p.n > 0)) {
      next = view.t + workOf(2000);
      return { type: 'item', id: POWDER };
    }
    return defaultCombatAi(view);
  };
}

function record(pouch: Pouch, entries: readonly { id: string; cl: number }[], powder: boolean) {
  const out: Record<string, unknown[]> = {};
  for (const entry of entries) {
    const rows: unknown[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const snap: PlayerSnapshot = {
        ...yardstick(
          Math.max(1, Math.min(K.cap, entry.cl)),
          NATURES[seed % NATURES.length] ?? 'katon',
        ),
        pouch: pouch.map((s) => ({ ...s })),
      };
      const rules = { ...defaultRules, combatAi: powder ? powderAi() : defaultCombatAi };
      const full = [...content.enemies, ...content.bosses].find((e) => e.id === entry.id);
      if (!full) throw new Error(entry.id);
      const fight = createFight(snap, encounterFor(full, content), seed, content, rules);
      // The effects on both sides every few seconds of the first minute, and where a stun ends, then the end.
      const effects: unknown[] = [];
      for (let at = 0; at < 60; at += 3) {
        fightAdvance(fight, workOf(3000), content, rules);
        effects.push([
          sha(JSON.stringify([fight.player.effects, fight.enemies.map((e) => e.effects)])),
          fight.enemies.map((e) => e.effects.filter((x) => x.id === 'stun').map((x) => x.until)),
        ]);
      }
      fightAdvance(fight, workOf(K.combat.fightCapMs), content, rules);
      const t = fight.tally;
      rows.push([
        RESULTS[fight.result],
        fightTimeMs(fight),
        effects,
        t.damage,
        t.uses,
        t.statuses,
        t.combos,
        t.taken,
        t.interrupts,
        fight.pouch.map((p) => p.n),
      ]);
    }
    out[entry.id] = rows;
  }
  return out;
}

const bank = (ids: string[]): Pouch => ids.map((id) => ({ id, n: 4 }));
const all = [...content.enemies, ...content.bosses];
const poisoners = content.enemies.filter((e) => e.traits.includes('poisoner'));

function items() {
  return record(
    bank([
      'core:bulion_ramenu',
      POWDER,
      'core:antidote',
      'core:niukhalna_sil',
      'core:kunai',
      'core:tag',
      'core:wiretrap',
      'core:psenbon',
    ]),
    all,
    true,
  );
}

/** The burn ointment before the antidote, against the poisoners. */
const poison = () =>
  record(bank(['core:bulion_ramenu', 'core:maz_vid_opikiv', 'core:antidote']), poisoners, false);

describe('the golden record of items and enemy-applied effects', () => {
  it(
    'stays byte-identical, and the poison answer is the intended one',
    { timeout: 300_000 },
    () => {
      const now = { items: items(), poison: poison() };
      if (process.env.UPDATE_GOLDEN === '1') {
        // Recorded on dev: both poison records are what dev did.
        const text = JSON.stringify(
          { items: now.items, dev: now.poison, poison: now.poison },
          null,
          1,
        );
        writeFileSync(FIXTURE, `${text}\n`);
        return;
      }
      if (process.env.UPDATE_GOLDEN === 'poison') {
        // The declared change: only the intended poison answer is rewritten; `dev` and `items` stay as dev recorded them.
        const old = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
        writeFileSync(FIXTURE, `${JSON.stringify({ ...old, poison: now.poison }, null, 1)}\n`);
        return;
      }
      const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
        items: unknown;
        dev: unknown;
        poison: unknown;
      };
      expect(JSON.stringify(now.items)).toBe(JSON.stringify(fixture.items));
      expect(JSON.stringify(now.poison)).toBe(JSON.stringify(fixture.poison));
    },
  );
});
