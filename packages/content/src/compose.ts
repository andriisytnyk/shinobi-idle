/**
 * `composeContent(packs)`: assembles content packs into one validated `ContentDb`.
 *
 * Order: packs are sorted topologically by `dependsOn` and `loadAfter`, ties by pack id, so the
 * result never depends on the order of the input array. Every error names the pack that caused it.
 *
 * Packs are third-party data: every accumulator that is keyed by a string a pack supplies is a
 * `Map`, and the keys `__proto__`, `constructor` and `prototype` are rejected anywhere in pack data.
 */
import { z, type ZodError } from 'zod';
import { skillFamilyKeys, type ModifierKeyInfo } from './modifiers.ts';
import type { ContentPack, EntityListKey, Patch } from './pack.ts';
import { validateClosure } from './closure.ts';
import { PackError } from './pack-error.ts';
import {
  contentDbSchema,
  packManifestSchema,
  type ContentDb,
  type IconTable,
  type PackManifest,
} from './schema.ts';

/** Every list of `ContentDb` whose entities have an `id`. */
export const ENTITY_LISTS = [
  'skillGroups',
  'natures',
  'playerRanks',
  'techRanks',
  'missionRanks',
  'villageStages',
  'states',
  'tags',
  'roles',
  'attackStyles',
  'fightRegions',
  'itemKinds',
  'currencies',
  'entityKinds',
  'trophies',
  'gearFx',
  'terrains',
  'countries',
  'skills',
  'seals',
  'techniques',
  'exercises',
  'practices',
  'obstacles',
  'herbs',
  'pools',
  'items',
  'recipes',
  'missions',
  'team',
  'regions',
  'cells',
  'places',
  'links',
  'enemies',
  'bosses',
  'buildings',
  'resources',
  'gear',
  'quests',
  'exams',
  'zones',
  'operations',
  'statuses',
  'traits',
  'combos',
] as const satisfies readonly EntityListKey[];

const ENTITY_LIST_SET: ReadonlySet<string> = new Set(ENTITY_LISTS);

/** Lists whose entries have no id of their own: what names the entry (a field, or the coordinates of a hex). */
const KEYED_LISTS: ReadonlyMap<string, (e: Plain) => string> = new Map([
  ['market', (e: Plain) => String(e.item)],
  ['shop', (e: Plain) => String(e.item)],
  ['coat', (e: Plain) => String(e.product)],
  ['hexes', (e: Plain) => `${String(e.q)},${String(e.r)}`],
]);

/** Keys that would reach the prototype chain; they are never valid in pack data. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const LIST_SCHEMAS = new Map(
  Object.entries(contentDbSchema.shape) as unknown as [
    string,
    { safeParse(v: unknown): { success: boolean; data?: unknown; error?: ZodError } },
  ][],
);

/** Whether `pack` may own `id`: the pack `core` owns bare ids and `core:` ids, every other pack its own prefix only. */
export function ownsId(pack: string, id: string): boolean {
  if (pack === 'core') return !id.includes(':') || id.startsWith('core:');
  return id.startsWith(`${pack}:`);
}

/** A deep copy of plain data (the packs are JSON-like). */
const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

const fail = (pack: string, message: string): never => {
  throw new PackError(pack, `Content pack "${pack}": ${message}`);
};

const issues = (error: ZodError | undefined): string =>
  (error?.issues ?? [])
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Rejects a forbidden key anywhere in the data of a pack (own keys, so `JSON.parse` of `__proto__` is caught). */
function scanKeys(pack: string, value: unknown, where: string, depth = 0): void {
  if (depth > 40) fail(pack, `${where} is nested too deeply or is cyclic`);
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanKeys(pack, v, `${where}[${i}]`, depth + 1));
    return;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail(pack, `forbidden key "${key}" at ${where}`);
    scanKeys(pack, (value as Plain)[key], `${where}.${key}`, depth + 1);
  }
}

/** Rejects an id that has a forbidden part (`constructor`, `x:__proto__`, ...). */
function checkId(pack: string, id: string, what: string): void {
  if (id.split(':').some((part) => FORBIDDEN_KEYS.has(part)))
    fail(pack, `${what} "${id}" has a forbidden id part`);
}

// ---------- the envelope of a pack ----------

