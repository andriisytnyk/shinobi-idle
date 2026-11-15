// @vitest-environment happy-dom
import { createState } from '@shinobi/core';
import { afterAll, afterEach, beforeAll, describe, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

/*
 * T2. The app booted with `[core]` renders exactly what it rendered before the interface learned to
 * read its vocabularies from content. The snapshots in `__snapshots__/core-pages/` were recorded
 * from `origin/dev` before the change; a difference is either a regression or an intended change
 * that is listed in the pull request.
 */

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

function digest(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${text.length}-${h.toString(36)}`;
}

/** The text and attributes of a node, one line per element, without the scoped-style class hashes. */
export function serialize(node: Node, depth = 0): string {
  const pad = '  '.repeat(depth);
  if (node.nodeType === 3) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text === '' ? '' : `${pad}${text}\n`;
  }
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'style' || tag === 'script') return '';
  const attrs = [...el.attributes]
    .map((a) => {
      // Icon bodies are long; a short digest says as much as the whole path.
      if (a.name === 'd') return `d="#${digest(a.value)}"`;
      const value =
        a.name === 'class'
          ? a.value
              .split(/\s+/)
              .filter((c) => c !== '' && !/^svelte-[a-z0-9]+$/.test(c))
              .join(' ')
          : a.value.replace(/svelte-[a-z0-9]+/g, 'svelte-x');
      return `${a.name}="${value}"`;
    })
    .filter((a) => a !== 'class=""')
    .sort();
  const open = `${pad}<${tag}${attrs.length > 0 ? ' ' + attrs.join(' ') : ''}>\n`;
  let inner = '';
  for (const child of el.childNodes) inner += serialize(child, depth + 1);
  return open + inner;
}

const PAGES: Record<string, string> = {
  home: '#/',
  skills: '#/skills',
  'skill-tai': '#/skill/tai',
  'skill-herb': '#/skill/herb',
  'skill-alch': '#/skill/alch',
  'skill-ath': '#/skill/ath',
  'skill-scout': '#/skill/scout',
  'skill-med': '#/skill/med',
  'technique-fireball': '#/technique/core:great_fireball',
  'technique-clone': '#/technique/core:clone',
  shop: '#/shop',
  village: '#/village',
  'building-forge': '#/building/core:forge',
  world: '#/world',
  nature: '#/nature',
  rank: '#/rank',
  bank: '#/bank',
  quests: '#/quests',
  combat: '#/combat',
  'item-mint': '#/item/core:mint',
  'enemy-wolf': '#/enemy/core:wolf',
  'recipe-first': '#/recipe/core:antidote',
  more: '#/more',
};

let booted: BootedApp | null = null;

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
});

/** A fixed genin: same save on every run, so the pages are the same. */
function fixed() {
  const state = createState(1, game.content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  state.currencies.ryo = 1234;
  return state;
}

describe('the built-in game renders as before (T2)', () => {
  for (const [name, hash] of Object.entries(PAGES)) {
    it(`page ${name} (${hash})`, async ({ expect }) => {
      booted = await bootApp([coreUi], fixed(), hash);
      const main = booted.target.querySelector('main');
      if (!main) throw new Error('no main');
      // The shell (top bar, sidebar) is the same everywhere: it is recorded once, with the home page.
      const shell = name === 'home' ? ['.top', '.side'] : [];
      const parts = [...shell.map((sel) => booted?.target.querySelector(sel) ?? null), main];
      const html = parts.map((n) => (n ? serialize(n) : '')).join('---\n');
      await expect(html).toMatchFileSnapshot(`__snapshots__/core-pages/${name}.txt`);
    });
  }
});
