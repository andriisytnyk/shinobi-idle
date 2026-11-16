/**
 * Closure validator, combat part: technique combat data, boss specials, loot, zones, operations,
 * scrolls, statuses, traits and combos. A failing test names the offending entity.
 */
import { describe, expect, it } from 'vitest';
import handBossSpecials from '../src/packs/core/data/hand/boss-specials.json' with { type: 'json' };
import handEnemyCombat from '../src/packs/core/data/hand/enemy-combat.json' with { type: 'json' };
import handItemEcon from '../src/packs/core/data/hand/item-econ.json' with { type: 'json' };
import handTechniqueCombat from '../src/packs/core/data/hand/technique-combat.json' with { type: 'json' };
import idRegistry from '../src/packs/core/id-registry.json' with { type: 'json' };
import {
  COMBO_IDS,
  content,
  STATUS_IDS,
  TRAIT_ANSWER,
  TRAIT_IDS,
  ukLocale,
  type Item,
  type RoleId,
  type Technique,
} from '../src/index.ts';

const K = content.balance.K;
const techById = new Map(content.techniques.map((t) => [t.id, t]));
const itemById = new Map(content.items.map((i) => [i.id, i]));
const everyEnemy = [...content.enemies, ...content.bosses];
const enemyIds = new Set(everyEnemy.map((e) => e.id));
const slug = (id: string) => id.replace('core:', '');
const nonTraining = content.techniques.filter((t) => t.role !== 'drill');
const registered = (kind: string): string[] =>
  Object.values((idRegistry as Record<string, Record<string, string>>)[kind] ?? {});

describe('technique combat data', () => {
  it('has an entry for each of the 47 non-training techniques and none for drills', () => {
    expect(nonTraining).toHaveLength(47);
    for (const t of nonTraining) expect(t.combat, `${t.id} has no combat data`).not.toBeNull();
    for (const t of content.techniques.filter((x) => x.role === 'drill')) {
      expect(t.combat, `${t.id} is a drill`).toBeNull();
    }
  });

  const ALLOWED: Record<RoleId, readonly string[]> = {
    projectile: ['damage'],
    series: ['damage'],
    area: ['damage'],
    signature: ['damage'],
    control: ['damage', 'none', 'reveal'],
    defense: ['none', 'cleanse'],
    buff: ['stance', 'nextCast', 'none'],
    drill: [],
  };

  it('keeps every effect consistent with the role of the technique', () => {
    for (const t of nonTraining) {
      const kind = t.combat?.effect.kind ?? 'missing';
      expect(ALLOWED[t.role], `${t.id} (${t.role}) has effect ${kind}`).toContain(kind);
    }
  });

  it('deals damage exactly when the technique is not marked noDamage', () => {
    for (const t of nonTraining.filter((x) => ['control', 'projectile', 'area'].includes(x.role))) {
      expect(t.combat?.effect.kind === 'damage', `${t.id}`).toBe(!t.noDamage);
    }
  });

  const effectOf = (id: string) => techById.get(id)?.combat;

  it('matches the slice for the defensive techniques', () => {
    // They do nothing in the hand: each is passive and names the row of the passive numbers it adds by.
    for (const id of ['core:earth_style_wall', 'core:water_formation_wall'])
      expect(effectOf(id)).toEqual({ effect: { kind: 'none' }, passive: { fx: 'shield' } });
    for (const id of ['core:clone', 'core:water_clone'])
      expect(effectOf(id)).toEqual({ effect: { kind: 'none' }, passive: { fx: 'decoy' } });
    expect(effectOf('core:hiding_in_mist')).toEqual({
      effect: { kind: 'none' },
      passive: { fx: 'evasionBuff' },
    });
    expect(effectOf('core:rope_escape')?.effect).toEqual({ kind: 'cleanse', statuses: ['bind'] });
    expect(effectOf('core:body_replacement')).toEqual({
      effect: { kind: 'none' },
      passive: { fx: 'passiveNegate' },
    });
    // Every defensive technique is passive and names a row of the passive numbers that exists.
    for (const t of techById.values()) {
      if (t.combat?.passive) expect(Object.keys(K.passiveFx)).toContain(t.combat.passive.fx);
    }
  });

  it('matches the slice for the buffs and utility techniques', () => {
    expect(effectOf('core:gate_of_opening')?.effect).toEqual({ kind: 'stance', fx: 'gateOpening' });
    expect(effectOf('core:gate_of_healing')?.effect).toEqual({ kind: 'stance', fx: 'gateHealing' });
    expect(effectOf('core:body_flicker')?.effect).toEqual({ kind: 'nextCast', fx: 'nextCast' });
    expect(effectOf('core:transformation')?.effect).toEqual({ kind: 'none' });
    expect(effectOf('core:sensing')?.effect).toEqual({ kind: 'reveal', fx: 'reveal' });
    for (const id of ['core:enclosing', 'core:hiding_like_a_mole'])
      expect(effectOf(id)?.effect).toEqual({ kind: 'none' });
    expect(effectOf('core:front_lotus')?.requiresStance).toBe(true);
    expect(effectOf('core:wave_of_inspiration')?.guaranteedCombo).toBe('shockWet');
    expect(effectOf('core:shadow_clone')).toMatchObject({
      effect: { kind: 'damage' },
      hitsAll: true,
    });
  });

  it('names only effect numbers that exist in the balance object', () => {
    for (const t of nonTraining) {
      const e = t.combat?.effect;
      if (e && 'fx' in e) expect(K.techFx, `${t.id}: ${e.fx}`).toHaveProperty(e.fx);
      const c = t.combat?.guaranteedCombo;
      if (c) expect(COMBO_IDS, `${t.id}: combo ${c}`).toContain(c);
    }
  });

  it('only a technique that needs a stance names one and only the gates open it', () => {
    const stances = nonTraining.filter((t) => t.combat?.effect.kind === 'stance');
    expect(stances.map((t) => t.id).sort()).toEqual([
      'core:gate_of_healing',
      'core:gate_of_opening',
    ]);
    expect(nonTraining.filter((t) => t.combat?.requiresStance).map((t) => t.id)).toEqual([
      'core:front_lotus',
    ]);
  });
});

