/**
 * The closure validator of a composed database: every reference to a vocabulary member or an
 * entity must name something the composed packs define, every number a vocabulary member needs must
 * exist in the balance object, and every modifier key must be a key of the composed database.
 * Each problem names the pack that owns the entity holding the dangling reference.
 */
import type { ContentDb, Req, RevealRule, RevealTerm, Payout } from './schema.ts';
import type { EntityListKey } from './pack.ts';

/** The effects the engine and the core hooks put on a body under their own ids (not statuses): a tag or a trait may name them. */
const ENGINE_EFFECTS: ReadonlySet<string> = new Set([
  'illusion',
  'revealed',
  'twinMist',
  'stance',
  'stanceDrain',
  'resist',
]);

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
    currencies: ids(db.currencies),
    trophies: ids(db.trophies),
    gearFx: ids(db.gearFx),
    terrains: ids(db.terrains),
    countries: ids(db.countries),
    entityKinds: ids(db.entityKinds),
    cellKeys: new Set(Object.keys(db.cellKeys)),
    items: ids(db.items),
    techniques: ids(db.techniques),
    enemies: ids([...db.enemies, ...db.bosses]),
    buildings: ids(db.buildings),
    stages: ids(db.villageStages),
    quests: ids(db.quests),
    zones: ids(db.zones),
    missions: ids(db.missions),
    seals: ids(db.seals),
    cells: ids(db.cells),
    regions: ids(db.regions),
    resources: ids(db.resources),
    aiTiers: ids(db.ai.tiers),
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
      case 'currency':
        if (!db.currencies.some((x) => x.role === r.role))
          problem(`${field}.role`, `no currency has the role "${r.role}"`);
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
      if (!Number.isFinite(o.value) || (o.op === 'mul' && o.value <= 0))
        problem(
          `${path}.value`,
          `the modifier value ${String(o.value)} is not a finite number (and above 0 for a mul)`,
        );
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
  for (const role of ['money', 'renown', 'study'] as const) {
    if (!db.currencies.some((c) => c.role === role)) {
      at('currencies', role);
      problem('role', `no currency has the role ${role}`);
    }
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
  /** A number reference of fight data: a path of the balance object, or one minus a path; a literal needs no check. */
  const numRef = (field: string, r: unknown): void => {
    if (typeof r === 'string') needNumber(field, r);
    else if (r !== null && typeof r === 'object') needNumber(field, (r as { path: string }).path);
  };
  const tagOps = (
    field: string,
    ops: readonly { op: string; status?: string; value?: unknown }[] | undefined,
  ) =>
    (ops ?? []).forEach((o, i) => {
      if (o.op === 'effect') body(`${field}[${i}].`, o as Parameters<typeof body>[1]);
      if (o.op !== 'status') return;
      ref(`${field}[${i}].status`, o.status, 'statuses');
      if (o.value !== undefined) numRef(`${field}[${i}].value`, o.value);
    });
  const body = (
    field: string,
    st: {
      effects?: readonly (
        { kind: 'modifier'; value: unknown } | { kind: 'periodic'; amount: unknown; over?: unknown }
      )[];
      duration?: unknown;
    },
  ): void => {
    for (const [n, e] of (st.effects ?? []).entries()) {
      if (e.kind === 'modifier') numRef(`${field}effects[${n}].value`, e.value);
      else {
        numRef(`${field}effects[${n}].amount`, e.amount);
        if (e.over !== undefined) numRef(`${field}effects[${n}].over`, e.over);
      }
    }
    const d = st.duration;
    if (d !== undefined) {
      if (typeof d === 'object' && d !== null && 'byRank' in d)
        needNumber(`${field}duration.byRank`, (d as { byRank: string }).byRank);
      else numRef(`${field}duration`, d);
    }
    if (st.effects !== undefined && d === undefined)
      problem(`${field}duration`, 'a status with effects needs a duration');
  };
  for (const st of db.statuses) {
    at('statuses', st.id);
    if (st.state !== undefined) ref('state', st.state, 'states');
    body('', st);
  }
  /** Every id an effect goes by in a fight and that data can name: statuses, effects a tag defines, traits. */
  const effectIds = new Set<string>([...set.statuses, ...set.traits]);
  for (const tag of db.tags)
    for (const op of [...(tag.onHit ?? []), ...(tag.onUse ?? [])])
      if (op.op === 'effect') effectIds.add(op.id);
  /** A reference of fight data to an effect or trait: one of another pack must exist; the engine's and the core's own effects are bare. */
  const effectRef = (field: string, value: string): void => {
    if (!effectIds.has(value) && !ENGINE_EFFECTS.has(value))
      problem(field, `"${value}" names no status, effect or trait`);
  };
  for (const st of db.statuses) {
    at('statuses', st.id);
    if (st.suppresses !== undefined) effectRef('suppresses', st.suppresses);
  }
  for (const tag of db.tags) {
    at('tags', tag.id);
    for (const id of tag.removes ?? []) effectRef('removes', id);
    for (const op of [...(tag.onHit ?? []), ...(tag.onUse ?? [])])
      if (op.op === 'effect' && op.suppresses !== undefined) effectRef('suppresses', op.suppresses);
    tagOps('onHit', tag.onHit);
    tagOps('onUse', tag.onUse);
  }
  for (const c of db.combos) {
    at('combos', c.id);
    if (c.nature !== undefined) ref('nature', c.nature, 'natures');
    if (c.tag !== undefined) ref('tag', c.tag, 'tags');
    if (c.nature === undefined && c.tag === undefined)
      problem('nature', 'a combo needs a nature or a tag to be triggered by');
    ref('onState', c.onState, 'states');
    if (c.effect.status !== undefined) ref('effect.status', c.effect.status, 'statuses');
    if (c.effect.kind === 'status' && c.effect.status === undefined)
      problem('effect.status', 'a status combo names its status');
    needNumber('combo', `combo.${c.id}`);
  }
  // Exactly one role of the clones is the default: the fight falls back to it.
  const defaults = db.cloneRoles.filter((r) => r.default === true);
  if (db.cloneRoles.length > 0 && defaults.length === 0) {
    at('cloneRoles', db.cloneRoles[0]?.id ?? '');
    problem('default', 'no clone role is the default');
  }
  for (const r of defaults.slice(1)) {
    at('cloneRoles', r.id);
    problem('default', `a second default clone role (the first is ${defaults[0]?.id ?? ''})`);
  }
  for (const t of db.traits) {
    at('traits', t.id);
    ref('answer', t.answer, 'tags');
    for (const key of t.numbers.keys) needNumber('numbers', `${t.numbers.from}.${key}`);
    (t.mods ?? []).forEach((m, i) => numRef(`mods[${i}].value`, m.value));
    for (const id of t.inflicts ?? []) effectRef('inflicts', id);
    if (t.swarm !== undefined)
      for (const key of ['n', 'hp', 'dmg']) needNumber('swarm', `${t.swarm}.${key}`);
    if (t.regen !== undefined) numRef('regen', t.regen);
  }
  for (const id of Object.keys(
    (db.balance.K as { ai: { enemyTier: Record<string, number> } }).ai.enemyTier,
  )) {
    at('ai', id);
    ref('K.ai.enemyTier', id, 'aiTiers');
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
      // The name of the bodies a summon makes is a localisation key: a missing text would show a key in a fight.
      if (fx.kind === 'summon' && fx.allyName !== undefined && !db.locales.uk[fx.allyName])
        problem('combat.effect.allyName', `missing locale key ${fx.allyName}`);
      // A defensive technique adds by a row of `K.passiveFx`: a key without a row would stop every fight of the player.
      if (t.combat.passive)
        needNumber('combat.passive.fx', `passiveFx.${t.combat.passive.fx}.evasion`);
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
  // ----- the hex grid -----
  const hexAt = new Map(db.hexes.map((h) => [`${h.q},${h.r}`, h]));
  const terrainOf = new Map(db.terrains.map((x) => [x.id, x]));
  for (const x of db.terrains) {
    at('terrains', x.id);
    needNumber('map.terrain', `map.terrain.${x.id}`);
    x.finds?.drops.forEach((d, n) => ref(`finds.drops[${n}].item`, d.item, 'items'));
  }
  for (const h of db.hexes) {
    at('hexes', `${h.q},${h.r}`);
    if (h.country !== undefined) ref('country', h.country, 'countries');
    if (h.terrain !== undefined) ref('terrain', h.terrain, 'terrains');
    if (h.terrain !== undefined && h.country === undefined)
      problem('terrain', 'a playable hex belongs to a country');
  }
  /** A hex a cell or a place can stand on: it exists, it is playable and it can be entered. */
  const standable = (field: string, hex: readonly [number, number]) => {
    const h = hexAt.get(`${hex[0]},${hex[1]}`);
    if (!h) return problem(field, `the hex ${hex[0]},${hex[1]} is not on the map`);
    const kind = h.terrain === undefined ? undefined : terrainOf.get(h.terrain);
    if (!kind) return problem(field, `the hex ${hex[0]},${hex[1]} is not playable`);
    if (kind.blocked === true) problem(field, `the hex ${hex[0]},${hex[1]} cannot be entered`);
  };
  const cellAt = new Map<string, string>();
  for (const c of db.cells) {
    at('cells', c.id);
    standable('hex', c.hex);
    const where = `${c.hex[0]},${c.hex[1]}`;
    const other = cellAt.get(where);
    if (other !== undefined) problem('hex', `the hex ${where} also holds the cell "${other}"`);
    else cellAt.set(where, c.id);
  }
  const placeOf = new Map(db.places.map((x) => [x.id, x]));
  /** The things a payout names exist. */
  const payout = (field: string, pay: Payout): void => {
    pay.items?.forEach((i, n) => ref(`${field}.items[${n}].item`, i.item, 'items'));
    for (const id of Object.keys(pay.currencies ?? {}))
      ref(`${field}.currencies.${id}`, id, 'currencies');
    if (pay.xp) ref(`${field}.xp.skill`, pay.xp.skill, 'skills');
  };
  const groups = new Map<string, number>();
  for (const p of db.places) {
    at('places', p.id);
    standable('hex', p.hex);
    if (p.rare) payout('rare.payout', p.rare.payout);
    if (!p.point) continue;
    payout('point.reward', p.point.reward);
    req('point.needs', p.point.needs);
    if (p.point.needs && !Object.hasOwn(db.locales.uk, `place.${p.id}.hint`))
      problem('point.needs', `the locale key place.${p.id}.hint (the vague hint) is missing`);
    const by = p.point.revealedBy?.point;
    if (by !== undefined) {
      if (by === p.id) problem('point.revealedBy.point', 'a point cannot reveal itself');
      else if (!placeOf.get(by)?.point)
        problem('point.revealedBy.point', `"${by}" is not a place with a point of interest`);
    }
    if (p.point.travel !== undefined)
      groups.set(p.point.travel, (groups.get(p.point.travel) ?? 0) + 1);
  }
  // A chain of reveals that ends in itself can never be opened.
  for (const p of db.places) {
    const seen = new Set<string>();
    for (let at2: string | undefined = p.id; at2 !== undefined;) {
      if (seen.has(at2)) {
        at('places', p.id);
        problem('point.revealedBy.point', 'the points reveal one another in a circle');
        break;
      }
      seen.add(at2);
      at2 = placeOf.get(at2)?.point?.revealedBy?.point;
    }
  }
  for (const [group, n] of groups) {
    if (n < 2) {
      at('places', group);
      problem('point.travel', `the travel group "${group}" has one point: there is nowhere to go`);
    }
  }
  for (const w of db.fieldworks) {
    at('fieldworks', w.id);
    if (!placeOf.get(w.point)?.point)
      problem('point', `"${w.point}" is not a place with a point of interest`);
    if (w.skill !== undefined) ref('skill', w.skill, 'skills');
    else if (!db.skills.some((x) => x.activity === 'map'))
      problem('skill', 'no skill has the activity map');
    w.drops.forEach((d, n) => payout(`drops[${n}].payout`, d.payout));
  }
  needNumber('map.walk', 'map.walk');
  needNumber('map.travel', 'map.travel');
  db.balance.K.map.mastery.forEach((tier, n) => {
    at('balance', `map.mastery[${n}]`);
    scanMods(tier.mods, 'mods');
  });
  const linked = new Set<string>();
  for (const l of db.links) {
    at('links', l.id);
    standable('a', l.a);
    standable('b', l.b);
    const dq = l.a[0] - l.b[0];
    const dr = l.a[1] - l.b[1];
    const steps = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    if (steps === 0) problem('b', 'a link joins two different hexes');
    else if (steps === 1)
      problem('b', 'a link joins hexes that are not neighbours: those are joined already');
    const pair = [`${l.a[0]},${l.a[1]}`, `${l.b[0]},${l.b[1]}`].sort().join('|');
    if (linked.has(pair)) problem('b', 'another link joins the same two hexes');
    linked.add(pair);
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
  for (const role of ['money', 'renown', 'study'] as const) {
    if (!db.currencies.some((c) => c.role === role)) {
      at('currencies', role);
      problem('role', `no currency has the role ${role}`);
    }
  }
  for (const op of db.operations) {
    at('operations', op.id);
    for (const pay of op.rewards ? [op.rewards.first, op.rewards.repeat] : []) {
      if (pay.currency !== undefined) ref('rewards.currency', pay.currency, 'currencies');
      if (pay.repCurrency !== undefined) ref('rewards.repCurrency', pay.repCurrency, 'currencies');
    }
  }
  for (const list of ['enemies', 'bosses'] as const) {
    for (const e of db[list]) {
      at(list, e.id);
      if (e.currency !== undefined) ref('currency', e.currency, 'currencies');
      if (list === 'enemies') ref('region', (e as { region: string }).region, 'fightRegions');
      refs('traits', e.traits, 'traits');
      if (e.nature !== null) ref('nature', e.nature, 'natures', ['wheel']);
      if (e.carries !== null) ref('carries', e.carries, 'techniques');
      ref('style', e.style, 'styles');
      if (e.aiTier !== undefined && e.aiTier !== null) ref('aiTier', e.aiTier, 'aiTiers');
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
    for (const key of b.special.numbers ?? [])
      needNumber('special.numbers', `bossFx.${b.special.fx}.${key}`);
    if (b.special.companions)
      needNumber('special.companions.fx', `bossFx.${b.special.companions.fx}`);
    refs('special.adds', b.special.adds ?? [], 'traits');
    if (b.special.fleeAt !== undefined) {
      const row = (db.balance.K.bossFx as Record<string, Record<string, number> | undefined>)[
        b.special.fx
      ];
      const share = row?.[b.special.fleeAt];
      if (typeof share !== 'number' || share < 0 || share > 1)
        problem(
          'special.fleeAt',
          `bossFx.${b.special.fx}.${b.special.fleeAt} must be a share from 0 to 1`,
        );
    }
  }
  for (const b of db.buildings) {
    at('buildings', b.id);
    for (const res of b.produces) ref('produces', res, 'resources');
    for (const res of Object.keys(b.tier6 ?? {})) ref('tier6', res, 'resources');
    if (b.stage !== undefined) ref('stage', b.stage, 'stages');
  }
  for (const cell of db.cells) {
    at('cells', cell.id);
    for (const poi of cell.pois) {
      if (poi.kind === 'cache')
        for (const id of Object.keys(poi.currencies ?? {}))
          ref('pois.currencies', id, 'currencies');
    }
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
      if (
        s.objective.t === 'pay' &&
        !db.currencies.some((x) => x.role === (s.objective as { role: string }).role)
      )
        problem(`steps[${n}].objective.role`, `no currency has the role "${s.objective.role}"`);
      s.grants?.forEach((x, g) => ref(`steps[${n}].grants[${g}].item`, x.item, 'items'));
    });
    q.rewards.items.forEach((x, n) => ref(`rewards.items[${n}].item`, x.item, 'items'));
    if (q.rewards.rank !== null) ref('rewards.rank', q.rewards.rank, 'ranks');
    if (q.rewards.goal) ref('rewards.goal.kind', q.rewards.goal.kind, 'entityKinds');
    for (const id of Object.keys(q.rewards.currencies ?? {}))
      ref('rewards.currencies', id, 'currencies');
  }
  for (const m of db.missions) {
    at('missions', m.id);
    m.pay.forEach((p, n) => {
      if (p.kind === 'scrollPart') needNumber(`pay[${n}].chance`, `partDrop.${p.chance}`);
      if (p.kind === 'currency') ref(`pay[${n}].currency`, p.currency, 'currencies');
    });
  }
  for (const e of db.exercises) {
    at('exercises', e.id);
    if (e.skill !== undefined) ref('skill', e.skill, 'skills');
  }
  for (const p of db.practices) {
    at('practices', p.id);
    if (p.skill !== undefined) ref('skill', p.skill, 'skills');
  }
  for (const h of db.herbs) {
    at('herbs', h.id);
    if (h.skill !== undefined) ref('skill', h.skill, 'skills');
  }
  for (const stage of db.villageStages) {
    at('villageStages', stage.id);
    const top = db.balance.K.costMult.length;
    if (stage.cap !== undefined && stage.cap > top)
      problem('cap', `${stage.cap} is above the highest building level ${top}`);
  }
  for (const e of db.exams) {
    at('exams', e.id);
    ref('rank', e.rank, 'ranks');
    req('checklist', e.checklist);
    req('then', e.then);
    refs('reduceBy', e.reduceBy, 'skills');
    e.rewards.items.forEach((x, n) => ref(`rewards.items[${n}].item`, x.item, 'items'));
    if (e.rewards.goal) ref('rewards.goal.kind', e.rewards.goal.kind, 'entityKinds');
  }
  for (const r of db.renownRanks) {
    at('renownRanks', r.id);
    r.rewards.items.forEach((x, n) => ref(`rewards.items[${n}].item`, x.item, 'items'));
    r.rewards.opens.forEach((x, n) => ref(`rewards.opens[${n}].kind`, x.kind, 'entityKinds'));
  }
  for (const z of db.zones) {
    at('zones', z.id);
    ref('enemy', z.enemy, 'enemies');
    ref('region', z.region, 'fightRegions');
    req('unlock', z.unlock);
  }
  for (const r of db.raids) {
    at('raids', r.id);
    req('trigger', r.trigger);
    ref('enemy', r.enemy, 'enemies');
    r.defence.forEach((d, n) =>
      ref(`defence[${n}].id`, d.id, d.t === 'building' ? 'buildings' : 'resources'),
    );
    refs('targets', r.targets, 'buildings');
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
  // ----- reveal rules: terms that fit the kind, requirement trees that close -----
  const revealTermApplies = (term: RevealTerm, list: string | null, kind: string): boolean => {
    if (typeof term !== 'string') return true;
    switch (term) {
      case 'encountered':
        return list === 'enemies' || list === 'bosses';
      case 'questStarted':
        return list === 'quests';
      case 'explored':
        return list === 'cells' || list === 'regions' || kind === 'poi';
      case 'adjacent':
      case 'actionable':
        return list === 'regions';
      case 'parent':
        return list === 'cells' || kind === 'poi';
      default:
        return true;
    }
  };
  const checkReveal = (
    field: string,
    rule: RevealRule,
    list: string | null,
    kind: string,
  ): void => {
    for (const part of ['name', 'full'] as const) {
      (rule[part] ?? []).forEach((term, i) => {
        if (typeof term !== 'string') req(`${field}.${part}[${i}].req`, term.req);
        else if (!revealTermApplies(term, list, kind))
          problem(
            `${field}.${part}[${i}]`,
            `the term "${term}" does not apply to the kind "${kind}"`,
          );
      });
    }
  };
  for (const k of db.entityKinds) {
    if (k.reveal) {
      at('entityKinds', k.id);
      checkReveal('reveal', k.reveal, k.list, k.id);
    }
    const entities =
      k.list === null
        ? []
        : ((db as unknown as Plain)[k.list] as { id: string; reveal?: RevealRule }[]);
    for (const e of entities) {
      if (!e.reveal) continue;
      at(k.list as string, e.id);
      checkReveal('reveal', e.reveal, k.list, k.id);
    }
    if (k.id === 'poi') {
      for (const cell of db.cells) {
        for (const poi of cell.pois) {
          if (!poi.reveal) continue;
          at('cells', cell.id);
          checkReveal('reveal', poi.reveal, null, 'poi');
        }
      }
    }
  }
  for (const manifest of db.packs) {
    for (const [kindId, rule] of Object.entries(manifest.reveal ?? {})) {
      const k = db.entityKinds.find((x) => x.id === kindId);
      if (!k) {
        problems.push({
          pack: manifest.id,
          message: `manifest reveal: "${kindId}" is not a known entity kind`,
        });
        continue;
      }
      at('entityKinds', k.id);
      const before = problems.length;
      checkReveal(`manifest reveal.${kindId}`, rule, k.list, k.id);
      // The problem belongs to the pack whose manifest holds the rule, not to the owner of the kind.
      for (let i = before; i < problems.length; i++) {
        const p = problems[i];
        if (p) p.pack = manifest.id;
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
