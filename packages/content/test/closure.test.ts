/**
 * Closure validator: every rule from build_slice.mjs (the "audit"), as tests over the content database.
 * A failing test names the offending entity so a content change is easy to fix.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import idRegistry from '../src/packs/core/id-registry.json' with { type: 'json' };
import {
  content,
  KEY_NATURES,
  NATURE_IDS,
  TECH_SKILL_IDS,
  TRAIT_ANSWER,
  TRAIT_IDS,
  ukLocale,
  type Mission,
  type MissionStage,
  type NatureId,
  type Rank,
} from '../src/index.ts';

const natures: readonly string[] = NATURE_IDS;
const isNature = (skill: string) => natures.includes(skill);
const name = (kind: string, id: string) => ukLocale[`${kind}.${id}.name`] ?? id;
const techById = new Map(content.techniques.map((t) => [t.id, t]));
const everyEnemy = [...content.enemies, ...content.bosses];
const DAMAGE_ROLES = ['projectile', 'series', 'area', 'signature'];
const RANK_BAND: Partial<Record<Rank, [number, number]>> = {
  E: [1, 30],
  D: [1, 30],
  C: [30, 50],
  B: [50, 70],
  A: [70, 90],
  S: [90, 99],
};

describe('techniques: composition and gaps', () => {
  for (const skill of TECH_SKILL_IDS) {
    const own = content.techniques.filter((t) => t.skill === skill);

    it(`${skill}: no level gap above 10 between techniques available without a boss`, () => {
      const levels = [...new Set(own.filter((t) => t.src !== 'O').map((t) => t.level))].sort(
        (a, b) => a - b,
      );
      for (let i = 1; i < levels.length; i++) {
        const gap = (levels[i] as number) - (levels[i - 1] as number);
        expect(gap, `${skill}: gap between ${levels[i - 1]} and ${levels[i]}`).toBeLessThanOrEqual(
          10,
        );
      }
    });

    it(`${skill}: at least two attack techniques, one at level 35 or lower not from a boss`, () => {
      const attacks = own.filter((t) => DAMAGE_ROLES.includes(t.role));
      expect(attacks.length, `${skill} attacks`).toBeGreaterThanOrEqual(2);
      expect(
        attacks.some((t) => t.level <= 35 && t.src !== 'O'),
        `${skill}: attack at level <= 35 without a boss`,
      ).toBe(true);
    });
  }

  it('canon-verified ranks sit inside their level band', () => {
    for (const t of content.techniques) {
      const band = t.rank ? RANK_BAND[t.rank] : undefined;
      if (t.rankCanon && band) {
        expect(t.level, `${name('technique', t.id)} rank ${t.rank}`).toBeGreaterThanOrEqual(
          band[0],
        );
        expect(t.level, `${name('technique', t.id)} rank ${t.rank}`).toBeLessThanOrEqual(band[1]);
      }
    }
  });

  it('every seal id in a sequence exists', () => {
    const seals = new Set(content.seals.map((s) => s.id));
    for (const t of content.techniques) {
      for (const s of t.sealSeq) expect(seals.has(s), `${t.id}: unknown seal ${s}`).toBe(true);
    }
  });

  it('technique levels are 1 or a multiple of 5', () => {
    for (const t of content.techniques) {
      expect(t.level === 1 || t.level % 5 === 0, `${t.id}: level ${t.level}`).toBe(true);
    }
  });
});

describe('items: source and consumer', () => {
  const recipeIngredients = new Set(
    content.recipes.flatMap((r) => r.ingredients.map((i) => i.item)),
  );
  const stageItems = new Set(
    content.missions.flatMap((m) => m.stages.flatMap((s) => (s.t === 'items' ? [s.item] : []))),
  );
  const payItems = new Set(
    content.missions.flatMap((m) => m.pay.flatMap((p) => (p.kind === 'item' ? [p.item] : []))),
  );
  const crafted = new Set(content.recipes.map((r) => r.output.item));
  const herbIds = new Set(content.herbs.map((h) => h.id));
  const marketIds = new Set(content.market.map((m) => m.item));
  const madeFromIds = new Set(content.items.flatMap((i) => i.madeFrom.map((x) => x.item)));
  const byId = new Map(content.items.map((i) => [i.id, i]));

  const worked = new Set(
    content.fieldworks.flatMap((w) =>
      w.drops.flatMap((d) => d.payout.items?.map((i) => i.item) ?? []),
    ),
  );
  const hasSource = (id: string) =>
    herbIds.has(id) ||
    worked.has(id) ||
    marketIds.has(id) ||
    payItems.has(id) ||
    crafted.has(id) ||
    (byId.get(id)?.extraSources.length ?? 0) > 0 ||
    (byId.get(id)?.madeFrom.length ?? 0) > 0;
  const hasConsumer = (id: string) =>
    recipeIngredients.has(id) || stageItems.has(id) || madeFromIds.has(id);

  // Same set as the original audit: every item that has a source or a consumer in the slice
  // (herbs, market goods, ingredient payments, recipe ingredients, mission item stages).
  const audited = new Set([
    ...content.items.filter((i) => i.kind === 'ingredient').map((i) => i.id),
    ...recipeIngredients,
    ...stageItems,
  ]);
  // The antidote is crafted for a mission stage and has no other consumer by design.
  const NO_CONSUMER_REQUIRED = new Set(['core:antidote']);

  it('every referenced item exists', () => {
    for (const id of [...recipeIngredients, ...stageItems, ...payItems, ...madeFromIds]) {
      expect(byId.has(id), `item ${id} is referenced but undefined`).toBe(true);
    }
  });

  it('every audited item has a source', () => {
    for (const id of audited) expect(hasSource(id), `${name('item', id)}: no source`).toBe(true);
  });

  it('every audited item has a consumer', () => {
    for (const id of audited) {
      if (NO_CONSUMER_REQUIRED.has(id)) continue;
      expect(hasConsumer(id), `${name('item', id)}: no consumer`).toBe(true);
    }
  });

  it('every ingredient payment item has a source', () => {
    for (const id of payItems) {
      if (byId.get(id)?.kind === 'ingredient') expect(hasSource(id), id).toBe(true);
    }
  });

  it('every herb and market good is an ingredient item', () => {
    for (const id of [...herbIds, ...marketIds]) expect(byId.get(id)?.kind).toBe('ingredient');
  });
});

describe('enemy traits and natures', () => {
  for (const trait of TRAIT_IDS) {
    const tag = TRAIT_ANSWER[trait] ?? '';
    it(`${trait}: has an answer (${tag}) and an enemy that uses it`, () => {
      const answers =
        content.techniques.filter((t) => t.tags.includes(tag)).length +
        content.items.filter((i) => i.tags.includes(tag)).length +
        content.recipes.filter((r) => r.tags.includes(tag)).length;
      expect(answers, `${trait}: no answer tagged ${tag}`).toBeGreaterThan(0);
      expect(
        everyEnemy.some((e) => e.traits.includes(trait)),
        `${trait}: no enemy has it`,
      ).toBe(true);
    });
  }

  it('every nature appears on some enemy', () => {
    for (const nat of NATURE_IDS) {
      expect(
        everyEnemy.some((e) => e.nature === nat),
        `no enemy has nature ${nat}`,
      ).toBe(true);
    }
  });
});

describe('nature trios', () => {
  const trios: NatureId[][] = [];
  for (let a = 0; a < 5; a++)
    for (let b = a + 1; b < 5; b++)
      for (let c = b + 1; c < 5; c++)
        trios.push([NATURE_IDS[a], NATURE_IDS[b], NATURE_IDS[c]] as NatureId[]);

  const canStage = (s: MissionStage, trio: readonly string[]): boolean => {
    switch (s.t) {
      case 'skill':
      case 'combat':
      case 'items':
        return true;
      case 'tech':
        return s.any.some((r) => !isNature(r.skill) || trio.includes(r.skill));
      case 'named':
        return [s.technique, ...s.alts].some((id) => {
          const t = techById.get(id);
          return t !== undefined && (!isNature(t.skill) || trio.includes(t.skill));
        });
    }
  };
  const doable = (m: Mission, trio: readonly string[]) => m.stages.every((s) => canStage(s, trio));
  const dcMissions = content.missions.filter((m) => m.rank === 'D' || m.rank === 'C');

  it('has 10 trios and 12 D/C missions', () => {
    expect(trios.length).toBe(10);
    expect(dcMissions.length).toBe(12);
  });

  for (const trio of trios) {
    const label = trio.join('+');
    it(`${label}: all D/C missions and at least four level-6 buildings are available`, () => {
      const available = dcMissions.filter((m) => doable(m, trio));
      expect(available.length, `${label}: D/C missions`).toBe(12);
      const resources = new Set(
        content.missions
          .filter((m) => m.rank === 'V' && doable(m, trio))
          .flatMap((m) => (m.resource ? [m.resource] : [])),
      );
      const level6 = content.buildings.filter(
        (b) => b.tier6 !== null && Object.keys(b.tier6).every((r) => resources.has(r)),
      );
      expect(level6.length, `${label}: level-6 buildings`).toBeGreaterThanOrEqual(4);
    });
  }
});

describe('map', () => {
  it('has three regions of twelve cells each', () => {
    expect(content.regions.length).toBe(3);
    for (const r of content.regions) expect(r.cells.length, r.id).toBe(12);
  });

  it('no story cell sits behind a nature key', () => {
    for (const c of content.cells) {
      if (c.key !== null && (KEY_NATURES[c.key] ?? []).length > 0) {
        expect(c.story, `${name('cell', c.id)} is a story cell behind a ${c.key} key`).toBe(false);
      }
    }
  });

  it('cells point back at their region', () => {
    const cellsById = new Map(content.cells.map((c) => [c.id, c]));
    for (const r of content.regions) {
      for (const id of r.cells) expect(cellsById.get(id)?.region, id).toBe(r.id);
    }
  });
});

describe('references stay inside the slice', () => {
  const enemyIds = new Set(everyEnemy.map((e) => e.id));
  const skills = new Set<string>(content.skills.map((s) => s.id));

  it('missions reference existing techniques, enemies and skills', () => {
    for (const m of content.missions) {
      for (const s of m.stages) {
        if (s.t === 'named') {
          for (const id of [s.technique, ...s.alts]) {
            expect(techById.has(id), `${m.id}: technique ${id}`).toBe(true);
          }
        }
        if (s.t === 'tech') {
          for (const r of s.any) {
            expect(skills.has(r.skill), `${m.id}: skill ${r.skill}`).toBe(true);
            expect(r.min, `${m.id}: ${r.skill} ${r.min}`).toBeLessThanOrEqual(
              content.balance.K.cap,
            );
          }
        }
        if (s.t === 'combat') expect(enemyIds.has(s.enemy), `${m.id}: enemy ${s.enemy}`).toBe(true);
      }
      for (const p of m.pay) {
        if (p.kind === 'scrollPart')
          expect(techById.has(p.technique), `${m.id}: scroll`).toBe(true);
      }
    }
  });

  it('enemies carry only techniques that exist', () => {
    for (const e of everyEnemy) {
      if (e.carries) expect(techById.has(e.carries), `${e.id}: carries ${e.carries}`).toBe(true);
    }
  });

  it('texts do not point at systems outside the slice', () => {
    const OUT = [
      'Інфільтрац',
      'Прикриття',
      'Медичн',
      'Гендзюцу',
      'Букідзюцу',
      'Фуїндзюцу',
      'Призов',
      'Ляльк',
      'Мисливств',
      'Сендзюцу',
      'пасивн',
      'лісових знахідок',
      'Щит',
    ];
    const texts: [string, string][] = [];
    for (const p of content.pools) {
      if (p.pct < 95) texts.push([p.id, ukLocale[`pool.${p.id}.desc`] ?? '']);
    }
    for (const p of content.practices) {
      for (let i = 0; i < p.insight; i++)
        texts.push([p.id, ukLocale[`practice.${p.id}.insight.${i}`] ?? '']);
      for (let i = 0; i < p.enlight; i++)
        texts.push([p.id, ukLocale[`practice.${p.id}.enlight.${i}`] ?? '']);
    }
    for (const o of content.obstacles) texts.push([o.id, ukLocale[`obstacle.${o.id}.desc`] ?? '']);
    for (const [id, text] of texts) {
      const hit = OUT.find((w) => text.includes(w));
      expect(hit, `${id}: "${text}" points outside the slice`).toBeUndefined();
    }
  });
});

describe('identity and localization', () => {
  const collections: [string, { id: string }[]][] = [
    ['technique', content.techniques],
    ['seal', content.seals],
    ['exercise', content.exercises],
    ['practice', content.practices],
    ['obstacle', content.obstacles],
    ['herb', content.herbs],
    ['pool', content.pools],
    ['item', content.items],
    ['recipe', content.recipes],
    ['mission', content.missions],
    ['region', content.regions],
    ['cell', content.cells],
    ['enemy', content.enemies],
    ['boss', content.bosses],
    ['building', content.buildings],
    ['gear', content.gear],
  ];

  it('ids are unique inside each collection', () => {
    for (const [kind, list] of collections) {
      expect(new Set(list.map((e) => e.id)).size, kind).toBe(list.length);
    }
  });

  it('skills keep short ids, everything else is core:<slug>', () => {
    for (const s of content.skills) expect(s.id).toMatch(/^[a-z]+$/);
    for (const [kind, list] of collections) {
      for (const e of list) expect(e.id, kind).toMatch(/^core:[a-z0-9_]+$/);
    }
  });

  it('every entity has a localized name; pools carry a description instead', () => {
    for (const s of content.skills) expect(ukLocale[`skill.${s.id}.name`], s.id).toBeTruthy();
    for (const [kind, list] of collections) {
      for (const e of list) {
        const lookup = kind === 'herb' ? 'item' : kind;
        const field = kind === 'pool' ? 'desc' : 'name';
        expect(ukLocale[`${lookup}.${e.id}.${field}`], `${kind} ${e.id}`).toBeTruthy();
      }
    }
  });

  it('data files hold no display text', () => {
    // Schemas are strict, and the raw JSON is checked too: no text-bearing keys anywhere.
    const banned = new Set([
      'uk',
      'en',
      'name',
      'desc',
      'home',
      'home2',
      'note',
      'label',
      'client',
      'place',
      'text',
    ]);
    const visit = (value: unknown, where: string): void => {
      if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${where}[${i}]`));
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          expect(
            banned.has(k) && typeof v === 'string',
            `${where}.${k} looks like display text`,
          ).toBe(false);
          visit(v, `${where}.${k}`);
        }
      }
    };
    for (const folder of ['generated', 'hand']) {
      const dir = new URL(`../src/packs/core/data/${folder}/`, import.meta.url);
      for (const file of readdirSync(dir)) {
        visit(JSON.parse(readFileSync(new URL(file, dir), 'utf8')), `${folder}/${file}`);
      }
    }
  });

  it('every id is in the id registry and ids are unique per kind', () => {
    const registered = Object.fromEntries(
      Object.entries(idRegistry).map(([kind, m]) => [kind, Object.values(m)]),
    );
    for (const [kind, slugs] of Object.entries(registered)) {
      expect(new Set(slugs).size, `registry kind ${kind} has duplicate ids`).toBe(slugs.length);
    }
    const has = (kind: string, id: string) =>
      (registered[kind] ?? []).includes(id.replace('core:', ''));
    for (const e of content.exercises) expect(has('exercise', e.id), e.id).toBe(true);
    for (const e of content.obstacles) expect(has('obstacle', e.id), e.id).toBe(true);
    for (const e of content.practices) expect(has('practice', e.id), e.id).toBe(true);
    for (const e of content.recipes) expect(has('recipe', e.id), e.id).toBe(true);
    for (const e of content.gear) expect(has('gear', e.id), e.id).toBe(true);
    for (const e of content.cells) expect(has('cell', e.id), e.id).toBe(true);
    const resources = new Set([
      ...content.buildings.flatMap((b) => Object.keys(b.tier6 ?? {})),
      ...content.missions.flatMap((m) => (m.resource ? [m.resource] : [])),
    ]);
    for (const r of resources) expect(has('resource', r), r).toBe(true);
  });
});
