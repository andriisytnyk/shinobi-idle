import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  content,
  CURRENCY_IDS,
  ICON_KINDS,
  ICON_MAP,
  iconFor,
  NATURE_IDS,
  SKILL_IDS,
  STATUS_IDS,
  TECH_SKILL_IDS,
  TRAIT_IDS,
  type IconKind,
} from '../src/index.ts';

const require = createRequire(import.meta.url);
const collection = JSON.parse(
  readFileSync(require.resolve('@iconify-json/game-icons/icons.json'), 'utf8'),
) as { icons: Record<string, unknown>; aliases?: Record<string, unknown> };

const exists = (name: string) =>
  Object.hasOwn(collection.icons, name) || Object.hasOwn(collection.aliases ?? {}, name);

/** Every entity id of each kind that must carry an icon. */
const required: Record<IconKind, string[]> = {
  skill: [...SKILL_IDS],
  technique: content.techniques.map((t) => t.id),
  item: content.items.map((i) => i.id),
  status: [...STATUS_IDS],
  trait: [...TRAIT_IDS, 'shield'],
  nature: [...NATURE_IDS],
  currency: [...CURRENCY_IDS],
  enemy: content.enemies.map((e) => e.id),
  boss: content.bosses.map((b) => b.id),
  building: content.buildings.map((b) => b.id),
  region: content.regions.map((r) => r.id),
  gear: content.gear.map((g) => g.id),
  exercise: content.exercises.map((e) => e.id),
  practice: content.practices.map((p) => p.id),
  obstacle: content.obstacles.map((o) => o.id),
  recipe: content.recipes.map((r) => r.id),
};

describe('icon registry', () => {
  it('covers the expected number of entities', () => {
    expect(required.skill).toHaveLength(16);
    expect(required.technique).toHaveLength(60);
    expect(required.status).toHaveLength(5);
    expect(required.trait).toHaveLength(9);
    expect(required.nature).toHaveLength(5);
    expect(required.currency).toHaveLength(3);
  });

  const need = (kind: string): string[] => required[kind] ?? [];
  for (const kind of ICON_KINDS) {
    it(`maps every ${kind} to an icon that exists in game-icons`, () => {
      const missing = need(kind).filter((id) => iconFor(kind, id) === undefined);
      expect(missing, `${kind} entities without an icon`).toEqual([]);
      const unknown = need(kind).filter((id) => !exists(iconFor(kind, id) ?? ''));
      expect(unknown, `${kind} entities whose icon is not in the collection`).toEqual([]);
    });

    it(`has no stale ${kind} entries`, () => {
      const stale = Object.keys(ICON_MAP[kind] ?? {}).filter((id) => !need(kind).includes(id));
      expect(stale).toEqual([]);
    });
  }

  it('gives each of the 16 skills a different icon', () => {
    const icons = SKILL_IDS.map((id) => iconFor('skill', id));
    expect(new Set(icons).size).toBe(SKILL_IDS.length);
  });

  for (const skill of TECH_SKILL_IDS) {
    it(`gives at least 70% of ${skill} techniques distinct icons`, () => {
      const own = content.techniques.filter((t) => t.skill === skill);
      const distinct = new Set(own.map((t) => iconFor('technique', t.id)));
      expect(distinct.size / own.length).toBeGreaterThanOrEqual(0.7);
    });
  }

  it('uses one pictogram for at most two actions of a skill', () => {
    const bySkill = new Map<string, string[]>();
    const add = (skill: string, kind: IconKind, id: string) => {
      const list = bySkill.get(skill) ?? [];
      list.push(iconFor(kind, id) ?? '');
      bySkill.set(skill, list);
    };
    for (const t of content.techniques) add(t.skill, 'technique', t.id);
    for (const e of content.exercises) add('cc', 'exercise', e.id);
    for (const p of content.practices) add('med', 'practice', p.id);
    for (const o of content.obstacles) add('ath', 'obstacle', o.id);
    for (const h of content.herbs) add('herb', 'item', h.id);
    for (const r of content.recipes) add(r.skill, 'recipe', r.id);
    for (const [skill, names] of bySkill) {
      const counts = new Map<string, number>();
      for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
      const over = [...counts].filter(([, c]) => c > 2).map(([n]) => n);
      expect(over, `skill ${skill}`).toEqual([]);
    }
  });
});
