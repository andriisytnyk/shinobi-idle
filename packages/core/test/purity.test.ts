/** A13: the core source holds no balance numbers, no `any` and no platform globals. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
const source = (file: string) => readFileSync(srcDir + file, 'utf8');

describe('A13: core source hygiene', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const literal of ['4800', '1.08', '10500']) {
    it(`contains no balance literal ${literal}`, () => {
      expect(files.filter((f) => source(f).includes(literal))).toEqual([]);
    });
  }

  it('uses no explicit any', () => {
    const offenders = files.filter((f) => /:\s*any\b|\bas any\b|<any>|any\[\]/.test(source(f)));
    expect(offenders).toEqual([]);
  });

  it('touches no clock, randomness or browser globals', () => {
    const forbidden =
      /\bDate\b|Math\.random|\bperformance\b|\bwindow\b|\bdocument\b|setTimeout|setInterval/;
    const offenders = files.filter((f) =>
      forbidden.test(source(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    );
    expect(offenders).toEqual([]);
  });
});
