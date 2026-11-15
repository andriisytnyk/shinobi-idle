/**
 * `composeContent(packs)`: assembles content packs into one validated `ContentDb`.
 *
 * Order: packs are sorted topologically by `dependsOn` and `loadAfter`, ties by pack id, so the
 * result never depends on the order of the input array. Every error names the pack that caused it.
 */
import type { ZodError } from 'zod';
import { computeModifierKeys, type ModifierKeyInfo } from './modifiers.ts';
import type { ContentPack, EntityListKey, Patch } from './pack.ts';
import { validateClosure } from './closure.ts';
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

/** Lists whose entries have no id of their own: the field that names the entry. */
const KEYED_LISTS = { market: 'item', shop: 'item', coat: 'product' } as const;

const LIST_SCHEMAS = contentDbSchema.shape as unknown as Record<
  string,
  { safeParse(v: unknown): { success: boolean; data?: unknown; error?: ZodError } }
>;

/** Whether `pack` may own `id`: the pack `core` owns bare ids and `core:` ids, every other pack its own prefix only. */
export function ownsId(pack: string, id: string): boolean {
  if (pack === 'core') return !id.includes(':') || id.startsWith('core:');
  return id.startsWith(`${pack}:`);
}

/** A deep copy of plain data (the packs are JSON-like). */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const fail = (pack: string, message: string): never => {
  throw new Error(`Content pack "${pack}": ${message}`);
};

const issues = (error: ZodError | undefined): string =>
  (error?.issues ?? [])
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');

// ---------- order ----------

