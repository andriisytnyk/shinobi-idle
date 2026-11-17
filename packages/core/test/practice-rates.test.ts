/**
 * Practising a technique pays the same XP and mastery per hour whatever the length of its cycle:
 * a cycle that got longer pays proportionally more. The fixture was recorded on dev at 3f559af
 * (before the cast time became a number of the technique) by running this file with DUMP=1.
 */
import { content } from '@shinobi/content';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  dispatch,
  masteryXpPerAction,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { genin, setLevel, start } from './helpers.ts';

const FIXTURE = new URL('./fixtures/practice-rates.json', import.meta.url);
const HOUR = 3_600_000;

type Table = Record<string, [number, number]>;

/** What an hour of real play pays, for a few techniques: skill XP and mastery XP gained. */
function played(): Table {
  const out: Table = {};
  for (const id of [
    'core:leaf_whirlwind',
    'core:clone',
    'core:great_fireball',
    'core:gale_palm',
    'core:shadow_clone',
  ]) {
    const tech = content.techniques.find((t) => t.id === id);
    if (!tech) continue;
    for (const native of [true, false]) {
      const state = genin();
      state.player.natures = native ? [tech.skill] : ['doton', tech.skill];
      setLevel(state, tech.skill, tech.level);
      state.known[id] = true;
      const before = state.skills[tech.skill]?.xp ?? 0;
      dispatch(state, start('practice', id), content);
      advance(state, HOUR, content);
      out[`${id}|${native ? 'native' : 'foreign'}`] = [
        (state.skills[tech.skill]?.xp ?? 0) - before,
        state.mastery[id]?.xp ?? 0,
      ];
    }
  }
  return out;
}

/** XP and mastery XP per hour of practising every technique of the pack, native and not, at mastery 1 and 60. */
function table(): Table {
  const out: Table = {};
  for (const tech of content.techniques) {
    const isNature = content.natures.some((n) => n.id === tech.skill);
    const other = content.natures.find((n) => n.id !== tech.skill)?.id;
    for (const mastery of [1, 60]) {
      for (const native of isNature ? [true, false] : [true]) {
        const state: GameState = genin();
        state.player.natures = isNature
          ? native
            ? [tech.skill]
            : [other ?? tech.skill, tech.skill]
          : ['katon'];
        setLevel(state, tech.skill, tech.level);
        state.known[tech.id] = true;
        state.mastery[tech.id] = { xp: mastery === 1 ? 0 : xpAt(mastery) };
        const info = actionInfo(state, { kind: 'practice', id: tech.id }, content);
        if (!info) continue;
        const perHour = (info.xpPerHour * 1) / 1;
        const masteryPerHour =
          (masteryXpPerAction(info.intervalMs / 1000, content) * HOUR) / info.intervalMs;
        out[`${tech.id}|${mastery}|${native ? 'native' : 'foreign'}`] = [
          Math.round(perHour * 1000) / 1000,
          Math.round(masteryPerHour * 1000) / 1000,
        ];
      }
    }
  }
  return out;
}

describe('practice pays the same per hour as before', () => {
  if (process.env.DUMP) {
    it('records the fixture', () => {
      writeFileSync(FIXTURE, JSON.stringify({ table: table(), played: played() }, null, 1) + '\n');
    });
    return;
  }
  const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { table: Table; played: Table };
  const recorded = file.table;
  const now = table();

  it('pays what it paid in an hour of real play, within the cycle that is cut off at the end of the hour', () => {
    const now = played();
    for (const [key, [xp, mastery]] of Object.entries(file.played)) {
      if (xp === 0) continue;
      const got = now[key];
      expect(got, key).toBeDefined();
      expect((got?.[0] ?? 0) / xp, `${key} xp`).toBeGreaterThan(0.97);
      expect((got?.[0] ?? 0) / xp, `${key} xp`).toBeLessThan(1.03);
      expect((got?.[1] ?? 0) / mastery, `${key} mastery`).toBeGreaterThan(0.97);
      expect((got?.[1] ?? 0) / mastery, `${key} mastery`).toBeLessThan(1.03);
    }
  });

  it('covers the same cases', () => {
    expect(Object.keys(now).sort()).toEqual(Object.keys(recorded).sort());
    expect(Object.keys(now).length).toBeGreaterThan(100);
  });

  it('pays the XP per hour and the mastery per hour of every technique, at mastery 1 and 60, native and not', () => {
    for (const [key, [xp, mastery]] of Object.entries(recorded)) {
      const got = now[key];
      if (!got) continue;
      // Rounding only: the cycle changed, the hour did not.
      expect(got[0], `${key} xp`).toBeCloseTo(xp, 2);
      expect(got[1], `${key} mastery`).toBeCloseTo(mastery, 2);
    }
  });
});
