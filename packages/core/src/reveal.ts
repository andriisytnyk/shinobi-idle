import type { ContentDb, Region, RevealRule, RevealTerm } from '@shinobi/content';
import { bingoLevel } from './combat/bingo.ts';
import { defeatsKey, killsKey } from './counters.ts';
import type { CommandResult } from './engine.ts';
import type { EntityRef } from './entity.ts';
import { indexOf, shopEntries } from './lookup.ts';
import { evalReq, type Req } from './requirements.ts';
import { defaultRules, type Rules } from './rules.ts';
import { buyPrice } from './shop.ts';
import { addShown } from './shown.ts';
import type { GameState } from './state.ts';
import { cellLevel, isRegionOpen, regionHere } from './world.ts';

/*
 * The reveal rule: how much of an entity the player may see. `full`: everything. `name`: the name
 * and icon, but no description, numbers or links. `hidden`: nothing (the interface shows «???»).
 * The rule is data: a kind of entity has a default (`entityKinds[].reveal`), a pack may set its own
 * by kind (`manifest.reveal`) and an entity may carry its own (`entity.reveal`), in that order of
 * strength. The terms the rules are made of are the engine's vocabulary (`REVEAL_TERMS`).
 */

/** How much of an entity may be shown. */
export type RevealLevel = 'full' | 'name' | 'hidden';

/** Most references one `reveal.mark` carries. */
export const MARK_MAX_REFS = 64;

/** One entity of the content as the reveal rule sees it. */
interface Entry {
  ref: EntityRef;
  /** The list of the content the entity lives in; null for a point of interest (nested in a cell). */
  list: string | null;
  data: Record<string, unknown>;
  pack: string;
}

/** Something that names an entity in what it shows: an entity, a fight zone, an operation or the shop. */
type Owner =
  | {
      t: 'entity';
      ref: EntityRef;
      /** The quest step the mention is on; 0 for everything else. */ gate: number;
    }
  | { t: 'zone'; id: string }
  | { t: 'operation'; id: string }
  | { t: 'shop'; item: string }
  /** A record of the content that is no entity (a coat, with its poison, base and product) and names several; one of the others that is fully shown names this one. */
  | { t: 'group'; others: string[] }
  /** The mission board, which offers every mission that is on it. */
  | { t: 'board' }
  /** What the map gives: the reward of a point of interest and the rare find of a place (named once the point is found), or the finds of a terrain (`place` is null: only held, they name nothing). */
  | { t: 'find'; place: string | null };

interface Catalog {
  entries: Map<string, Entry>;
  /** The kinds each id is an entity of. */
  kindsOf: Map<string, string[]>;
  owners: Map<string, Owner[]>;
  kindRule: Map<string, RevealRule>;
  packRule: Map<string, Map<string, RevealRule>>;
  /** The position of each region in the list, to find the neighbours. */
  regionAt: Map<string, number>;
}

const keyOf = (ref: EntityRef): string => `${ref.kind}:${ref.id}`;

/**
 * The key of an entity in `state.shown`: its id and its kind, so that a seal and an enemy that
 * share an id are two entries. The id comes first, so that the pack prefix still tells the owner.
 */
export const shownKey = (ref: EntityRef): string => `${ref.id}@${ref.kind}`;
const packOf = (id: string): string => (id.includes(':') ? id.slice(0, id.indexOf(':')) : 'core');

const catalogs = new WeakMap<ContentDb, Catalog>();

