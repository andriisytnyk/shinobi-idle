/** A9: the core source holds no balance numbers, no `any` and no platform globals. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(srcDir, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replaceAll('\\', '/'));
const source = (file: string) => readFileSync(srcDir + file, 'utf8');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const stripStrings = (text: string) =>
  text.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');

describe('A9: core source hygiene', () => {
  it('has source files to check, subfolders included', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('combat/system.ts');
  });

  for (const literal of ['4800', '1.08', '10500']) {
    it(`contains no balance literal ${literal}`, () => {
      expect(files.filter((f) => source(f).includes(literal))).toEqual([]);
    });
  }

  it('keeps numeric literals to unit conversions and structural constants', () => {
    // Anything else is a balance number and belongs in the content balance object.
    const allowed: Record<string, number[]> = {
      'checkpoints.ts': [100], // percent to share
      'engine.ts': [24], // longest player name
      'events.ts': [200],
      'formulas.ts': [1000, 3600, 60],
      'progression.ts': [100],
      'combat/fight-parse.ts': [4, 10], // four words of an rng stream; the largest effect multiplier
      'combat/units.ts': [1000], // work units per ms, speed scale, ms per tick
      'combat/loadout.ts': [24], // longest name of a saved loadout
      'save.ts': [4, 6], // four words of an rng stream; nesting depth of slot data
      'state.ts': [1000, 4, 11], // share scale, rng words, save version
      'xp.ts': [4, 7, 300], // the fixed Melvor level curve
    };
    const offenders: string[] = [];
    for (const file of files.filter((f) => f !== 'rng.ts')) {
      const code = stripStrings(stripComments(source(file)));
      for (const m of code.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g)) {
        const n = Number(m[0]);
        if (n > 3 && !(allowed[file] ?? []).includes(n)) offenders.push(`${file}: ${m[0]}`);
        if (n === 0.5 && !(allowed[file] ?? []).includes(n)) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses no explicit any', () => {
    const offenders = files.filter((f) => /:\s*any\b|\bas any\b|<any>|any\[\]/.test(source(f)));
    expect(offenders).toEqual([]);
  });

  it('touches no clock, randomness or browser globals', () => {
    const forbidden =
      /\bDate\b|Math\.random|\bperformance\b|\bwindow\b|\bdocument\b|setTimeout|setInterval/;
    const offenders = files.filter((f) => forbidden.test(stripComments(source(f))));
    expect(offenders).toEqual([]);
  });
});