const rec = z.record(z.string(), z.unknown());
const patchSchema = z.union([
  z.strictObject({
    target: z.strictObject({ kind: z.string(), id: z.string() }),
    set: rec.optional(),
    append: z.record(z.string(), z.array(z.unknown())).optional(),
  }),
  z.strictObject({
    balance: z.strictObject({
      path: z.string().min(1),
      set: z.union([z.number(), z.string(), z.boolean(), z.array(z.unknown())]),
    }),
  }),
]);
const packEnvelopeSchema = z.strictObject({
  manifest: packManifestSchema,
  data: rec,
  balance: rec,
  locales: z.strictObject({
    uk: z.record(z.string(), z.string()),
    en: z.record(z.string(), z.string()).optional(),
  }),
  icons: z.record(z.string(), z.record(z.string(), z.string())),
  patches: z.array(patchSchema),
  modifierKeys: z
    .record(z.string(), z.strictObject({ desc: z.string(), flat: z.boolean(), wired: z.boolean() }))
    .optional(),
  rules: z.custom<unknown>((v) => v === undefined || typeof v === 'function').optional(),
  ui: z.string().optional(),
});

/**
 * Checks every pack before anything else reads it: forbidden keys, then the shape of the whole
 * pack. A pack whose id cannot be read is named by its position in the input (`#2`).
 */
function checkPacks(packs: readonly ContentPack[]): void {
  packs.forEach((p, i) => {
    const raw = (p as { manifest?: { id?: unknown } } | null)?.manifest;
    const label = typeof raw?.id === 'string' && raw.id !== '' ? raw.id : `#${i}`;
    if (p === null || typeof p !== 'object') return fail(label, 'a pack must be an object');
    const { rules: _rules, ...plain } = p;
    void _rules;
    scanKeys(label, plain, 'pack');
    const parsed = packEnvelopeSchema.safeParse(p);
    if (!parsed.success) fail(label, `malformed pack (${issues(parsed.error)})`);
  });
}

// ---------- order ----------

function loadOrder(packs: readonly ContentPack[]): ContentPack[] {
  const byId = new Map<string, ContentPack>();
  for (const p of packs) {
    if (byId.has(p.manifest.id)) fail(p.manifest.id, 'duplicate pack id');
    byId.set(p.manifest.id, p);
  }
  const after = new Map<string, Set<string>>();
  for (const p of byId.values()) {
    const m = p.manifest;
    const needs = new Set<string>();
    for (const d of m.dependsOn) {
      if (!byId.has(d)) fail(m.id, `depends on "${d}", which is not loaded`);
      needs.add(d);
    }
    for (const d of m.loadAfter) if (byId.has(d)) needs.add(d);
    if (needs.has(m.id)) fail(m.id, 'depends on itself');
    after.set(m.id, needs);
  }
  const done = new Set<string>();
  const out: ContentPack[] = [];
  while (out.length < byId.size) {
    const ready = [...byId.keys()]
      .filter((id) => !done.has(id) && [...(after.get(id) ?? [])].every((d) => done.has(d)))
      .sort();
    const next = ready[0];
    if (next === undefined) {
      const stuck = [...byId.keys()].filter((id) => !done.has(id)).sort();
      return fail(
        stuck[0] ?? '?',
        `dependency cycle among ${stuck.map((s) => `"${s}"`).join(', ')}`,
      );
    }
    done.add(next);
    out.push(byId.get(next) as ContentPack);
  }
  return out;
}

// ---------- balance ----------

function mergeBalance(
  acc: Plain,
  frag: Plain,
  pack: string,
  path: string[],
  owners: Map<string, string>,
): void {
  for (const [key, value] of Object.entries(frag)) {
    const here = [...path, key];
    const label = here.join('.');
    if (!Object.hasOwn(acc, key)) {
      const inExt = path[0] === 'K' && path[1] === 'ext';
      const mayCreate =
        pack === 'core' ||
        key.startsWith(`${pack}:`) ||
        (path.length === 2 && inExt && key === pack) ||
        (path.length === 1 && path[0] === 'K' && key === 'ext') ||
        (path.length >= 3 && inExt);
      if (!mayCreate)
        fail(
          pack,
          `balance key "${label}" is new and not in the pack namespace; use "${pack}:<name>" or K.ext.${pack}`,
        );
      if (path.length === 1 && path[0] === 'K' && key === 'ext' && pack !== 'core') {
        const others = Object.keys(value as Plain).filter((k) => k !== pack);
        if (others.length > 0)
          fail(
            pack,
            `balance key "K.ext.${others[0]}" is not in the pack namespace; a pack sets only K.ext.${pack}`,
          );
      }
      acc[key] = clone(value);
      markOwners(value, here, pack, owners);
      continue;
    }
    const current = acc[key];
    if (isPlain(current) && isPlain(value)) {
      mergeBalance(current, value, pack, here, owners);
      continue;
    }
    fail(
      pack,
      `balance "${label}" is already set by pack "${owners.get(label) ?? 'core'}"; change it with a patch`,
    );
  }
}