function catalogOf(content: ContentDb): Catalog {
  const cached = catalogs.get(content);
  if (cached) return cached;
  const entries = new Map<string, Entry>();
  const kindsOf = new Map<string, string[]>();
  const add = (kind: string, list: string | null, data: { id: string }): void => {
    const ref = { kind, id: data.id };
    entries.set(keyOf(ref), {
      ref,
      list,
      data: data as unknown as Record<string, unknown>,
      pack: packOf(data.id),
    });
    kindsOf.set(data.id, [...(kindsOf.get(data.id) ?? []), kind]);
  };
  const lists = content as unknown as Record<string, readonly { id: string }[] | undefined>;
  const kindRule = new Map<string, RevealRule>();
  for (const kind of content.entityKinds) {
    if (kind.reveal) kindRule.set(kind.id, kind.reveal);
    if (kind.list !== null) for (const e of lists[kind.list] ?? []) add(kind.id, kind.list, e);
  }
  if (content.entityKinds.some((k) => k.id === 'poi')) {
    for (const cell of content.cells) for (const poi of cell.pois) add('poi', null, poi);
  }
  const packRule = new Map<string, Map<string, RevealRule>>();
  for (const manifest of content.packs) {
    if (manifest.reveal) packRule.set(manifest.id, new Map(Object.entries(manifest.reveal)));
  }

  const owners = new Map<string, Owner[]>();
  const kindFits = (kind: string, field: string): boolean => {
    const list = content.entityKinds.find((k) => k.id === kind)?.list;
    return field === kind || field === list || field === `${kind}s`;
  };
  /** An id that two kinds share (a hand seal and an enemy) belongs to the kind that the name of its field says. */
  const link = (target: string, owner: Owner, field = ''): void => {
    const kinds = kindsOf.get(target) ?? [];
    for (const kind of kinds.length > 1 ? kinds.filter((k) => kindFits(k, field)) : kinds) {
      const key = `${kind}:${target}`;
      const list = owners.get(key) ?? [];
      list.push(owner);
      owners.set(key, list);
    }
  };
  /** Every id inside the data that is an entity of the content, once each, with the name of the field that holds it. The `id` of the record itself is not a mention; a nested `id` (a requirement node `{ t: 'item', id }`) is, and its `t` names the kind. */
  const idsIn = (value: unknown, skip: string): [string, string][] => {
    const found = new Map<string, string>();
    // The whole record is walked, however deep a requirement tree goes; a node met twice is not entered again.
    const entered = new Set<object>();
    const walk = (v: unknown, atRoot: boolean, field: string): void => {
      if (typeof v === 'string') {
        // A kill counter (`kills.<enemy>`) names the enemy it counts.
        const counted = [killsKey(''), defeatsKey('')].find((prefix) => v.startsWith(prefix));
        const target = counted === undefined ? v : v.slice(counted.length);
        if (counted !== undefined && kindsOf.has(target) && !found.has(target)) {
          found.set(target, 'enemy');
        }
        if (kindsOf.has(v) && !found.has(v) && (v !== skip || (kindsOf.get(v)?.length ?? 0) > 1)) {
          found.set(v, field);
        }
      } else if (Array.isArray(v)) {
        if (entered.has(v)) return;
        entered.add(v);
        for (const item of v) walk(item, false, field);
      } else if (v !== null && typeof v === 'object') {
        if (entered.has(v)) return;
        entered.add(v);
        const node = v as Record<string, unknown>;
        const kindName = typeof node.t === 'string' ? node.t : null;
        for (const [k, item] of Object.entries(node)) {
          if (k === 'reveal' || (k === 'id' && atRoot)) continue;
          walk(item, false, k === 'id' && kindName !== null ? kindName : k);
        }
      }
    };
    walk(value, true, '');
    return [...found];
  };
  for (const entry of entries.values()) {
    const owner = (gate: number): Owner => ({ t: 'entity', ref: entry.ref, gate });
    if (entry.list === 'quests') {
      const { steps, ...rest } = entry.data as { steps?: unknown[] } & Record<string, unknown>;
      for (const [id, field] of idsIn(rest, entry.ref.id)) link(id, owner(0), field);
      (steps ?? []).forEach((step, i) => {
        for (const [id, field] of idsIn(step, entry.ref.id)) link(id, owner(i), field);
      });
    } else {
      for (const [id, field] of idsIn(entry.data, entry.ref.id)) link(id, owner(0), field);
    }
  }
  // A skill's page lists its actions (recipes, techniques, gear): an entity that names its skill is offered by it.
  for (const entry of entries.values()) {
    const skill = entry.data.skill;
    if (typeof skill === 'string' && entries.has(`skill:${skill}`)) {
      link(
        entry.ref.id,
        { t: 'entity', ref: { kind: 'skill', id: skill }, gate: 0 },
        entry.ref.kind,
      );
    }
  }
  // The scroll of a technique and its parts name the technique; the page of the technique lists them.
  for (const entry of entries.values()) {
    if (entry.ref.kind !== 'item') continue;
    for (const [id] of idsIn(entry.data, entry.ref.id)) {
      for (const kind of kindsOf.get(id) ?? []) {
        if (kind === 'technique') {
          link(entry.ref.id, { t: 'entity', ref: { kind, id }, gate: 0 }, 'item');
        }
      }
    }
  }
  // The herbs are items that the patch skill gathers; its page lists them.
  const patchSkill = indexOf(content).activitySkill.get('patch');
  for (const herb of content.herbs) {
    const skill = herb.skill ?? patchSkill;
    if (skill !== undefined && entries.has(`skill:${skill}`)) {
      link(herb.id, { t: 'entity', ref: { kind: 'skill', id: skill }, gate: 0 }, 'item');
    }
  }
  // Records that are no entities (the coats of poisons, the market) name entities together: each is named by the others.
  const entityLists = new Set(content.entityKinds.map((k) => k.list));
  const handled = new Set(['zones', 'operations', 'shop', 'packs']);
  for (const [name, value] of Object.entries(content)) {
    if (!Array.isArray(value) || entityLists.has(name) || handled.has(name)) continue;
    for (const record of value as unknown[]) {
      const ids = idsIn(record, '').map(([id]) => id);
      if (ids.length < 2) continue;
      for (const id of ids) {
        for (const kind of kindsOf.get(id) ?? []) {
          const key = `${kind}:${id}`;
          const list = owners.get(key) ?? [];
          list.push({ t: 'group', others: ids.filter((other) => other !== id) });
          owners.set(key, list);
        }
      }
    }
  }
  // What the map gives is named by the place that gives it; the finds of a terrain by nothing (they are shown when held).
  for (const place of content.places) {
    for (const [id, field] of idsIn({ point: place.point, rare: place.rare }, ''))
      link(id, { t: 'find', place: place.id }, field);
  }
  for (const terrain of content.terrains)
    for (const [id, field] of idsIn(terrain.finds, '')) link(id, { t: 'find', place: null }, field);
  for (const zone of content.zones) link(zone.enemy, { t: 'zone', id: zone.id }, 'enemy');
  for (const op of content.operations) {
    // An operation is on the missions list under its own id; its stages name the fights it holds.
    link(op.id, { t: 'operation', id: op.id }, 'mission');
    for (const [id, field] of idsIn(op.stages, '')) link(id, { t: 'operation', id: op.id }, field);
  }
  for (const mission of content.missions) {
    if (mission.board) link(mission.id, { t: 'board' }, 'mission');
  }
  for (const entry of shopEntries(content)) {
    // The row names its good and what opens it (a building level).
    for (const [id, field] of idsIn(entry, '')) {
      link(id, { t: 'shop', item: entry.item }, field);
    }
  }

  const made: Catalog = {
    entries,
    kindsOf,
    owners,
    kindRule,
    packRule,
    regionAt: new Map(content.regions.map((r, i) => [r.id, i])),
  };
  catalogs.set(content, made);
  return made;
}

