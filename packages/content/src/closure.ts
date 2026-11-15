/**
 * The closure validator of a composed database: every reference to a vocabulary member or an
 * entity must name something the composed packs define, every number a vocabulary member needs must
 * exist in the balance object, and every modifier key must be a key of the composed database.
 * Each problem names the pack that owns the entity holding the dangling reference.
 */
import type { ContentDb, Req } from './schema.ts';
import type { EntityListKey } from './pack.ts';

export interface ClosureProblem {
  pack: string;
  message: string;
}

export interface ClosureOptions {
  /** The pack that owns the entity `id` of `list`. */
  owner(list: string, id: string): string;
  /** The pack that contributed the icon `id` of `kind`. */
  iconOwner(kind: string, id: string): string;
  /** The locale kind of each list whose entities need a name and a description. */
  described: Partial<Record<EntityListKey, string>>;
}

type Plain = Record<string, unknown>;

export function validateClosure(db: ContentDb, options: ClosureOptions): ClosureProblem[] {
  const problems: ClosureProblem[] = [];
  const ids = (list: readonly { id: string }[]) => new Set(list.map((e) => e.id));
  const set = {
    skills: ids(db.skills),
    techSkills: ids(db.skills.filter((s) => s.activity === 'tech')),
    recipeSkills: ids(db.skills.filter((s) => s.activity === 'recipe' || s.activity === 'station')),
    groups: ids(db.skillGroups),
    natures: ids(db.natures),
    ranks: ids(db.playerRanks),
    techRanks: ids(db.techRanks),
    missionRanks: ids(db.missionRanks),
    states: ids(db.states),
    statuses: ids(db.statuses),
    combos: ids(db.combos),
    tags: ids(db.tags),
    roles: ids(db.roles),
    traits: ids(db.traits),
    styles: ids(db.attackStyles),
    fightRegions: ids(db.fightRegions),
    kinds: ids(db.itemKinds),
    trophies: ids(db.trophies),
    gearFx: ids(db.gearFx),
    entityKinds: ids(db.entityKinds),
    cellKeys: new Set(Object.keys(db.cellKeys)),
    items: ids(db.items),
    techniques: ids(db.techniques),
    enemies: ids([...db.enemies, ...db.bosses]),
    buildings: ids(db.buildings),
    quests: ids(db.quests),
    zones: ids(db.zones),
    missions: ids(db.missions),
    seals: ids(db.seals),
    cells: ids(db.cells),
    regions: ids(db.regions),
    resources: ids(db.resources),
    currencies: ids(db.currencies),
  };
  type SetName = keyof typeof set;

  let current: { list: string; id: string } = { list: '', id: '' };
  const at = (list: string, id: string) => {
    current = { list, id };
  };
  const problem = (field: string, message: string) => {
    problems.push({
      pack: options.owner(current.list, current.id),
      message: `${current.list} "${current.id}" field ${field}: ${message}`,
    });
  };
  const ref = (field: string, value: unknown, name: SetName, extra: readonly string[] = []) => {
    if (typeof value !== 'string' || (!set[name].has(value) && !extra.includes(value)))
      problem(field, `${JSON.stringify(value)} is not a known ${name}`);
  };
  const refs = (field: string, values: readonly unknown[], name: SetName) =>
    values.forEach((v, i) => ref(`${field}[${i}]`, v, name));

  const K = db.balance.K as unknown as Record<string, unknown>;
  const num = (path: string): boolean => {
    let v: unknown = K;
    for (const part of path.split('.')) {
      if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part)) return false;
      v = (v as Plain)[part];
    }
    return typeof v === 'number' || (v !== null && typeof v === 'object');
  };
  const needNumber = (field: string, path: string) => {
    if (!num(path)) problem(field, `balance K.${path} is missing`);
  };

  const req = (field: string, r: Req | null | undefined): void => {
    if (!r) return;
    switch (r.t) {
      case 'skill':
        ref(`${field}.skill`, r.skill, 'skills');
        break;
      case 'technique':
        ref(`${field}.id`, r.id, 'techniques');
        break;
      case 'rank':
        ref(`${field}.rank`, r.rank, 'ranks');
        break;
      case 'nature':
        ref(`${field}.nature`, r.nature, 'natures');
        break;
      case 'item':
        ref(`${field}.id`, r.id, 'items');
        break;
      case 'quest':
        ref(`${field}.id`, r.id, 'quests');
        break;
      case 'building':
        ref(`${field}.id`, r.id, 'buildings');
        break;
      case 'flag':
        break;
      case 'all':
      case 'any':
        r.of.forEach((x, i) => req(`${field}.of[${i}]`, x));
        break;
    }
  };

  /** Every modifier anywhere in an entity: its key is a key of the composed database and its nature exists. */
  const scanMods = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => scanMods(v, `${path}[${i}]`));
      return;
    }
    const o = value as Plain;
    if (
      typeof o.key === 'string' &&
      (o.op === 'add' || o.op === 'mul') &&
      typeof o.value === 'number'
    ) {
      if (!Object.hasOwn(db.modifierKeys, o.key))
        problem(`${path}.key`, `unknown modifier key "${o.key}"`);
      if (typeof o.nature === 'string') ref(`${path}.nature`, o.nature, 'natures');
      return;
    }
    for (const [k, v] of Object.entries(o)) scanMods(v, `${path}.${k}`);
  };

  // ----- vocabularies -----
  for (const s of db.skills) {
    at('skills', s.id);
    ref('group', s.group, 'groups');
    req('unlockReq', s.unlockReq);
  }
  const roleOwner = new Map<string, string>();
  for (const c of db.currencies) {
    at('currencies', c.id);
    if (c.role === undefined) continue;
    const other = roleOwner.get(c.role);
    if (other !== undefined) problem('role', `the role "${c.role}" is already held by "${other}"`);
    else roleOwner.set(c.role, c.id);
  }
  for (const n of db.natures) {
    at('natures', n.id);
    // A nature trains through the skill that has its id.
    if (!set.skills.has(n.id)) problem('id', `the nature has no skill with its id`);
    refs('strongAgainst', n.strongAgainst, 'natures');
    refs('opens', n.opens, 'cellKeys');
    ref('ayaNature', n.ayaNature, 'natures');
  }
  for (const k of db.entityKinds) {
    at('entityKinds', k.id);
    if (k.list !== null && !Array.isArray((db as unknown as Plain)[k.list]))
      problem('list', `"${k.list}" is not a list of the database`);
  }
  for (const [key, r] of Object.entries(db.cellKeys)) {
    at('cellKeys', key);
    req('req', r);
  }
  for (const rank of db.techRanks) {
    at('techRanks', rank.id);
    for (const p of ['power', 'rankCd', 'chakraCost', 'staminaCost'])
      needNumber(p, `${p}.${rank.id}`);
  }
  for (const role of db.roles) {
    at('roles', role.id);
    needNumber('role', `role.${role.id}`);
  }
  for (const stage of db.villageStages) {
    at('villageStages', stage.id);
    if (stage.rep !== null) needNumber('rep', `rep.${stage.rep}`);
  }
  for (const rank of db.missionRanks) {
    at('missionRanks', rank.id);
    needNumber('ryoPerMin', `ryoPerMin.${rank.id}`);
  }
  for (const t of db.trophies) {
    at('trophies', t.id);
    needNumber('dropChance', `dropChance.${t.id}`);
    needNumber('sell', `sell.${t.id}`);
  }
  for (const g of db.gearFx) {
    at('gearFx', g.id);
    needNumber('gearFx', `gearFx.${g.id}`);
  }
  for (const c of db.combos) {
    at('combos', c.id);
    ref('nature', c.nature, 'natures');
    ref('onState', c.onState, 'states');
    needNumber('combo', `combo.${c.id}`);
  }
  for (const t of db.traits) {
    at('traits', t.id);
    ref('answer', t.answer, 'tags');
    for (const key of t.numbers.keys) needNumber('numbers', `${t.numbers.from}.${key}`);
  }
  for (const tier of db.ai.tiers) {
    at('ai', tier.id);
    if (tier.minTier > db.playerRanks.length - 1)
      problem(
        'minTier',
        `${tier.minTier} is above the highest player tier ${db.playerRanks.length - 1}`,
      );
  }
  for (const [n, trait] of db.ai.visibleTraits.entries()) {
    at('aiTrait', trait);
    ref(`visibleTraits[${n}]`, trait, 'traits');
  }
  /** The tier of a player rank is its position in the list: the AI runs by tier. */
  for (const [n, r] of db.playerRanks.entries()) {
    at('playerRanks', r.id);
    if (r.tier !== n)
      problem('tier', `${r.tier} must be the position ${n} of the rank in the list`);
  }

  // ----- techniques, seals, items, recipes -----
  for (const t of db.techniques) {
    at('techniques', t.id);
    ref('skill', t.skill, 'techSkills');
    if (t.rank !== null) ref('rank', t.rank, 'techRanks');
    ref('role', t.role, 'roles');
    refs('tags', t.tags, 'tags');
    if (t.state !== null) ref('state', t.state, 'states');
    refs('sealSeq', t.sealSeq, 'seals');
    if (t.combat) {
      if (t.combat.guaranteedCombo !== undefined)
        ref('combat.guaranteedCombo', t.combat.guaranteedCombo, 'combos');
      const fx = t.combat.effect;
      if (fx.kind === 'cleanse') refs('combat.effect.statuses', fx.statuses, 'statuses');
      if ('fx' in fx) needNumber('combat.effect.fx', `techFx.${fx.fx}`);
    }
  }
  for (const p of db.practices) {
    at('practices', p.id);
    refs('pair', p.pair, 'skills');
  }
  for (const o of db.obstacles) {
    at('obstacles', o.id);
    req('req', o.req);
  }
  for (const h of db.herbs) {
    at('herbs', h.id);
    req('req', h.req);
  }
  for (const p of db.pools) {
    at('pools', p.id);
    ref('skill', p.skill, 'skills');
  }
  for (const i of db.items) {
    at('items', i.id);
    ref('kind', i.kind, 'kinds');
    refs('tags', i.tags, 'tags');
    i.madeFrom.forEach((m, n) => ref(`madeFrom[${n}].item`, m.item, 'items'));
    if (i.sell !== undefined) ref('sell', i.sell, 'trophies');
    if (i.scroll) ref('scroll.technique', i.scroll.technique, 'techniques');
    if (i.part) ref('part.technique', i.part.technique, 'techniques');
    const fx = i.fx;
    if (fx) {
      if (fx.kind === 'cleanse') {
        refs('fx.statuses', fx.statuses, 'statuses');
        if (fx.resist) ref('fx.resist.nature', fx.resist.nature, 'natures');
      }
      if (fx.kind === 'dispel' || fx.kind === 'poison') ref('fx.tag', fx.tag, 'tags');
      if (fx.kind === 'tonic' && fx.skill !== 'allNatures') ref('fx.skill', fx.skill, 'skills');
      if (fx.kind === 'sleep') needNumber('fx.fx', `itemFx.${fx.fx}`);
    }
  }
  for (const m of db.market) {
    at('market', m.item);
    ref('item', m.item, 'items');
    if (m.supplier !== null) ref('supplier', m.supplier, 'buildings');
  }
  for (const s of db.shop) {
    at('shop', s.item);
    if (s.currency !== undefined) ref('currency', s.currency, 'currencies');
    ref('item', s.item, 'items');
    req('req', s.req);
  }
  for (const c of db.coat) {
    at('coat', c.product);
    ref('poison', c.poison, 'items');
    ref('base', c.base, 'items');
    ref('product', c.product, 'items');
  }
  for (const r of db.recipes) {
    at('recipes', r.id);
    ref('skill', r.skill, 'recipeSkills');
    r.ingredients.forEach((x, n) => ref(`ingredients[${n}].item`, x.item, 'items'));
    ref('output.item', r.output.item, 'items');
    refs('tags', r.tags, 'tags');
  }

  // ----- missions, world -----
  for (const m of db.missions) {
    at('missions', m.id);
    ref('rank', m.rank, 'missionRanks');
    req('unlock', m.unlock);
    m.stages.forEach((s, n) => {
      const f = `stages[${n}]`;
      if (s.t === 'skill') ref(`${f}.skill`, s.skill, 'skills');
      if (s.t === 'tech') s.any.forEach((a, k) => ref(`${f}.any[${k}].skill`, a.skill, 'skills'));
      if (s.t === 'named') {
        ref(`${f}.technique`, s.technique, 'techniques');
        refs(`${f}.alts`, s.alts, 'techniques');
      }
      if (s.t === 'combat') ref(`${f}.enemy`, s.enemy, 'enemies');
      if (s.t === 'items') ref(`${f}.item`, s.item, 'items');
    });
    m.pay.forEach((p, n) => {
      if (p.kind === 'item') ref(`pay[${n}].item`, p.item, 'items');
      if (p.kind === 'scrollPart') ref(`pay[${n}].technique`, p.technique, 'techniques');
    });
    if (m.resource !== null) ref('resource', m.resource, 'resources');
    if (m.resourceMod !== null && !Object.hasOwn(db.modifierKeys, m.resourceMod))
      problem('resourceMod', `unknown modifier key "${m.resourceMod}"`);
  }
  for (const t of db.team) {
    at('team', t.id);
    refs('skills', t.skills, 'skills');
  }
  for (const r of db.regions) {
    at('regions', r.id);
    refs('cells', r.cells, 'cells');
  }
  for (const c of db.cells) {
    at('cells', c.id);
    ref('region', c.region, 'regions');
    if (c.key !== null) ref('key', c.key, 'cellKeys');
    c.pois.forEach((p, n) => {
      const f = `pois[${n}]`;
      if (p.kind === 'training') ref(`${f}.skill`, p.skill, 'skills');
      if (p.kind === 'zone') ref(`${f}.zone`, p.zone, 'zones');
      if (p.kind === 'deposit') ref(`${f}.building`, p.building, 'buildings');
      if (p.kind === 'cache')
        p.items.forEach((x, k) => ref(`${f}.items[${k}].item`, x.item, 'items'));
      if (p.kind === 'vault') ref(`${f}.item`, p.item, 'items');
      if (p.kind === 'mission') ref(`${f}.mission`, p.mission, 'missions');
    });
  }
  for (const list of ['enemies', 'bosses'] as const) {
    for (const e of db[list]) {
      at(list, e.id);
      if (list === 'enemies') ref('region', (e as { region: string }).region, 'fightRegions');
      refs('traits', e.traits, 'traits');
      if (e.nature !== null) ref('nature', e.nature, 'natures', ['wheel']);
      if (e.carries !== null) ref('carries', e.carries, 'techniques');
      ref('style', e.style, 'styles');
      e.drops.forEach((d, n) => ref(`drops[${n}].item`, d.item, 'items'));
      if (e.scrollPart) {
        ref('scrollPart.item', e.scrollPart.item, 'items');
        ref('scrollPart.technique', e.scrollPart.technique, 'techniques');
      }
    }
  }
  for (const b of db.bosses) {
    at('bosses', b.id);
    needNumber('special.fx', `bossFx.${b.special.fx}`);
  }
  for (const b of db.buildings) {
    at('buildings', b.id);
    for (const res of b.produces) ref('produces', res, 'resources');
    for (const res of Object.keys(b.tier6 ?? {})) ref('tier6', res, 'resources');
  }
  for (const g of db.gear) {
    at('gear', g.id);
    ref('skill', g.skill, 'skills');
    g.tiers.forEach((t, n) => {
      if (t.building) ref(`tiers[${n}].building.id`, t.building.id, 'buildings');
    });
    ref('fx.perTier', g.fx.perTier, 'gearFx');
    if (!Object.hasOwn(db.modifierKeys, g.fx.key))
      problem('fx.key', `unknown modifier key "${g.fx.key}"`);
  }

  // ----- quests, exams, zones, operations -----
  for (const q of db.quests) {
    at('quests', q.id);
    ref('chain', q.chain, 'quests');
    req('unlock', q.unlock);
    q.steps.forEach((s, n) => {
      if (s.objective.t === 'req') req(`steps[${n}].objective.req`, s.objective.req);
    });
    q.rewards.items.forEach((x, n) => ref(`rewards.items[${n}].item`, x.item, 'items'));
    if (q.rewards.rank !== null) ref('rewards.rank', q.rewards.rank, 'ranks');
    for (const id of Object.keys(q.rewards.currencies ?? {}))
      ref('rewards.currencies', id, 'currencies');
  }
  for (const e of db.exams) {
    at('exams', e.id);
    ref('rank', e.rank, 'ranks');
    req('checklist', e.checklist);
    refs('reduceBy', e.reduceBy, 'skills');
    e.rewards.items.forEach((x, n) => ref(`rewards.items[${n}].item`, x.item, 'items'));
    if (e.rewards.goal) ref('rewards.goal.kind', e.rewards.goal.kind, 'entityKinds');
  }
  for (const z of db.zones) {
    at('zones', z.id);
    ref('enemy', z.enemy, 'enemies');
    ref('region', z.region, 'fightRegions');
    req('unlock', z.unlock);
  }
  for (const o of db.operations) {
    at('operations', o.id);
    for (const which of ['first', 'repeat'] as const)
      o.rewards?.[which].parts.forEach((p, n) => {
        ref(`rewards.${which}.parts[${n}].technique`, p.technique, 'techniques');
        needNumber(`rewards.${which}.parts[${n}].chance`, `partDrop.${p.chance}`);
      });
    req('unlock', o.unlock);
    o.stages.forEach((s, n) => {
      if (s.t === 'approach') req(`stages[${n}].shortenedBy`, s.shortenedBy);
      if (s.t === 'fight') ref(`stages[${n}].enemy`, s.enemy, 'enemies');
      if (s.t === 'days') {
        refs(`stages[${n}].pool`, s.pool, 'enemies');
        ref(`stages[${n}].finale`, s.finale, 'enemies');
      }
    });
  }

  // ----- texts -----
  for (const [list, kind] of Object.entries(options.described)) {
    for (const e of (db as unknown as Record<string, { id: string }[]>)[list] ?? []) {
      for (const field of ['name', 'desc']) {
        const key = `${kind}.${e.id}.${field}`;
        if (!db.locales.uk[key]) {
          at(list, e.id);
          problem('locale', `missing locale key ${key}`);
        }
      }
    }
  }
  // ----- modifiers everywhere -----
  // Every list of the database is scanned (derived from the database itself, so a list that a later
  // task adds cannot be forgotten); only the balance object and what composeContent adds are not.
  const NOT_SCANNED = new Set(['balance', 'packs', 'modifierKeys', 'icons', 'locales']);
  for (const [list, value] of Object.entries(db)) {
    if (NOT_SCANNED.has(list)) continue;
    if (Array.isArray(value)) {
      (value as Record<string, unknown>[]).forEach((e, n) => {
        at(list, String(e.id ?? e.item ?? e.product ?? n));
        scanMods(e, '');
      });
    } else if (value !== null && typeof value === 'object') {
      for (const [key, e] of Object.entries(value)) {
        at(list, key);
        scanMods(e, '');
      }
    }
  }

  // ----- icons: each one belongs to an entity of the kind -----
  const iconLists: Record<string, string> = {
    status: 'statuses',
    trait: 'traits',
    nature: 'natures',
    currency: 'currencies',
    ...Object.fromEntries(
      db.entityKinds.filter((k) => k.list !== null).map((k) => [k.id, k.list as string]),
    ),
  };
  for (const [kind, table] of Object.entries(db.icons)) {
    for (const id of Object.keys(table)) {
      const pack = options.iconOwner(kind, id);
      const list = iconLists[kind];
      const known =
        list !== undefined &&
        ((db as unknown as Record<string, { id: string }[]>)[list] ?? []).some((e) => e.id === id);
      // The pack core keeps an icon for the Shield trait, which is out of the slice and has no entity.
      if (!known && pack !== 'core')
        problems.push({ pack, message: `icon ${kind} "${id}" names no entity of that kind` });
    }
  }
  return problems;
}