function markOwners(
  value: unknown,
  path: string[],
  pack: string,
  owners: Map<string, string>,
): void {
  owners.set(path.join('.'), pack);
  if (isPlain(value))
    for (const [k, v] of Object.entries(value)) markOwners(v, [...path, k], pack, owners);
}

// ---------- patches ----------

/**
 * Applies one patch. `set` replaces a field and two packs may not set the same field; `append` adds
 * items to a list and any number of packs may append to the same list (in load order).
 */
function applyPatch(
  pack: string,
  patch: Patch,
  lists: Map<string, Plain[]>,
  hexes: Plain[],
  patched: Set<string>,
  patchedBy: Map<string, string>,
  balance: Plain,
  balanceOwners: Map<string, string>,
): void {
  if ('balance' in patch) {
    const { path, set } = patch.balance;
    const parts = path.split('.');
    let at: unknown = balance;
    for (const part of parts.slice(0, -1)) {
      if (!isPlain(at) || !Object.hasOwn(at, part))
        return fail(pack, `balance patch: "${path}" does not exist`);
      at = at[part];
    }
    const last = parts[parts.length - 1] ?? '';
    if (!isPlain(at) || !Object.hasOwn(at, last))
      return fail(pack, `balance patch: "${path}" does not exist`);
    if (isPlain(at[last])) return fail(pack, `balance patch: "${path}" is not a leaf`);
    const key = `balance:${path}`;
    if (patched.has(key))
      return fail(pack, `balance patch: "${path}" was already set by another pack`);
    patched.add(key);
    at[last] = clone(set);
    balanceOwners.set(path, pack);
    if (parts[0] === 'K' && parts[1] !== undefined) balanceOwners.set(`K.${parts[1]}`, pack);
    return;
  }
  const { kind, id } = patch.target;
  // A hex has no id of its own: a patch names it by its coordinates ("q,r") and may set its terrain or country.
  const isHex = kind === 'hexes';
  if (!isHex && !ENTITY_LIST_SET.has(kind))
    return fail(pack, `patch targets unknown list "${kind}"`);
  const entity = isHex
    ? hexes.find((e) => `${String(e.q)},${String(e.r)}` === id)
    : lists.get(kind)?.find((e) => e.id === id);
  if (!entity) return fail(pack, `patch targets ${kind} "${id}", which does not exist`);
  if (isHex)
    for (const field of Object.keys(patch.set ?? {}).concat(Object.keys(patch.append ?? {})))
      if (field !== 'terrain' && field !== 'country')
        fail(pack, `patch to hex "${id}" may set only "terrain" and "country", not "${field}"`);
  const mark = (field: string) => {
    const key = `${kind}:${id}:${field}`;
    if (patched.has(key))
      fail(pack, `patch to ${kind} "${id}" field "${field}" was already set by another pack`);
    patched.add(key);
  };
  patchedBy.set(`${kind}:${id}`, pack);
  for (const [field, value] of Object.entries(patch.set ?? {})) {
    if (field === 'id') fail(pack, `patch to ${kind} "${id}" may not change the id`);
    mark(field);
    entity[field] = clone(value);
  }
  for (const [field, items] of Object.entries(patch.append ?? {})) {
    const current = entity[field];
    if (!Array.isArray(current))
      fail(pack, `patch to ${kind} "${id}": field "${field}" is not a list`);
    (current as unknown[]).push(...clone([...items]));
  }
}

// ---------- compose ----------

/** The locale kinds that must carry a name and a description, by list. */
const DESCRIBED: Partial<Record<EntityListKey, string>> = {
  techniques: 'technique',
  skills: 'skill',
  items: 'item',
  enemies: 'enemy',
  bosses: 'boss',
  buildings: 'building',
  resources: 'resource',
  places: 'place',
  regions: 'region',
  seals: 'seal',
  statuses: 'status',
  traits: 'trait',
  combos: 'combo',
  operations: 'operation',
};

