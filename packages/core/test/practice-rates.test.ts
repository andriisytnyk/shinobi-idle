/**
 * The pace of practising a technique. The fixture was recorded on dev at 3f559af, when XP per cycle
 * was derived from the cycle (so XP per hour never moved): its XP per hour at mastery 1 of the
 * player's own nature is still what the data now pays (the identity of the explicit XP per cycle).
 * What changed on purpose: XP per cycle is data and does not depend on mastery, so a cast that
 * mastery or a foreign nature shortens or stretches moves XP per hour; Mastery per hour grows with
 * the mastery level (`K.mastery`).
 */
import { content } from '@shinobi/content';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  dispatch,
  masteryXpPerHour,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { genin, setLevel, start } from './helpers.ts';

const FIXTURE = new URL('./fixtures/practice-rates.json', import.meta.url);
const recorded = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { table: Record<string, number[]> })
  .table;

function stateFor(id: string, mastery: number, native: boolean): GameState {
  const tech = content.techniques.find((t) => t.id === id)!;
  const isNature = content.natures.some((n) => n.id === tech.skill);
  const other = content.natures.find((n) => n.id !== tech.skill)?.id ?? tech.skill;
  const state = genin();
  state.player.natures = isNature ? (native ? [tech.skill] : [other, tech.skill]) : ['katon'];
  setLevel(state, tech.skill, tech.level);
  state.known[id] = true;
  state.mastery[id] = { xp: mastery === 1 ? 0 : xpAt(mastery) };
  return state;
}

describe('the pace of practice', () => {
  it('pays at mastery 1 the XP per hour it paid before XP per cycle became data', () => {
    let checked = 0;
    for (const tech of content.techniques) {
      const old = recorded[`${tech.id}|1|native`];
      if (!old) continue;
      const info = actionInfo(
        stateFor(tech.id, 1, true),
        { kind: 'practice', id: tech.id },
        content,
      );
      if (!info) continue;
      // The data is rounded to a thousandth of an XP per cycle, the cycle to a millisecond.
      expect(info.xpPerHour / (old[0] ?? 1), tech.id).toBeGreaterThan(0.999);
      expect(info.xpPerHour / (old[0] ?? 1), tech.id).toBeLessThan(1.001);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('pays the same XP per cycle at any mastery, and never less per hour at a higher one', () => {
    for (const tech of content.techniques) {
      const key = { kind: 'practice', id: tech.id };
      const low = actionInfo(stateFor(tech.id, 1, true), key, content);
      const high = actionInfo(stateFor(tech.id, 60, true), key, content);
      if (!low || !high) continue;
      expect(high.xpPerCycle, tech.id).toBeCloseTo(low.xpPerCycle, 9);
      expect(high.xpPerHour, tech.id).toBeGreaterThanOrEqual(low.xpPerHour - 1e-6);
    }
  });

  it('pays Mastery per hour by the mastery level of the technique', () => {
    const id = 'core:leaf_whirlwind';
    for (const mastery of [1, 10, 25, 60]) {
      const info = actionInfo(stateFor(id, mastery, true), { kind: 'practice', id }, content);
      // The mastery level the XP gives is the one the formula reads (it may round to the level below).
      expect(info?.masteryPerHour).toBeCloseTo(
        masteryXpPerHour(info?.masteryLevel ?? 1, content),
        3,
      );
    }
  });

  it('pays in an hour of real play what the forecast says', () => {
    const id = 'core:leaf_whirlwind';
    const state = stateFor(id, 1, true);
    const info = actionInfo(state, { kind: 'practice', id }, content);
    const before = state.skills.tai?.xp ?? 0;
    dispatch(state, start('practice', id), content);
    advance(state, 3_600_000, content);
    const got = (state.skills.tai?.xp ?? 0) - before;
    expect(got / (info?.xpPerHour ?? 1)).toBeGreaterThan(0.97);
    // Mastery shortens the cast during the hour, so the hour pays a little more than the forecast at mastery 1.
    expect(got / (info?.xpPerHour ?? 1)).toBeLessThan(1.1);
  });

  it('has a longer cycle for a technique of a foreign nature (the XP of a cycle is the same)', () => {
    const tech = content.techniques.find((t) => t.id === 'core:great_fireball')!;
    const native = actionInfo(
      stateFor(tech.id, 1, true),
      { kind: 'practice', id: tech.id },
      content,
    );
    const foreign = actionInfo(
      stateFor(tech.id, 1, false),
      { kind: 'practice', id: tech.id },
      content,
    );
    expect(foreign?.intervalMs ?? 0).toBeGreaterThanOrEqual(native?.intervalMs ?? 0);
  });
});
