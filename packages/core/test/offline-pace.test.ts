/** The fast paths of the hot loop give the answers of the plain ones. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  computeMod,
  defaultRules,
  evalReq,
  reqMet,
  totalsOf,
  levelAt,
  xpAt,
  type GameState,
  type Req,
} from '../src/index.ts';
import { genin, setLevel } from './helpers.ts';
import { fighter } from './prep-state.ts';

function states(): GameState[] {
  const a = genin();
  const b = fighter(3, 40, 'katon');
  setLevel(a, 'tai', 12);
  for (const level of Object.keys(b.village?.levels ?? {})) {
    if (b.village) b.village.levels[level] = 3;
  }
  return [a, b];
}

function reqsOf(): Req[] {
  const out: Req[] = [];
  for (const q of content.quests) {
    if (q.unlock) out.push(q.unlock);
    for (const s of q.steps) if (s.objective.t === 'req') out.push(s.objective.req);
  }
  return out;
}

describe('offline pace: fast paths', () => {
  it('totalsOf gives the totals of computeMod key by key', () => {
    const keys = [
      'interval.skill.tai',
      'speed.skill.tai',
      'speed.practice',
      'xp.all',
      'xp.skill.tai',
      'xp.skill.katon',
      'interval.explore',
      'no.such.key',
    ];
    for (const state of states()) {
      const totals = totalsOf(defaultRules, state, keys, content);
      keys.forEach((key, i) => {
        expect(totals[i]).toBe(computeMod(defaultRules, state, key, content).total);
      });
    }
  });

  it('reqMet agrees with evalReq on every requirement of the quests', () => {
    const reqs = reqsOf();
    expect(reqs.length).toBeGreaterThan(5);
    for (const state of states()) {
      for (const req of reqs)
        expect(reqMet(state, req, content)).toBe(evalReq(state, req, content).met);
    }
  });

  it('the experience table gives the same levels as the formula', () => {
    let points = 0;
    for (let level = 1; level < 120; level++) {
      expect(xpAt(level)).toBe(Math.floor(points / 4));
      const next = points + Math.floor(level + 300 * 2 ** (level / 7));
      expect(levelAt(xpAt(level), 120)).toBe(level);
      points = next;
    }
    expect(() => xpAt(0)).toThrow(RangeError);
    expect(() => xpAt(1.5)).toThrow(RangeError);
  });
});