/** The rule that governs an entity: its own, else its pack's for the kind, else the kind's; none means always shown. */
function ruleOf(entry: Entry, catalog: Catalog): RevealRule | null {
  const own = entry.data.reveal as RevealRule | undefined;
  return (
    own ??
    catalog.packRule.get(entry.pack)?.get(entry.ref.kind) ??
    catalog.kindRule.get(entry.ref.kind) ??
    null
  );
}

/** The requirement an entity carries to be opened or started: its `unlockReq`, `unlock` or `req`; none when it has no such field. */
function unlockReqOf(data: Record<string, unknown>): Req | null {
  for (const field of ['unlockReq', 'unlock', 'req']) {
    const v = data[field];
    if (v !== null && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'string') {
      return v as Req;
    }
  }
  return null;
}

interface Ctx {
  state: GameState;
  content: ContentDb;
  catalog: Catalog;
  /** The entities being weighed up the chain, so that two that name each other do not loop. */
  visiting: Set<string>;
  /** The entity whose own mark is left out: asks whether it would be shown had it never been marked. */
  unmarked: string | null;
  /** Set while an owner is weighed: the `named` term does not hold there, which keeps the search one step deep. */
  inOwner: boolean;
}

const cellExplored = (ctx: Ctx, cellId: string): boolean => {
  const cell = indexOf(ctx.content).cells.get(cellId);
  return cell !== undefined && cellLevel(ctx.state, cell, ctx.content) >= 1;
};