describe('boss specials', () => {
  const special = (id: string) => content.bosses.find((b) => b.id === id)?.special;

  it('gives each of the 8 bosses a special whose numbers exist in the balance object', () => {
    expect(content.bosses).toHaveLength(8);
    for (const b of content.bosses) {
      expect(b.special, `${b.id} has no special`).toBeDefined();
      expect(K.bossFx, `${b.id}: ${b.special.fx}`).toHaveProperty(b.special.fx);
    }
  });

  it('matches the table of bosses', () => {
    expect(special('core:boss_wolf')).toMatchObject({ kind: 'packRespawn' });
    expect(special('core:boss_ren1')).toEqual({
      kind: 'rival',
      fx: 'rivalDuel',
      hook: 'special:rival.duel',
      numbers: ['techniques', 'everyMs', 'sigEveryMs', 'sigOpenMs', 'sigMult', 'mult'],
      signature: true,
      nature: 'beatsPlayerFirst',
    });
    expect(special('core:boss_fighter')).toMatchObject({ kind: 'evasionByMissingHp' });
    expect(special('core:boss_hunter')).toMatchObject({ kind: 'heavyCast', stun: true });
    expect(special('core:boss_twins')).toMatchObject({ kind: 'twins', poisonMist: true });
    expect(special('core:boss_mist')).toMatchObject({ kind: 'rehide', bindPlayer: true });
    expect(special('core:boss_nameless')).toMatchObject({ kind: 'illusion' });
    expect(special('core:boss_ren2')).toMatchObject({
      kind: 'rival',
      fx: 'rivalTournament',
      signature: true,
    });
    expect(K.bossFx.rivalTournament?.techniques ?? 0).toBeGreaterThan(
      K.bossFx.rivalDuel?.techniques ?? 0,
    );
  });
});