/**
 * Whether a pack may define the locale key: the pack `core` any key; another pack only keys of its
 * own entities (`<kind>.<pack>:<slug>...`) and free strings under `x.<pack>.`.
 */
function ownsLocaleKey(pack: string, key: string): boolean {
  if (pack === 'core') return true;
  return key.startsWith(`x.${pack}.`) || new RegExp(`^[A-Za-z0-9_]+\\.${pack}:`).test(key);
}

export function composeContent(packs: readonly ContentPack[]): ContentDb {
  checkPacks(packs);
  const ordered = loadOrder(packs);

  const lists = new Map<string, Plain[]>();
  const keyed = new Map<string, Plain[]>([
    ['market', []],
    ['shop', []],
    ['coat', []],
    ['hexes', []],
  ]);
  const owners = new Map<string, string>(); // `${list}:${id}` -> pack
  const patchedBy = new Map<string, string>(); // `${list}:${id}` -> the last pack that patched it
  const cellKeys = new Map<string, unknown>();
  const balance: Plain = {};
  const balanceOwners = new Map<string, string>();
  const uk = new Map<string, string>();
  const en = new Map<string, string>();
  const localeOwners = new Map<string, string>();
  const icons = new Map<string, Map<string, string>>();
  const iconOwners = new Map<string, string>();
  const declared: { pack: string; keys: Record<string, ModifierKeyInfo> }[] = [];
  const ai = { visibleTraits: [] as unknown[], tiers: [] as Plain[] };
  const patches: { pack: string; patch: Patch }[] = [];

  for (const pack of ordered) {
    const pid = pack.manifest.id;
    const data = pack.data as Plain;

    for (const key of Object.keys(data)) {
      const known =
        ENTITY_LIST_SET.has(key) || KEYED_LISTS.has(key) || key === 'cellKeys' || key === 'ai';
      if (!known) fail(pid, `unknown data list "${key}"`);
    }

    for (const list of ENTITY_LISTS) {
      const raw = data[list];
      if (raw === undefined) continue;
      const parsed = LIST_SCHEMAS.get(list)?.safeParse(raw);
      if (!parsed?.success) fail(pid, `${list}: ${issues(parsed?.error)}`);
      const items = (parsed?.data ?? []) as Plain[];
      let target = lists.get(list);
      if (!target) lists.set(list, (target = []));
      for (const e of items) {
        const id = String(e.id);
        checkId(pid, id, list);
        if (!ownsId(pid, id))
          fail(
            pid,
            `${list} "${id}" is outside the pack namespace; ids of this pack start with "${pid === 'core' ? 'core:' : `${pid}:`}"`,
          );
        const k = `${list}:${id}`;
        if (owners.has(k))
          fail(pid, `duplicate ${list} "${id}" (already defined by pack "${owners.get(k)}")`);
        owners.set(k, pid);
        target.push(e);
        if (list === 'cells')
          for (const poi of (e.pois as Plain[] | undefined) ?? []) {
            const poiId = String(poi.id);
            const pk = `poi:${poiId}`;
            checkId(pid, poiId, 'poi');
            if (!ownsId(pid, poiId)) fail(pid, `poi "${poiId}" is outside the pack namespace`);
            if (owners.has(pk))
              fail(pid, `duplicate poi "${poiId}" (already defined by pack "${owners.get(pk)}")`);
            owners.set(pk, pid);
          }
      }
    }

    for (const [list, keyOf] of KEYED_LISTS) {
      const raw = data[list];
      if (raw === undefined) continue;
      const parsed = LIST_SCHEMAS.get(list)?.safeParse(raw);
      if (!parsed?.success) fail(pid, `${list}: ${issues(parsed?.error)}`);
      for (const e of (parsed?.data ?? []) as Plain[]) {
        const key = keyOf(e);
        const k = `${list}:${key}`;
        if (owners.has(k))
          fail(
            pid,
            `duplicate ${list} entry "${key}" (already defined by pack "${owners.get(k)}")`,
          );
        owners.set(k, pid);
        keyed.get(list)?.push(e);
      }
    }

    if (data.cellKeys !== undefined) {
      const parsed = LIST_SCHEMAS.get('cellKeys')?.safeParse(data.cellKeys);
      if (!parsed?.success) fail(pid, `cellKeys: ${issues(parsed?.error)}`);
      for (const [key, req] of Object.entries(parsed?.data as Plain)) {
        checkId(pid, key, 'cellKeys');
        if (!ownsId(pid, key)) fail(pid, `cellKeys "${key}" is outside the pack namespace`);
        if (cellKeys.has(key)) fail(pid, `duplicate cellKeys "${key}"`);
        cellKeys.set(key, req);
        owners.set(`cellKeys:${key}`, pid);
      }
    }

    if (data.ai !== undefined) {
      const parsed = LIST_SCHEMAS.get('ai')?.safeParse(data.ai);
      if (!parsed?.success) fail(pid, `ai: ${issues(parsed?.error)}`);
      const a = parsed?.data as { visibleTraits: string[]; tiers: Plain[] };
      for (const t of a.visibleTraits) {
        ai.visibleTraits.push(t);
        if (!owners.has(`aiTrait:${t}`)) owners.set(`aiTrait:${t}`, pid);
      }
      for (const t of a.tiers) {
        const id = String(t.id);
        checkId(pid, id, 'ai tier');
        if (!ownsId(pid, id)) fail(pid, `ai tier "${id}" is outside the pack namespace`);
        if (ai.tiers.some((x) => x.id === id)) fail(pid, `duplicate ai tier "${id}"`);
        ai.tiers.push(t);
        owners.set(`ai:${id}`, pid);
      }
    }

    mergeBalance(balance, pack.balance as Plain, pid, [], balanceOwners);

    for (const [target, source, label] of [
      [uk, pack.locales.uk, 'uk'],
      [en, pack.locales.en ?? {}, 'en'],
    ] as const) {
      for (const [key, value] of Object.entries(source)) {
        if (!ownsLocaleKey(pid, key))
          fail(
            pid,
            `locale key "${key}" is not the pack's own; use "<kind>.${pid}:<id>..." for its entities or "x.${pid}.<name>" for free strings`,
          );
        const lk = `${label}:${key}`;
        if (localeOwners.has(lk))
          fail(
            pid,
            `locale key "${key}" (${label}) is already defined by pack "${localeOwners.get(lk)}"`,
          );
        localeOwners.set(lk, pid);
        target.set(key, value);
      }
    }

    for (const [kind, table] of Object.entries(pack.icons)) {
      let out = icons.get(kind);
      if (!out) icons.set(kind, (out = new Map()));
      for (const [id, icon] of Object.entries(table)) {
        const ik = `${kind}:${id}`;
        if (iconOwners.has(ik))
          fail(pid, `icon ${kind} "${id}" is already defined by pack "${iconOwners.get(ik)}"`);
        if (pid !== 'core' && !ownsId(pid, id))
          fail(pid, `icon ${kind} "${id}" is outside the pack namespace`);
        iconOwners.set(ik, pid);
        out.set(id, icon);
      }
    }

    if (pack.modifierKeys) {
      for (const key of Object.keys(pack.modifierKeys))
        if (pid !== 'core' && !key.startsWith(`${pid}:`))
          fail(pid, `modifier key "${key}" must start with "${pid}:"`);
      declared.push({ pack: pid, keys: clone({ ...pack.modifierKeys }) });
    }
    for (const patch of pack.patches) patches.push({ pack: pid, patch });
  }

  // Patches run in load order, after everything is merged.
  const patched = new Set<string>();
  for (const { pack, patch } of patches)
    applyPatch(
      pack,
      patch,
      lists,
      keyed.get('hexes') ?? [],
      patched,
      patchedBy,
      balance,
      balanceOwners,
    );

  // Modifier keys: the families of the composed skills, then each pack's declarations.
  const skills = (lists.get('skills') ?? []) as { id: string; activity: string }[];
  const modifierKeys = new Map<string, ModifierKeyInfo>();
  const keyOwners = new Map<string, string>();
  for (const [key, info] of Object.entries(skillFamilyKeys(skills))) {
    modifierKeys.set(key, info);
    const skill = skills.find((s) => key.endsWith(`.${s.id}`));
    keyOwners.set(key, skill ? (owners.get(`skills:${skill.id}`) ?? 'core') : 'core');
  }
  for (const { pack, keys } of declared)
    for (const [key, info] of Object.entries(keys)) {
      if (modifierKeys.has(key))
        fail(pack, `modifier key "${key}" is already defined by pack "${keyOwners.get(key)}"`);
      modifierKeys.set(key, info);
      keyOwners.set(key, pack);
    }

  // The player ranks are ordered by `after` (ties by load order) and their tiers are their positions.
  const rankList = (lists.get('playerRanks') ?? []) as {
    id: string;
    after?: string;
    tier: number;
  }[];
  lists.set(
    'playerRanks',
    orderRanks(rankList, (id) => owners.get(`playerRanks:${id}`) ?? 'core', fail),
  );

  const raw: Plain = {
    ...Object.fromEntries(ENTITY_LISTS.map((l) => [l, lists.get(l) ?? []])),
    market: keyed.get('market'),
    shop: keyed.get('shop'),
    coat: keyed.get('coat'),
    hexes: keyed.get('hexes'),
    cellKeys: Object.fromEntries(cellKeys),
    ai,
    balance,
  };
  const parsed = contentDbSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? first.path.join('.') : '';
    const list = String(first?.path[0] ?? '');
    const index = first?.path[1];
    const id = typeof index === 'number' ? String((lists.get(list)?.[index] ?? {}).id ?? '') : '';
    const patcher = patchedBy.get(`${list}:${id}`);
    const lastPack = ordered[ordered.length - 1]?.manifest.id ?? 'core';
    const owner =
      patcher ??
      owners.get(`${list}:${id}`) ??
      (list === 'balance' ? balanceOwners.get(`K.${String(first?.path[2] ?? '')}`) : undefined) ??
      lastPack;
    return fail(
      owner,
      `after composing${patcher ? ' and patching' : ''}: ${where}: ${issues(parsed.error)}`,
    );
  }

  const iconTable: IconTable = Object.fromEntries(
    [...icons].map(([kind, table]) => [kind, Object.fromEntries(table)]),
  );
  const db: ContentDb = {
    ...parsed.data,
    packs: ordered.map((p): PackManifest => clone(p.manifest)),
    modifierKeys: Object.fromEntries(modifierKeys),
    icons: iconTable,
    locales: { uk: Object.fromEntries(uk), en: Object.fromEntries(en) },
  };

  const problems = validateClosure(db, {
    owner: (list, id) =>
      patchedBy.get(`${list}:${id}`) ??
      owners.get(`${list}:${id}`) ??
      ordered[0]?.manifest.id ??
      'core',
    iconOwner: (kind, id) => iconOwners.get(`${kind}:${id}`) ?? 'core',
    described: DESCRIBED,
  });
  if (problems.length > 0)
    // The first problem names the pack to blame; the others are listed for the author.
    throw new PackError(
      problems[0]?.pack ?? 'core',
      `Content closure failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n${problems
        .slice(0, 20)
        .map((p) => `  - pack "${p.pack}": ${p.message}`)
        .join('\n')}`,
    );
  return db;
}