function loadOrder(packs: readonly ContentPack[]): ContentPack[] {
  const byId = new Map<string, ContentPack>();
  for (const p of packs) {
    const parsed = packManifestSchema.safeParse(p.manifest);
    if (!parsed.success)
      fail(String((p.manifest as { id?: unknown }).id), `bad manifest (${issues(parsed.error)})`);
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

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

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

function applyPatch(
  pack: string,
  patch: Patch,
  lists: Record<string, Plain[]>,
  patched: Set<string>,
): void {
  const { kind, id } = patch.target;
  const list = lists[kind];
  const entity = list?.find((e) => e.id === id);
  if (!entity) return fail(pack, `patch targets ${kind} "${id}", which does not exist`);
  const mark = (field: string) => {
    const key = `${kind}:${id}:${field}`;
    if (patched.has(key))
      fail(pack, `patch to ${kind} "${id}" field "${field}" was already patched by another pack`);
    patched.add(key);
  };
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
  regions: 'region',
  seals: 'seal',
  statuses: 'status',
  traits: 'trait',
  combos: 'combo',
  operations: 'operation',
};

export function composeContent(packs: readonly ContentPack[]): ContentDb {
  const ordered = loadOrder(packs);
  const lists: Record<string, Plain[]> = {};
  const keyed: Record<string, Plain[]> = { market: [], shop: [], coat: [] };
  const owners = new Map<string, string>(); // `${list}:${id}` -> pack
  const cellKeys: Plain = {};
  const balance: Plain = {};
  const balanceOwners = new Map<string, string>();
  const uk: Record<string, string> = {};
  const en: Record<string, string> = {};
  const localeOwners = new Map<string, string>();
  const icons: IconTable = {};
  const iconOwners = new Map<string, string>();
  const declared: Record<string, ModifierKeyInfo>[] = [];
  const ai = { visibleTraits: [] as unknown[], tiers: [] as Plain[] };
  const patches: { pack: string; patch: Patch }[] = [];
  const idFields: [string, string][] = [];

  for (const pack of ordered) {
    const pid = pack.manifest.id;
    const data = pack.data as Record<string, unknown>;

    for (const key of Object.keys(data)) {
      const known =
        (ENTITY_LISTS as readonly string[]).includes(key) ||
        key in KEYED_LISTS ||
        key === 'cellKeys' ||
        key === 'ai';
      if (!known) fail(pid, `unknown data list "${key}"`);
    }

    for (const list of ENTITY_LISTS) {
      const raw = data[list];
      if (raw === undefined) continue;
      const parsed = LIST_SCHEMAS[list]?.safeParse(raw);
      if (!parsed?.success) fail(pid, `${list}: ${issues(parsed?.error)}`);
      const items = (parsed?.data ?? []) as Plain[];
      const target = (lists[list] ??= []);
      for (const e of items) {
        const id = String(e.id);
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
            const pk = `poi:${String(poi.id)}`;
            if (!ownsId(pid, String(poi.id)))
              fail(pid, `poi "${String(poi.id)}" is outside the pack namespace`);
            if (owners.has(pk))
              fail(
                pid,
                `duplicate poi "${String(poi.id)}" (already defined by pack "${owners.get(pk)}")`,
              );
            owners.set(pk, pid);
          }
      }
    }

    for (const [list, field] of Object.entries(KEYED_LISTS)) {
      const raw = data[list];
      if (raw === undefined) continue;
      const parsed = LIST_SCHEMAS[list]?.safeParse(raw);
      if (!parsed?.success) fail(pid, `${list}: ${issues(parsed?.error)}`);
      for (const e of (parsed?.data ?? []) as Plain[]) {
        const key = String(e[field]);
        const k = `${list}:${key}`;
        if (owners.has(k))
          fail(
            pid,
            `duplicate ${list} entry "${key}" (already defined by pack "${owners.get(k)}")`,
          );
        owners.set(k, pid);
        idFields.push([list, key]);
        (keyed[list] as Plain[]).push(e);
      }
    }

    if (data.cellKeys !== undefined) {
      const parsed = LIST_SCHEMAS.cellKeys?.safeParse(data.cellKeys);
      if (!parsed?.success) fail(pid, `cellKeys: ${issues(parsed?.error)}`);
      for (const [key, req] of Object.entries(parsed?.data as Plain)) {
        if (!ownsId(pid, key)) fail(pid, `cellKeys "${key}" is outside the pack namespace`);
        if (Object.hasOwn(cellKeys, key)) fail(pid, `duplicate cellKeys "${key}"`);
        cellKeys[key] = req;
        owners.set(`cellKeys:${key}`, pid);
      }
    }

    if (data.ai !== undefined) {
      const parsed = LIST_SCHEMAS.ai?.safeParse(data.ai);
      if (!parsed?.success) fail(pid, `ai: ${issues(parsed?.error)}`);
      const a = parsed?.data as { visibleTraits: unknown[]; tiers: Plain[] };
      ai.visibleTraits.push(...a.visibleTraits);
      for (const t of a.tiers) {
        const id = String(t.id);
        if (!ownsId(pid, id)) fail(pid, `ai tier "${id}" is outside the pack namespace`);
        if (ai.tiers.some((x) => x.id === id)) fail(pid, `duplicate ai tier "${id}"`);
        ai.tiers.push(t);
        owners.set(`ai:${id}`, pid);
      }
    }

    mergeBalance(balance, pack.balance as Plain, pid, [], balanceOwners);

    for (const [target, source, owner] of [
      [uk, pack.locales.uk, 'uk'],
      [en, pack.locales.en ?? {}, 'en'],
    ] as const) {
      for (const [key, value] of Object.entries(source)) {
        const lk = `${owner}:${key}`;
        if (localeOwners.has(lk))
          fail(
            pid,
            `locale key "${key}" (${owner}) is already defined by pack "${localeOwners.get(lk)}"`,
          );
        localeOwners.set(lk, pid);
        target[key] = value;
      }
    }

    for (const [kind, table] of Object.entries(pack.icons)) {
      const out = (icons[kind] ??= {});
      for (const [id, icon] of Object.entries(table)) {
        const ik = `${kind}:${id}`;
        if (iconOwners.has(ik))
          fail(pid, `icon ${kind} "${id}" is already defined by pack "${iconOwners.get(ik)}"`);
        if (pid !== 'core' && !ownsId(pid, id))
          fail(pid, `icon ${kind} "${id}" is outside the pack namespace`);
        iconOwners.set(ik, pid);
        out[id] = icon;
      }
    }

    if (pack.modifierKeys) {
      for (const key of Object.keys(pack.modifierKeys))
        if (pid !== 'core' && !key.startsWith(`${pid}:`))
          fail(pid, `modifier key "${key}" must start with "${pid}:"`);
      declared.push({ ...pack.modifierKeys });
    }
    for (const patch of pack.patches) patches.push({ pack: pid, patch });
  }

  // Patches run in load order, after everything is merged.
  const patched = new Set<string>();
  for (const { pack, patch } of patches) applyPatch(pack, patch, lists, patched);

  const skills = (lists.skills ?? []) as { id: string; activity: string }[];
  let modifierKeys: Record<string, ModifierKeyInfo>;
  try {
    modifierKeys = computeModifierKeys(skills, declared);
  } catch (e) {
    const packName = ordered.find((p) => p.manifest.id !== 'core')?.manifest.id ?? 'core';
    return fail(packName, (e as Error).message);
  }

  const raw: Plain = {
    ...Object.fromEntries(ENTITY_LISTS.map((l) => [l, lists[l] ?? []])),
    market: keyed.market,
    shop: keyed.shop,
    coat: keyed.coat,
    cellKeys,
    ai,
    balance,
  };
  const parsed = contentDbSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? first.path.join('.') : '';
    const list = String(first?.path[0] ?? '');
    const id =
      typeof first?.path[1] === 'number'
        ? String((lists[list]?.[first.path[1]] ?? {}).id ?? '')
        : '';
    const owner = owners.get(`${list}:${id}`) ?? ordered[0]?.manifest.id ?? 'core';
    return fail(owner, `after composing and patching: ${where}: ${issues(parsed.error)}`);
  }

  const db: ContentDb = {
    ...parsed.data,
    packs: ordered.map((p): PackManifest => clone(p.manifest)),
    modifierKeys,
    icons,
    locales: { uk, en },
  };

  const problems = validateClosure(db, {
    owner: (list, id) => owners.get(`${list}:${id}`) ?? 'core',
    described: DESCRIBED,
  });
  if (problems.length > 0)
    throw new Error(
      `Content closure failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n${problems
        .slice(0, 20)
        .map((p) => `  - pack "${p.pack}": ${p.message}`)
        .join('\n')}`,
    );
  return db;
}