describe('enemy loot', () => {
  it('gives every enemy and boss a style, a ryo range from its level and valid drops', () => {
    for (const e of everyEnemy) {
      expect(['melee', 'ranged'], e.id).toContain(e.style);
      expect(e.ryo[0], e.id).toBe(Math.round(e.cl * K.ryoDrop[0]));
      expect(e.ryo[1], e.id).toBe(Math.round(e.cl * K.ryoDrop[1]));
      for (const d of e.drops) {
        const item = itemById.get(d.item);
        expect(item, `${e.id}: drop ${d.item} does not exist`).toBeDefined();
        expect(
          item?.sell !== undefined || item?.use !== undefined || item?.part !== undefined,
          `${e.id}: drop ${d.item} has neither a sell price nor a use`,
        ).toBe(true);
        expect(d.chance, `${e.id}: ${d.item}`).toBe(K.dropChance[slug(d.item) as 'band']);
      }
    }
  });

  it('drops the trophies the slice names', () => {
    const dropsOf = (item: string) =>
      everyEnemy.filter((e) => e.drops.some((d) => d.item === item)).map((e) => slug(e.id));
    expect(dropsOf('core:band')).toEqual(['merc_pack', 'veteran']);
    expect(dropsOf('core:pelt')).toEqual(['wolf', 'boss_wolf']);
    expect(dropsOf('core:fang').sort()).toEqual(['leech', 'serpent', 'tiger']);
    for (const e of content.enemies.filter((x) => x.region === 'valley')) {
      expect(
        e.drops.some((d) => d.item === 'core:coin'),
        e.id,
      ).toBe(true);
    }
    for (const b of content.bosses) {
      expect(
        b.drops.some((d) => d.item === 'core:gem'),
        b.id,
      ).toBe(true);
    }
  });

  it('sells each trophy for the price in the balance extension', () => {
    for (const key of ['band', 'pelt', 'fang', 'coin', 'gem'] as const) {
      expect(itemById.get(`core:${key}`)?.sell, key).toBe(key);
    }
    expect(K.sell).toEqual({ band: 15, pelt: 8, fang: 20, coin: 40, gem: 250 });
  });

  it('makes every carrier drop scroll parts of its technique', () => {
    for (const e of everyEnemy.filter((x) => x.carries !== null)) {
      expect(e.scrollPart, `${e.id} carries a technique but drops no scroll part`).not.toBeNull();
      const part = e.scrollPart;
      expect(part?.technique).toBe(e.carries);
      expect(itemById.get(part?.item ?? '')?.part?.technique, `${e.id}: part item`).toBe(e.carries);
      const isBoss = content.bosses.some((b) => b.id === e.id);
      if (isBoss) expect(part).toMatchObject({ count: K.partDrop.boss });
      else expect(part).toMatchObject({ chance: K.partDrop.carrier });
    }
    for (const e of everyEnemy.filter((x) => x.carries === null)) expect(e.scrollPart).toBeNull();
  });

  it('pays a bounty for the five bounty bosses with the repeat share', () => {
    const paid = content.bosses.filter((b) => b.bounty !== null).map((b) => slug(b.id));
    expect(paid.sort()).toEqual(Object.keys(K.bounty).sort());
    for (const b of content.bosses) {
      if (b.bounty)
        expect(b.bounty).toEqual({ first: K.bounty[slug(b.id)], repeatShare: K.bountyRepeat });
    }
  });
});

