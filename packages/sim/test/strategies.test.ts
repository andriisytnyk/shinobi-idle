import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  measureRun,
  naturesTriples,
  runMatrixSerial,
  spread,
  STRATEGIES,
  STRATEGY_IDS,
  strategyReportJson,
  strategyReportMarkdown,
} from '../src/index.ts';

const HOURS = 2;
const triples = naturesTriples(content).slice(0, 2);

describe('the natures triples', () => {
  it('are the ten sets of three of the five natures', () => {
    const all = naturesTriples(content);
    expect(all).toHaveLength(10);
    expect(new Set(all.map((t) => [...t].sort().join('+'))).size).toBe(10);
    for (const triple of all) expect(new Set(triple).size).toBe(3);
  });
});

describe('the five strategies', () => {
  it('are all registered', () => {
    expect(STRATEGY_IDS.sort()).toEqual(['collector', 'fighter', 'offline', 'peaceful', 'story']);
  });
});

describe('a short run of a strategy', () => {
  const run = (strategy: 'story' | 'collector', triple = triples[0] ?? []) =>
    measureRun({ strategy: STRATEGIES[strategy], triple: triple as never, seed: 1, hours: HOURS });

  it('plays the Academy, reaches Genin and trains more than one skill', () => {
    for (const id of ['story', 'collector'] as const) {
      const m = run(id);
      expect(m.hours, id).toBe(HOURS);
      expect(m.genin, id).not.toBeNull();
      expect(m.genin as number, id).toBeLessThan(HOURS);
      expect(Object.values(m.levels).filter((l) => l > 1).length, id).toBeGreaterThan(2);
      // Few refused commands: the bot knows the rules it plays by.
      expect(m.rejected, id).toBeLessThan(20);
    }
  });

  it('takes the first nature of the triple as the native one', () => {
    const m = run('story');
    expect(m.triple).toEqual(triples[0]);
    expect(Object.keys(m.levels)).toContain(triples[0]?.[0]);
  });

  it('is deterministic: the same strategy, triple and seed give the same run', () => {
    for (const id of ['story', 'collector'] as const) {
      expect(JSON.stringify(run(id, triples[1])), id).toBe(JSON.stringify(run(id, triples[1])));
    }
  });
});

describe('the offline player', () => {
  it('is asked only in its sessions, and the game goes on while it is away', () => {
    const m = measureRun({
      strategy: STRATEGIES.offline,
      triple: triples[0] as never,
      seed: 1,
      hours: 17,
    });
    expect(m.hours).toBe(17);
    // Sessions at 0, 8 and 16 hours; skills grew in between.
    const trained = Object.values(m.levels).reduce((a, b) => a + b, 0);
    expect(trained).toBeGreaterThan(Object.keys(m.levels).length + 10);
  });
});

describe('the balance report', () => {
  const result = runMatrixSerial({
    seeds: 1,
    hours: HOURS,
    strategies: ['story', 'collector'],
    triples,
  });

  it('plays every strategy on every triple on every seed', () => {
    expect(result.rows).toHaveLength(4);
    for (const row of result.rows) expect(row.runs).toHaveLength(1);
  });

  it('covers the five hypotheses and lists what misses the targets', () => {
    const md = strategyReportMarkdown(result, content);
    for (const heading of [
      '## 1. Навички за перші 3 години',
      '## 2. Час до віх',
      '## 3. Найдовший проміжок без віхи',
      '## 4. Частка часу з клоном',
      '## 5. Місії проти практики',
      '## Що не сходиться',
    ]) {
      expect(md).toContain(heading);
    }
    // Chunin is out of reach in two hours: the target is marked with a number.
    expect(md).toMatch(/Чунін 12–15 год \| 1\/1 \| не досягнуто за 2\.0 год/);
  });

  it('is written the same way twice', () => {
    expect(strategyReportMarkdown(result, content)).toBe(strategyReportMarkdown(result, content));
    expect(strategyReportJson(result)).toBe(strategyReportJson(result));
    expect(JSON.parse(strategyReportJson(result)).rows).toHaveLength(4);
  });
});

describe('spread', () => {
  it('gives the min, the lower median and the max', () => {
    expect(spread([3, 1, 2, 10])).toEqual({ min: 1, median: 2, max: 10 });
    expect(spread([])).toBeNull();
  });
});
