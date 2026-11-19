const MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia',
  '’': '',
  "'": '',
  ʼ: '',
};

/** Deterministic ASCII slug from a Ukrainian (or already ASCII) name. */
export function slugify(name: string): string {
  let out = '';
  for (const ch of name.toLowerCase()) {
    out += MAP[ch] ?? ch;
  }
  return out.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export type IdTable = Record<string, Record<string, string>>;

/**
 * Explicit, committed id registry: entity kind -> source key (Ukrainian name) -> slug.
 * The importer takes every transliterated id from here, so a copy-edit of a name can never
 * rename an id silently. New entities need `--assign-ids`, which appends transliterated slugs.
 */
export class IdRegistry {
  dirty = false;

  constructor(
    readonly table: IdTable,
    private readonly assign: boolean,
  ) {}

  take(kind: string, key: string, forced?: string): string {
    const entries = (this.table[kind] ??= {});
    const existing = entries[key];
    if (existing !== undefined) return existing;
    if (!this.assign) {
      throw new Error(
        `Import: no id registered for ${kind} "${key}". ` +
          `Add it to src/data/id-registry.json or run the import with --assign-ids.`,
      );
    }
    const base = forced ?? slugify(key);
    if (base === '') throw new Error(`Cannot derive an id from "${key}"`);
    const used = new Set(Object.values(entries));
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}_${n++}`;
    entries[key] = slug;
    this.dirty = true;
    return slug;
  }
}