describe('zones and operations', () => {
  it('has one fightable zone per non-mission enemy and per boss', () => {
    const wanted = everyEnemy.filter((e) => !('region' in e) || e.region !== 'mission');
    expect(content.zones.map((z) => z.enemy).sort()).toEqual(wanted.map((e) => e.id).sort());
    expect(new Set(content.zones.map((z) => z.id)).size).toBe(content.zones.length);
  });

  it('opens each zone by its region, the Academy or a boss flag', () => {
    for (const z of content.zones) {
      expect(enemyIds.has(z.enemy), `${z.id}: enemy ${z.enemy}`).toBe(true);
      if (z.region === 'academy') expect(z.unlock, z.id).toBeNull();
      else if (z.region === 'boss') {
        expect(z.unlock, z.id).toEqual({
          t: 'flag',
          id: `boss.${slug(z.enemy).replace('boss_', '')}.unlocked`,
        });
      } else expect(z.unlock, z.id).toEqual({ t: 'flag', id: `region.${z.region}.unlocked` });
    }
    const dummy = content.zones.find((z) => z.enemy === 'core:dummy');
    expect(dummy?.region).toBe('academy');
  });

  it('matches the region of the enemy for non-boss zones', () => {
    for (const z of content.zones.filter((x) => x.region !== 'boss')) {
      const e = content.enemies.find((x) => x.id === z.enemy);
      expect(e?.region, z.id).toBe(z.region);
    }
  });

  it('builds the hideout from the approach and three fights', () => {
    const op = content.operations.find((o) => o.id === 'core:op_hideout');
    expect(op?.stages.map((s) => s.t)).toEqual(['approach', 'fight', 'fight', 'fight']);
    expect(op?.stages.flatMap((s) => (s.t === 'fight' ? [s.enemy] : []))).toEqual([
      'core:guard_pack',
      'core:boss_twins',
      'core:boss_mist',
    ]);
  });

  it('builds the Forest of Death from five days of three fights ending with the Nameless', () => {
    const op = content.operations.find((o) => o.id === 'core:op_forest_of_death');
    const stage = op?.stages[0];
    expect(stage).toMatchObject({
      t: 'days',
      days: 5,
      fightsPerDay: 3,
      finale: 'core:boss_nameless',
    });
    if (stage?.t === 'days') {
      for (const id of stage.pool) {
        expect(content.enemies.find((e) => e.id === id)?.region, id).toBe('exam');
      }
    }
  });

  it('references only existing enemies and recovers by the balance share', () => {
    expect(K.opRegen).toBeGreaterThan(0);
    for (const op of content.operations) {
      expect(op.regen).toBe('opRegen');
      for (const s of op.stages) {
        const ids = s.t === 'fight' ? [s.enemy] : s.t === 'days' ? [...s.pool, s.finale] : [];
        for (const id of ids) expect(enemyIds.has(id), `${op.id}: enemy ${id}`).toBe(true);
      }
    }
  });
});

