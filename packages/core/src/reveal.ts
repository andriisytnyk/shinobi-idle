import type { ContentDb, RevealRule, RevealTerm } from '@shinobi/content';
import { bingoLevel } from './combat/bingo.ts';
import type { CommandResult } from './engine.ts';
import type { EntityRef } from './entity.ts';
import { indexOf, shopEntries } from './lookup.ts';
import { evalReq, type Req } from './requirements.ts';
import { defaultRules, type Rules } from './rules.ts';
import { buyPrice } from './shop.ts';
import { addShown } from './shown.ts';
import type { GameState } from './state.ts';
import { cellLevel } from './world.ts';

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
  /** The mission board, which offers every mission that is on it. */
  | { t: 'board' };

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
const packOf = (id: string): string => (id.includes(':') ? id.slice(0, id.indexOf(':')) : 'core');

const catalogs = new WeakMap<ContentDb, Catalog>();

/** How deep the data of an entity is searched for the ids it names. */
const WALK_DEPTH = 6;

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
  /** Every id inside the data that is an entity of the content, once each, with the name of the field that holds it. */
  const idsIn = (value: unknown, skip: string): [string, string][] => {
    const found = new Map<string, string>();
    const walk = (v: unknown, depth: number, field: string): void => {
      if (typeof v === 'string') {
        if (
          field !== 'id' &&
          kindsOf.has(v) &&
          !found.has(v) &&
          (v !== skip || (kindsOf.get(v)?.length ?? 0) > 1)
        ) {
          found.set(v, field);
        }
      } else if (depth > 0 && Array.isArray(v)) {
        for (const item of v) walk(item, depth - 1, field);
      } else if (depth > 0 && v !== null && typeof v === 'object') {
        for (const [k, item] of Object.entries(v)) {
          if (k !== 'reveal') walk(item, depth - 1, k);
        }
      }
    };
    walk(value, WALK_DEPTH, '');
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
  // The herbs are items that the patch skill gathers; its page lists them.
  const patchSkill = indexOf(content).activitySkill.get('patch');
  for (const herb of content.herbs) {
    const skill = herb.skill ?? patchSkill;
    if (skill !== undefined && entries.has(`skill:${skill}`)) {
      link(herb.id, { t: 'entity', ref: { kind: 'skill', id: skill }, gate: 0 }, 'item');
    }
  }
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
    link(entry.item, { t: 'shop', item: entry.item }, 'item');
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
      return keyOf(entry.ref) !== ctx.unmarked && state.shown[id] === true;
    case 'named':
      return !ctx.inOwner && named(ctx, entry.ref);
    case 'encountered':
      return (
        (entry.list === 'enemies' || entry.list === 'bosses') && bingoLevel(state, id, content) >= 1
      );
    case 'explored':
      if (entry.list === 'cells') return cellExplored(ctx, id);
      if (entry.list === 'regions') return regionExplored(ctx, id);
      return entry.ref.kind === 'poi' && state.world.pois[id] === true;
    case 'adjacent': {
      if (entry.list !== 'regions') return false;
      const at = ctx.catalog.regionAt.get(id);
      if (at === undefined) return false;
      const here = indexOf(content).cells.get(state.world.location)?.region;
      if (here === id) return true;
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
  if (revealOf(state, ref, content, rules) === 'full') return null;
  const catalog = catalogOf(content);
  const entry = catalog.entries.get(keyOf(ref));
  const rule = entry ? ruleOf(entry, catalog) : null;
  if (!rule) return null;
  const terms = rule.full.map((t) => (typeof t === 'string' ? t : 'req'));
  const pick =
    terms.find((t) => t !== 'seen' && t !== 'named' && t !== 'always' && t !== 'req') ??
    terms.find((t) => t === 'req') ??
    terms[0];
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

/** Most ids the `seen` set holds: the entities the content has (an id of any kind). */
export function seenLimit(content: ContentDb): number {
  return catalogOf(content).kindsOf.size;
}

/** Whether an id is an entity of the content (of any kind that has a page). */
export function isEntityId(content: ContentDb, id: string): boolean {
  return catalogOf(content).kindsOf.has(id);
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
    if (state.shown[checked.id] !== true) fresh.push(checked.id);
  }
  const room = seenLimit(content) - Object.keys(state.shown).length;
  const unique = [...new Set(fresh)];
  if (unique.length > room) return { ok: false, reason: 'error.revealRefused' };
  for (const id of unique) addShown(state, id, seenLimit(content));
  return { ok: true };
}
