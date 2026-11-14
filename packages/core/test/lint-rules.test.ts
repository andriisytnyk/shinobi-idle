/**
 * Proves the ESLint rule that keeps packages/core pure: code inside packages/core/src that uses
 * Date, Math.random, performance, window, document, setTimeout or setInterval is reported.
 */
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function lint(code: string, file: string) {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return result?.messages ?? [];
}

describe('core purity lint rule', () => {
  const forbidden: [string, string][] = [
    ['Date.now()', 'export const a = Date.now();'],
    ['new Date()', 'export const a = new Date();'],
    ['Math.random()', 'export const a = Math.random();'],
    ['performance.now()', 'export const a = performance.now();'],
    ['window', 'export const a = window.innerWidth;'],
    ['document', 'export const a = document.title;'],
    ['setTimeout', 'export const a = setTimeout(() => 0, 1);'],
    ['setInterval', 'export const a = setInterval(() => 0, 1);'],
  ];

  for (const [label, code] of forbidden) {
    it(`reports ${label} in packages/core/src`, async () => {
      const messages = await lint(code, 'packages/core/src/fixture.ts');
      expect(messages.some((m) => m.severity === 2)).toBe(true);
    });
  }

  it('does not report the same code outside packages/core/src', async () => {
    const messages = await lint('export const a = Date.now();', 'packages/sim/src/fixture.ts');
    expect(messages).toEqual([]);
  });

  it('forbids explicit any everywhere', async () => {
    const messages = await lint('export const a: any = 1;', 'packages/sim/src/fixture.ts');
    expect(messages.some((m) => m.ruleId === '@typescript-eslint/no-explicit-any')).toBe(true);
  });

  it('accepts clean core code', async () => {
    const messages = await lint('export const a = 1 + 1;\n', 'packages/core/src/fixture.ts');
    expect(messages).toEqual([]);
  });
});
