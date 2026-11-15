import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CELL_KEYS, content, NATURE_IDS, SKILL_IDS, ukLocale } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { BANK_TABS } from '../src/lib/crafts.ts';
import { HINTS } from '../src/lib/hints.ts';

const src = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Keys written as string literals: `t('a.b')`, `text="a.b"`, `key: 'a.b'`, `textKey: 'a.b'`. */
const LITERAL_KEY =
  /\bt\(\s*'([a-zA-Z0-9_.]+)'|\btext="([a-zA-Z0-9_.]+)"|\b(?:key|textKey|label): '([a-zA-Z0-9_.]+)'/g;

describe('interface strings', () => {
  const files = walk(src).filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f));

  for (const file of files) {
    const name = relative(src, file).replaceAll('\\', '/');
    if (name.endsWith('icons.generated.ts')) continue;
    it(`${name} uses only keys that exist in the Ukrainian locale`, () => {
      const text = readFileSync(file, 'utf8');
      const missing: string[] = [];
      for (const m of text.matchAll(LITERAL_KEY)) {
        const key = m[1] ?? m[2] ?? m[3];
        if (key !== undefined && !(key in ukLocale)) missing.push(key);
      }
      expect(missing).toEqual([]);
    });
  }

  it('has every key that is built from a family at run time', () => {
    const families: Record<string, readonly string[]> = {
      'rank.': ['student', 'genin', 'chunin'],
      'topbar.save.': ['idle', 'saved', 'error'],
      'technique.src.': ['N', 'S', 'O', 'Q'],
      'item.kind.': ['ingredient', 'tool', 'misc', 'consumable'],
      'item.source.': ['crate', 'forge', 'market'],
      'report.reason.': ['manual', 'requirements', 'replaced', 'missing', 'finished', 'defeated'],
      'toast.stopped.': ['requirements', 'missing', 'finished', 'defeated'],
      'req.type.': ['quest', 'building'],
      'req.flag.': ['firstFight'],
      'quests.step': ['Done', 'Current', 'Pending'],
      'hint.': HINTS.map((h) => h.id),
      'hint.title.': HINTS.map((h) => h.id),
      'log.': ['cast', 'hit', 'miss', 'basicHit', 'basicMiss', 'enemyHit', 'enemyMiss'],
      'combat.doing.': ['ready', 'cast', 'recover', 'attack', 'respawn'],
      'entity.kind.': [
        'skill',
        'technique',
        'item',
        'recipe',
        'mission',
        'enemy',
        'boss',
        'region',
        'building',
        'gear',
        'seal',
        'exercise',
        'practice',
        'obstacle',
        'status',
        'trait',
        'cell',
        'poi',
        'combo',
      ],
      'nature.character.': NATURE_IDS,
      'world.key.': CELL_KEYS,
      'world.poi.kind.': [
        'outpost',
        'training',
        'zone',
        'story',
        'deposit',
        'cache',
        'vault',
        'mission',
      ],
      'shop.section.': ['market', 'forge', 'sell', 'gear'],
      'bank.tab.': BANK_TABS,
      'craft.src.': ['herb', 'shop', 'craft', 'item'],
    };
    const missing: string[] = [];
    for (const [prefix, ids] of Object.entries(families)) {
      for (const id of ids) if (!(`${prefix}${id}` in ukLocale)) missing.push(`${prefix}${id}`);
    }
    expect(missing).toEqual([]);
  });

  it('has a text for every reason the core can refuse a command with', () => {
    const core = fileURLToPath(new URL('../../../packages/core/src', import.meta.url));
    const missing: string[] = [];
    for (const file of walk(core).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/'(error\.[a-zA-Z]+)'/g)) {
        if (m[1] !== undefined && !(m[1] in ukLocale)) missing.push(m[1]);
      }
    }
    expect(missing).toEqual([]);
  });

  it('names every skill the unlock rules can mention', () => {
    for (const id of SKILL_IDS) expect(ukLocale[`skill.${id}.name`], id).toBeTruthy();
    for (const skill of content.skills) {
      if (skill.unlockReq?.t === 'flag') {
        expect(ukLocale[`req.flag.${skill.unlockReq.id}`], skill.id).toBeTruthy();
      }
    }
  });
});