const regionExplored = (ctx: Ctx, regionId: string): boolean =>
  (indexOf(ctx.content).regions.get(regionId)?.cells ?? []).some((c) => cellExplored(ctx, c));

/** A fight zone is on show once its map cell is explored (if it has one) and its own unlock holds. */
function zoneShown(ctx: Ctx, zoneId: string): boolean {
  const index = indexOf(ctx.content);
  const zone = index.zones.get(zoneId);
  if (!zone) return false;
  if (zone.unlock !== null && !evalReq(ctx.state, zone.unlock, ctx.content).met) return false;
  const cell = index.zoneCell.get(zoneId);
  return cell === undefined || cellLevel(ctx.state, cell, ctx.content) >= 1;
}

function ownerShows(ctx: Ctx, owner: Owner): boolean {
  switch (owner.t) {
    case 'zone':
      return zoneShown(ctx, owner.id);
    case 'operation': {
      const op = indexOf(ctx.content).operations.get(owner.id);
      return (
        op !== undefined && (op.unlock === null || evalReq(ctx.state, op.unlock, ctx.content).met)
      );
    }
    case 'shop':
      return buyPrice(owner.item, ctx.content) !== null;
    case 'board':
      return true;
    case 'find':
      return owner.place !== null && ctx.state.world.pois[owner.place] === true;
    case 'group': {
      const outer = ctx.inOwner;
      ctx.inOwner = true;
      try {
        return owner.others.some((id) =>
          (ctx.catalog.kindsOf.get(id) ?? []).some(
            (kind) => !ctx.visiting.has(`${kind}:${id}`) && levelIn(ctx, { kind, id }) === 'full',
          ),
        );
      } finally {
        ctx.inOwner = outer;
      }
    }
    case 'entity': {
      const key = keyOf(owner.ref);
      if (ctx.visiting.has(key)) return false;
      if (owner.gate > 0) {
        // A step of a quest is on show once the chain has got to it.
        const progress = ctx.state.quests[owner.ref.id];
        if (!progress || progress.step < owner.gate) return false;
      }
      // An owner counts by its own terms only: being named by another entity does not pass the name on.
      const outer = ctx.inOwner;
      ctx.inOwner = true;
      try {
        return levelIn(ctx, owner.ref) === 'full';
      } finally {
        ctx.inOwner = outer;
      }
    }
  }
}

/** Whether something that is itself fully shown names the entity. */
function named(ctx: Ctx, ref: EntityRef): boolean {
  const list = ctx.catalog.owners.get(keyOf(ref));
  return list !== undefined && list.some((owner) => ownerShows(ctx, owner));
}

