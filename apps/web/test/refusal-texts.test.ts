import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { content } from '@shinobi/content';
import {
  createState,
  defaultRules,
  dispatch,
  syncVillage,
  xpAt,
  type Command,
  type GameState,
} from '@shinobi/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setActiveContent } from '../src/lib/active.ts';
import { composeBoot } from '../src/lib/boot.ts';
import { clearUnfilledPlaceholders, t, unfilledPlaceholders } from '../src/lib/i18n.ts';
import { refusalParams } from '../src/lib/toasts.svelte.ts';

/*
 * A refusal is shown as `t(reason, params)` with what the core says in `params`. The ryo refusal is
 * shared by every spender, so none of its callers may leave a `{placeholder}` in the text.
 */

beforeAll(() => setActiveContent(composeBoot().content));
beforeEach(() => clearUnfilledPlaceholders());

function genin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  syncVillage(state, content);
  state.currencies.ryo = 0;
  return state;
}

function shownRefusal(state: GameState, command: Command): string {
  const result = dispatch(state, command, content, defaultRules);
  expect(result.ok).toBe(false);
  if (result.ok) return '';
  expect(result.reason).toBe('error.notEnoughRyo');
  return t(result.reason, refusalParams(result));
}

describe('t() calls without parameters', () => {
  it('never name a key whose text has a placeholder', () => {
    const table = composeBoot().content.locales.uk;
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /(?<!\.test)\.(svelte|ts)$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const offenders: string[] = [];
    for (const file of files(fileURLToPath(new URL('../src', import.meta.url)))) {
      const source = readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) {
        if (/\{[A-Za-z_]\w*[},]/.test(table[key!] ?? '')) offenders.push(`${file}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the ryo refusal of each spender', () => {
  const commands: Record<string, Command> = {
    shop: { type: 'shop.buy', item: 'core:rice', n: 2 },
    gear: { type: 'gear.buy', line: 'core:trenuvalni_manekeny' },
    travel: { type: 'world.travel', cell: 'core:uzlissia', mode: 'paid' },
    village: { type: 'village.donate', ryo: 5 },
  };
  for (const [kind, command] of Object.entries(commands)) {
    it(`${kind} shows its text with no placeholder left`, () => {
      const state = genin();
      state.skills.tai!.xp = xpAt(50);
      const text = shownRefusal(state, command);
      expect(text).toContain('Бракує рьо');
      expect(text).not.toMatch(/\{[A-Za-z_]\w*\}/);
      expect(unfilledPlaceholders()).toEqual([]);
    });
  }
});
