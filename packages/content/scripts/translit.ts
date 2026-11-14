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

/** Hands out unique slugs within one namespace; a collision gets a numeric suffix. */
export class SlugRegistry {
  private readonly used = new Set<string>();

  take(name: string, forced?: string): string {
    const base = forced ?? slugify(name);
    if (base === '') throw new Error(`Cannot derive a slug from "${name}"`);
    let slug = base;
    let n = 2;
    while (this.used.has(slug)) slug = `${base}_${n++}`;
    this.used.add(slug);
    return slug;
  }
}