function termHolds(ctx: Ctx, term: RevealTerm, entry: Entry): boolean {
  if (typeof term !== 'string') return evalReq(ctx.state, term.req as Req, ctx.content).met;
  const { state, content } = ctx;
  const { id } = entry.ref;
  switch (term) {
    case 'always':
      return true;
    case 'known':
      return state.known[id] === true;
    case 'owned':
      return (
        (state.bank[id] ?? 0) > 0 || (state.gear[id] ?? 0) > 0 || state.buffs[id] !== undefined
      );
    case 'seen':
      return keyOf(entry.ref) !== ctx.unmarked && state.shown[shownKey(entry.ref)] === true;
    case 'named':
      return !ctx.inOwner && named(ctx, entry.ref);
    case 'encountered':
      return (
        (entry.list === 'enemies' || entry.list === 'bosses') && bingoLevel(state, id, content) >= 1
      );
    case 'explored':
      if (entry.list === 'cells') return cellExplored(ctx, id);
      if (entry.list === 'regions') return regionExplored(ctx, id);
      // A work that a point opens is shown once that point is found.
      if (entry.list === 'fieldworks') {
        const point = indexOf(content).fieldworks.get(id)?.point;
        return point !== undefined && state.world.pois[point] === true;
      }
      return entry.ref.kind === 'poi' && state.world.pois[id] === true;
    case 'adjacent': {
      if (entry.list !== 'regions') return false;
      const at = ctx.catalog.regionAt.get(id);
      if (at === undefined) return false;
      if (regionHere(state, content) === id) return true;
      return [at - 1, at + 1].some((i) => {
        const near = content.regions[i];
        return near !== undefined && regionExplored(ctx, near.id);
      });
    }
    case 'parent': {
      const index = indexOf(content);
      const parent =
        entry.list === 'cells'
          ? { kind: 'region', id: index.cells.get(id)?.region ?? '' }
          : entry.ref.kind === 'poi'
            ? { kind: 'cell', id: index.pois.get(id)?.cell.id ?? '' }
            : null;
      return parent !== null && levelIn(ctx, parent) !== 'hidden';
    }
    case 'actionable':
      return (
        entry.list === 'regions' &&
        isRegionOpen(state, content.regions.find((r) => r.id === id) as Region, content)
      );
    case 'questStarted':
      return entry.list === 'quests' && state.quests[id] !== undefined;
    case 'unlocked': {
      const req = unlockReqOf(entry.data);
      if (req !== null && !evalReq(state, req, content).met) return false;
      // An operation lives on the missions list under its own id; what opens it is on the operation.
      const op = entry.list === 'missions' ? indexOf(content).operations.get(id) : undefined;
      return op?.unlock == null || evalReq(state, op.unlock, content).met;
    }
  }
}

function levelIn(ctx: Ctx, ref: EntityRef): RevealLevel {
  const entry = ctx.catalog.entries.get(keyOf(ref));
  if (!entry) return 'full';
  const rule = ruleOf(entry, ctx.catalog);
  if (!rule) return 'full';
  const key = keyOf(ref);
  const was = ctx.visiting.has(key);
  ctx.visiting.add(key);
  try {
    if (rule.full.some((t) => termHolds(ctx, t, entry))) return 'full';
    if (rule.name?.some((t) => termHolds(ctx, t, entry))) return 'name';
    return 'hidden';
  } finally {
    if (!was) ctx.visiting.delete(key);
  }
}

const context = (state: GameState, content: ContentDb, unmarked: string | null): Ctx => ({
  state,
  content,
  catalog: catalogOf(content),
  visiting: new Set(),
  unmarked,
  inOwner: false,
});

/**
 * How much of an entity the player may see now: `full`, `name` or `hidden`. An id the content does
 * not have counts as `full` (the page says it is not found by itself). `rules` is for packs whose
 * terms may one day read what the rules add; the terms of today read the state and the content.
 */
export function revealOf(
  state: GameState,
  ref: EntityRef,
  content: ContentDb,
  _rules: Rules = defaultRules,
): RevealLevel {
  return levelIn(context(state, content, null), ref);
}

/** The text key of the hint for what each kind of term asks of the player. */
const HINTS: Readonly<Record<string, string>> = {
  always: 'reveal.hint.named',
  known: 'reveal.hint.known',
  owned: 'reveal.hint.owned',
  seen: 'reveal.hint.named',
  named: 'reveal.hint.named',
  encountered: 'reveal.hint.encountered',
  explored: 'reveal.hint.explored',
  actionable: 'reveal.hint.adjacent',
  adjacent: 'reveal.hint.adjacent',
  parent: 'reveal.hint.explored',
  questStarted: 'reveal.hint.quest',
  unlocked: 'reveal.hint.unlocked',
};

/**
 * The text key that says how to learn more about an entity that is not fully shown, or null when
 * the rule cannot say (nothing to learn, or only an explicit requirement tree). The hint follows
 * the first term of the full rule that is not the generic «find where it is mentioned».
 */