describe('scrolls, parts and tools', () => {
  const home = (t: Technique) => ukLocale[`technique.${t.id}.home`] ?? '';
  const scrollOf = (t: Technique): Item | undefined =>
    content.items.find((i) => i.scroll?.technique === t.id);
  const scrolled = nonTraining.filter((t) => t.src !== 'N');

  it('has a scroll item for every technique that is not taught by a trainer', () => {
    expect(scrolled).toHaveLength(15);
    for (const t of scrolled) {
      const s = scrollOf(t);
      expect(s, `${t.id} has no scroll item`).toBeDefined();
      expect(s?.id).toBe(`core:scroll_${slug(t.id)}`);
    }
    expect(content.items.filter((i) => i.scroll)).toHaveLength(scrolled.length);
  });

  it('has a library level and a price for every library scroll, matching the technique home', () => {
    for (const t of scrolled.filter((x) => x.src === 'S')) {
      const source = scrollOf(t)?.scroll?.source;
      const m = /Бібліотека села, рівень (\d)/.exec(home(t));
      if (m) {
        expect(source, t.id).toEqual({ t: 'library', level: Number(m[1]) });
        expect(K.scroll[String(Number(m[1]))], `${t.id}: library price`).toBeGreaterThan(0);
      } else expect(source, `${t.id}`).toEqual({ t: 'found' });
    }
  });

  it('has a carrier enemy and a scroll-part item for every O-source technique', () => {
    const carried = scrolled.filter((t) => t.src === 'O');
    expect(carried).toHaveLength(5);
    for (const t of carried) {
      expect(
        everyEnemy.some((e) => e.carries === t.id),
        `${t.id} has no carrier`,
      ).toBe(true);
      expect(
        content.items.some((i) => i.part?.technique === t.id),
        `${t.id} has no scroll-part item`,
      ).toBe(true);
      expect(scrollOf(t)?.scroll?.source).toEqual({ t: 'parts' });
    }
    // Plus the part of the fire dragon scroll that the dig mission pays.
    expect(content.items.filter((i) => i.part)).toHaveLength(carried.length + 1);
  });

  it('has the generic notes item', () => {
    expect(itemById.get('core:notes')?.kind).toBe('misc');
  });

  it('prices every tool and answers a trait with every tool tag', () => {
    const answers = new Set<string>(Object.values(TRAIT_ANSWER));
    const tools = content.items.filter((i) => i.kind === 'tool');
    expect(tools.length).toBeGreaterThan(0);
    for (const i of tools) {
      for (const tag of i.tags)
        expect(answers.has(tag), `${i.id}: tag ${tag} answers no trait`).toBe(true);
    }
    for (const id of ['kunai', 'shuriken', 'senbon', 'wire', 'wiretrap', 'tag']) {
      expect(itemById.get(`core:${id}`)?.buy, id).toBe(id);
    }
    for (const i of content.items.filter((x) => x.buy !== undefined)) {
      expect(K.goods, `${i.id}: buy key ${i.buy}`).toHaveProperty(i.buy ?? '');
    }
    for (const i of content.items.filter((x) => x.pouch)) expect(i.kind, i.id).toBe('tool');
    expect(K.pouchStack).toBeGreaterThan(0);
  });

  it('registers every new id in the id registry', () => {
    for (const i of content.items.filter((x) => x.scroll || x.part)) {
      expect(registered('item'), i.id).toContain(slug(i.id));
    }
    for (const z of content.zones) expect(registered('zone'), z.id).toContain(slug(z.id));
    for (const o of content.operations) expect(registered('operation'), o.id).toContain(slug(o.id));
  });
});

describe('statuses, traits and combos', () => {
  it('lists the five statuses with their numbers in the balance object', () => {
    expect(content.statuses.map((s) => s.id)).toEqual([...STATUS_IDS]);
    for (const s of content.statuses) expect(K, s.id).toHaveProperty(s.id);
  });

  it('lists the eight traits with their answer tag and numbers', () => {
    expect(content.traits.map((t) => t.id)).toEqual([...TRAIT_IDS]);
    for (const t of content.traits) {
      expect(t.answer, t.id).toBe(TRAIT_ANSWER[t.id]);
      const source =
        (K as unknown as Record<string, Record<string, unknown>>)[t.numbers.from] ?? {};
      for (const key of t.numbers.keys) expect(source, `${t.id}: ${key}`).toHaveProperty(key);
    }
  });

  it('lists the four combos with their numbers in the balance object', () => {
    expect(content.combos.map((c) => c.id)).toEqual([...COMBO_IDS]);
    for (const c of content.combos) expect(K.combo, c.id).toHaveProperty(c.id);
  });
});

describe('hand-written maps', () => {
  const orphans = (map: object, known: Iterable<string>) => {
    const set = new Set(known);
    return Object.keys(map).filter((id) => !set.has(id));
  };

  it('refer only to existing entities', () => {
    expect(orphans(handTechniqueCombat, techById.keys())).toEqual([]);
    expect(orphans(handEnemyCombat, enemyIds)).toEqual([]);
    expect(
      orphans(
        handBossSpecials,
        content.bosses.map((b) => b.id),
      ),
    ).toEqual([]);
    expect(orphans(handItemEcon, itemById.keys())).toEqual([]);
  });
});