/**
 * Orders the player ranks: a rank with `after` goes right behind that rank (behind the ones already
 * placed there, so ties keep load order); the others keep their order. The tier of each rank is its position.
 */
function orderRanks<T extends { id: string; after?: string; tier: number }>(
  list: readonly T[],
  owner: (id: string) => string,
  fail: (pack: string, message: string) => never,
): T[] {
  const placed: T[] = list.filter((r) => r.after === undefined);
  const pending = list.filter((r) => r.after !== undefined);
  for (let progress = true; pending.length > 0 && progress;) {
    progress = false;
    for (const rank of [...pending]) {
      const anchor = placed.findIndex((r) => r.id === rank.after);
      if (anchor < 0) continue;
      let at = anchor + 1;
      while (at < placed.length && placed[at]?.after === rank.after) at++;
      placed.splice(at, 0, rank);
      pending.splice(pending.indexOf(rank), 1);
      progress = true;
    }
  }
  const stuck = pending[0];
  if (stuck) {
    // An anchor that is itself waiting for a rank is a cycle (or a chain that ends in no rank).
    const waiting = pending.some((r) => r.id === stuck.after);
    return fail(
      owner(stuck.id),
      waiting
        ? `player rank "${stuck.id}" is in a cycle of \`after\`: it comes after "${stuck.after}", which waits for a rank`
        : `player rank "${stuck.id}" comes after "${stuck.after}", which is no rank`,
    );
  }
  return placed.map((r, tier) => ({ ...r, tier }));
}
