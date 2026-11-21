/**
 * T6 (saves): real saves written by the game at versions 10 to 13 (the fixtures were made by running
 * the game of that version, in the states named by the keys) migrate to the current version with the
 * core pack alone, keep what they had, and load with the test pack present too.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { advance, deserialize, MIGRATIONS, serialize, STATE_VERSION, xpAt } from '../src/index.ts';
import { HOUR, modContent, modRules, plainContent, plainRules, skillsOf } from './packs-helpers.ts';

const fixture = (name: string): { tag: string; saves: Record<string, string> } =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'),
  );

describe('the save format', () => {
  it('is version 23 and has one migration per step', () => {
    expect(STATE_VERSION).toBe(23);
    expect(MIGRATIONS).toHaveLength(STATE_VERSION - 1);
  });
});

for (const name of ['saves-v10', 'saves-v11', 'saves-v12', 'saves-v13']) {
  const { tag, saves } = fixture(name);
  describe(`real saves of version ${tag.slice(1)}`, () => {
    for (const [who, text] of Object.entries(saves)) {
      const parsed = JSON.parse(text) as { v: number; state: Record<string, unknown> };

      it(`${who}: is a save of that version`, () => {
        expect(parsed.v).toBe(Number(tag.slice(1)));
      });

      it(`${who}: loads with the core pack, written as the current version with the pack list`, () => {
        const state = deserialize(text, plainContent, plainRules);
        expect(state.v).toBe(STATE_VERSION);
        expect(state.packs).toEqual([
          { id: 'core', version: plainContent.packs[0]?.version, since: 0 },
        ]);
        expect(state.rankOrder).toEqual(['student', 'genin', 'chunin']);
        expect(state.dormant).toEqual({});
        expect(state.events.filter((e) => e.type === 'packsChanged')).toEqual([]);
        // What the save had is still there.
        const old = parsed.state as {
          player: { rank: string; name: string };
          skills: Record<string, { xp: number }>;
        };
        expect(state.player.rank).toBe(old.player.rank);
        expect(state.player.name).toBe(old.player.name);
        for (const [skill, entry] of Object.entries(old.skills)) {
          // The Evasion skill of a version-14 save is gone.
          if (skill === 'eva') continue;
          expect(state.skills[skill as 'tai']?.xp).toBe(
            Math.min(entry.xp, xpAt(plainContent.balance.K.cap)),
          );
        }
        // It saves, loads again byte for byte and plays on.
        const again = serialize(state, 1);
        expect(serialize(deserialize(again, plainContent, plainRules), 1)).toBe(again);
        advance(state, HOUR, plainContent, plainRules);
        expect(state.now).toBeGreaterThan(0);
      });

      it(`${who}: loads with the test pack present and says the pack appeared`, () => {
        const state = deserialize(text, modContent, modRules);
        expect(state.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
        expect(skillsOf(state)['testmod:forge']).toEqual({ xp: 0 });
        expect(state.events).toContainEqual(
          expect.objectContaining({ type: 'packsChanged', added: ['testmod'], removed: [] }),
        );
        advance(state, HOUR, modContent, modRules);
        // The pack leaves the player's rank alone.
        expect(state.player.rank).not.toBe('testmod:adept');
      });
    }
  });
}
