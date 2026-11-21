import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sidePanel } from '../src/lib/side-panel.svelte.ts';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

describe('card grids hold at any column width', () => {
  const grids = [
    'tiles.css',
    'components/ActionTile.svelte',
    'pages/SkillPage.svelte',
    'pages/FieldworkPage.svelte',
    'components/CoursePanel.svelte',
    'components/ScoutPanel.svelte',
    'components/BingoBook.svelte',
    'components/BattleReport.svelte',
    'components/FightScreen.svelte',
  ];

  it('every card grid caps its minimum at the container width', () => {
    for (const file of grids) {
      const lines = read(file)
        .split('\n')
        .filter((l) => /grid-template-columns:.*minmax\(.*var\(/.test(l));
      expect(lines.length, file).toBeGreaterThan(0);
      for (const line of lines) expect(line, file).toMatch(/minmax\(min\(100%, var\(/);
    }
  });

  it('stat values wrap instead of running out of the card', () => {
    for (const file of ['tiles.css', 'components/ActionTile.svelte']) {
      const css = read(file);
      expect(css, file).not.toMatch(/white-space:\s*nowrap/);
      expect(css, file).toMatch(/overflow-wrap:\s*break-word/);
    }
  });
});

describe('one side panel at a time', () => {
  it('the developer panel state lives in a store the app reads to swap «Мета» out', () => {
    expect(sidePanel.dev).toBe(false);
    sidePanel.dev = true;
    expect(sidePanel.dev).toBe(true);
    sidePanel.dev = false;
    const app = read('App.svelte');
    expect(app).toContain('metaOpen && !sidePanel.dev');
    expect(app).toContain('{#if metaShown}');
    expect(read('dev/DevPanel.svelte')).toContain('sidePanel.dev');
  });
});