export function revealHint(
  state: GameState,
  ref: EntityRef,
  content: ContentDb,
  rules: Rules = defaultRules,
): string | null {
  const catalog = catalogOf(content);
  const entry = catalog.entries.get(keyOf(ref));
  // An id the content does not have is told like one not discovered yet, by the rule of its kind: an address says nothing.
  const level = entry ? revealOf(state, ref, content, rules) : 'hidden';
  if (level === 'full') return null;
  const rule = entry ? ruleOf(entry, catalog) : (catalog.kindRule.get(ref.kind) ?? null);
  if (!rule) return null;
  const names = (list: readonly RevealTerm[]): string[] =>
    list.map((t) => (typeof t === 'string' ? t : 'req'));
  const specific = (terms: string[]): string | undefined =>
    terms.find(
      (t) => t !== 'seen' && t !== 'named' && t !== 'always' && t !== 'parent' && t !== 'req',
    );
  // What is hidden is first brought to a name (a region by the one next to it); a name is brought to full.
  const fullTerms = names(rule.full);
  const pick =
    (level === 'hidden' ? specific(names(rule.name ?? [])) : undefined) ??
    specific(fullTerms) ??
    fullTerms.find((t) => t === 'req') ??
    fullTerms[0];
  if (pick === undefined) return null;
  return pick === 'req' ? 'reveal.hint.unlocked' : (HINTS[pick] ?? null);
}

/**
 * Whether the interface may mark the entity as seen: it is shown by name or more by a rule other
 * than the mark itself (an entity that is fully shown names it, the player has met it, ...).
 */
export function canMark(state: GameState, ref: EntityRef, content: ContentDb): boolean {
  const ctx = context(state, content, keyOf(ref));
  return ctx.catalog.entries.has(keyOf(ref)) && levelIn(ctx, ref) !== 'hidden';
}

/** Most entries the `shown` set holds: the entities the content has. */
export function seenLimit(content: ContentDb): number {
  return catalogOf(content).entries.size;
}

/** Whether a key of `state.shown` (`<id>@<kind>`) names an entity of the content. */
export function isShownKey(content: ContentDb, key: string): boolean {
  const at = key.lastIndexOf('@');
  return at > 0 && catalogOf(content).entries.has(`${key.slice(at + 1)}:${key.slice(0, at)}`);
}

/** Who names whom, for the tests: the owners of an entity as a list of short descriptions. */
export function revealOwnersOf(content: ContentDb, ref: EntityRef): string[] {
  return (catalogOf(content).owners.get(keyOf(ref)) ?? []).map((o) =>
    o.t === 'entity' ? `entity:${keyOf(o.ref)}` : o.t,
  );
}

/**
 * The command `reveal.mark { refs }`: the interface says it has shown these entities legitimately.
 * Each ref is validated against the content and the rules (`canMark`); one that does not pass
 * refuses the whole command and changes nothing. Marking again is a no-op. At most `MARK_MAX_REFS`
 * refs a call, and the set never holds more than the entities of the content.
 */
export function markSeen(state: GameState, refs: unknown, content: ContentDb): CommandResult {
  if (!Array.isArray(refs) || refs.length > MARK_MAX_REFS) {
    return { ok: false, reason: 'error.invalidReveal' };
  }
  const fresh: string[] = [];
  for (const raw of refs as unknown[]) {
    const ref = raw as Partial<EntityRef> | null;
    if (
      ref === null ||
      typeof ref !== 'object' ||
      typeof ref.kind !== 'string' ||
      typeof ref.id !== 'string'
    ) {
      return { ok: false, reason: 'error.invalidReveal' };
    }
    const checked = { kind: ref.kind, id: ref.id };
    if (!canMark(state, checked, content)) return { ok: false, reason: 'error.revealRefused' };
    if (state.shown[shownKey(checked)] !== true) fresh.push(shownKey(checked));
  }
  const room = seenLimit(content) - Object.keys(state.shown).length;
  const unique = [...new Set(fresh)];
  if (unique.length > room) return { ok: false, reason: 'error.revealRefused' };
  for (const id of unique) addShown(state, id, seenLimit(content));
  return { ok: true };
}
