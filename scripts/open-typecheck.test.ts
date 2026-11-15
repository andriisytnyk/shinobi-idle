import { describe, expect, it } from 'vitest';
import {
  countByFolder,
  dedupe,
  isInMigrated,
  judge,
  normalizePath,
  parseSvelteCheck,
  parseTsc,
  relativeTo,
  type Diagnostic,
} from './open-typecheck-lib.ts';

const diag = (file: string): Diagnostic => ({
  file,
  line: 1,
  column: 1,
  code: 'TS2322',
  message: 'x',
});

describe('the filter of the open type check', () => {
  const migrated = ['packages/core/src/combat'];

  it('fails a diagnostic inside a migrated folder and not one outside', () => {
    expect(isInMigrated('packages/core/src/combat/fight.ts', migrated)).toBe(true);
    expect(isInMigrated('packages/core/src/combat/deep/x.ts', migrated)).toBe(true);
    expect(isInMigrated('packages/core/src/natures.ts', migrated)).toBe(false);
    expect(isInMigrated('packages/core/src/combat-extra/x.ts', migrated)).toBe(false);
    expect(isInMigrated('packages/core/src/combat.ts', migrated)).toBe(false);
    expect(isInMigrated('packages/core/src/combat', migrated)).toBe(true);
    expect(isInMigrated('packages/core/src/combat/fight.ts', [])).toBe(false);
  });

  it('treats Windows and POSIX paths alike', () => {
    expect(isInMigrated('packages\\core\\src\\combat\\fight.ts', migrated)).toBe(true);
    expect(isInMigrated('packages/core/src/combat/fight.ts', ['packages\\core\\src\\combat'])).toBe(
      true,
    );
    expect(isInMigrated('./packages/core/src/combat/fight.ts', migrated)).toBe(true);
    expect(isInMigrated('packages\\core\\src\\natures.ts', migrated)).toBe(false);
    expect(normalizePath('D:\\Work\\x\\..\\y\\.\\z.ts')).toBe('D:/Work/y/z.ts');
  });

  it('makes compiler paths repo-relative on both platforms', () => {
    expect(relativeTo('D:\\repo', 'D:\\repo\\packages\\core\\src\\a.ts')).toBe(
      'packages/core/src/a.ts',
    );
    expect(relativeTo('/repo', '/repo/packages/core/src/a.ts')).toBe('packages/core/src/a.ts');
    expect(relativeTo('d:/repo', 'D:/repo/apps/web/src/a.ts')).toBe('apps/web/src/a.ts');
    const tsc =
      "../core/src/combat/fight.ts(12,5): error TS2322: Type 'string' is not assignable.\nnoise";
    expect(parseTsc(tsc, 'D:\\repo\\packages\\sim', 'D:\\repo')).toEqual([
      {
        file: 'packages/core/src/combat/fight.ts',
        line: 12,
        column: 5,
        code: 'TS2322',
        message: "Type 'string' is not assignable.",
      },
    ]);
    const svelte =
      '1700000000 START "/repo/apps/web"\n1700000001 ERROR "src/pages/A.svelte" 3:9 "Bad"\n';
    expect(parseSvelteCheck(svelte, '/repo/apps/web', '/repo')[0]?.file).toBe(
      'apps/web/src/pages/A.svelte',
    );
  });

  it('counts errors per folder and removes duplicates reported by two programs', () => {
    const list = [
      diag('packages/core/src/combat/a.ts'),
      diag('packages/core/src/combat/b.ts'),
      diag('packages/core/src/natures.ts'),
      diag('packages/core/src/natures.ts'),
    ];
    expect(countByFolder(list)).toEqual([
      ['packages/core/src', 2],
      ['packages/core/src/combat', 2],
    ]);
    expect(dedupe(list)).toHaveLength(3);
  });
});

describe('the verdict of the gate', () => {
  const errors = [diag('packages/core/src/natures.ts')];

  it('is green while the migrated list is empty and the mapping exists', () => {
    expect(judge(errors, [], true).ok).toBe(true);
  });

  it('fails on an error inside a migrated folder, not outside', () => {
    expect(
      judge([diag('packages/core/src/combat/a.ts')], ['packages/core/src/combat'], true).ok,
    ).toBe(false);
    expect(judge(errors, ['packages/core/src/combat'], true).ok).toBe(true);
  });

  it('fails when nothing is left but the mapping still exists, and the other way round', () => {
    const none = judge([], ['packages/core/src'], true);
    expect(none.ok).toBe(false);
    expect(none.messages.join(' ')).toContain('delete tsconfig.legacy-ids.json');
    expect(judge([], [], false).ok).toBe(true);
    const left = judge(errors, [], false);
    expect(left.ok).toBe(false);
    expect(left.messages.join(' ')).toContain('is gone but 1 error(s) remain');
  });

  it('fails on a migrated folder that does not exist', () => {
    const verdict = judge(errors, ['packages/core/src/gone'], true, () => false);
    expect(verdict.ok).toBe(false);
    expect(verdict.messages[0]).toContain('does not exist');
  });
});
