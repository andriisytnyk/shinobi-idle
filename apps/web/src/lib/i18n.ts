import { tryActiveContent } from './active.ts';

export type Params = Record<string, string | number>;

type Messages = Readonly<Record<string, string>>;

const pluralRules = new Intl.PluralRules('uk');

/** Finds the index of the `}` that closes the `{` at `open`. */
function closeBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Parses the clauses of a plural block, e.g. `one {день} few {дні} other {днів}`.
 * Returns category -> text. Exact matches look like `=0 {нічого}`.
 */
function parseClauses(body: string): Map<string, string> {
  const clauses = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    const label = body.slice(i, open).trim();
    const close = closeBrace(body, open);
    if (close === -1) break;
    clauses.set(label, body.slice(open + 1, close));
    i = close + 1;
  }
  return clauses;
}

function format(template: string, params: Params, messages: Messages): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== '{') {
      out += ch;
      i++;
      continue;
    }
    const close = closeBrace(template, i);
    if (close === -1) {
      out += template.slice(i);
      break;
    }
    const inner = template.slice(i + 1, close);
    const comma = inner.indexOf(',');
    if (comma === -1) {
      const value = params[inner.trim()];
      out += value === undefined ? `{${inner}}` : String(value);
    } else {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1).trim();
      if (rest.startsWith('plural')) {
        const clauses = parseClauses(rest.slice('plural'.length).replace(/^\s*,/, ''));
        const n = Number(params[name]);
        const chosen =
          clauses.get(`=${n}`) ?? clauses.get(pluralRules.select(n)) ?? clauses.get('other') ?? '';
        out += format(chosen, params, messages);
      } else {
        out += `{${inner}}`;
      }
    }
    i = close + 1;
  }
  return out;
}

/** Builds a translator over a message table. Unknown keys come back as the key itself. */
export function createTranslator(messages: Messages) {
  return (key: string, params: Params = {}): string => {
    const template = Object.hasOwn(messages, key) ? messages[key] : undefined;
    if (template === undefined) return key;
    return format(template, params, messages);
  };
}

/** The Ukrainian strings of the running game: the merged locales of its packs. */
const messages = (): Messages => tryActiveContent()?.locales.uk ?? {};

/** Keys that were asked for and are missing, in the order they were first asked (for tests and the dev console). */
const missing = new Set<string>();
export const missingKeys = (): readonly string[] => [...missing];
export const clearMissingKeys = (): void => missing.clear();

/**
 * A readable stand-in for a key that has no text: the last part of the entity id, or the last
 * part of the key, with the underscores and dashes turned into spaces (`skill.testmod:forge.name`
 * reads «Forge»). A key is never shown as it is.
 */
export function fallbackText(key: string): string {
  const parts = key.split('.');
  // The field of an entity text (`.name`, `.desc`) says nothing about what it is.
  while (parts.length > 1 && /^(name|desc|note|home|place|client|unlock)$/.test(parts.at(-1) ?? ''))
    parts.pop();
  const idPart = parts.find((p) => p.includes(':'));
  const raw = (idPart ? idPart.slice(idPart.lastIndexOf(':') + 1) : (parts.at(-1) ?? key)) || key;
  const spaced = raw.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Says once per key, in the dev build only, that a text is missing. */
export function reportMissing(key: string): void {
  if (missing.has(key)) return;
  missing.add(key);
  if (import.meta.env?.DEV) console.warn(`Missing text: ${key}`);
}

/**
 * Translates a key with `{name}` interpolation and Ukrainian plural support. A key without a text
 * shows a readable stand-in (see `fallbackText`) and is reported once in the dev build.
 */
export function t(key: string, params: Params = {}): string {
  const table = messages();
  const template = Object.hasOwn(table, key) ? table[key] : undefined;
  if (template === undefined) {
    reportMissing(key);
    return fallbackText(key);
  }
  return format(template, params, table);
}

/** Whether a key has a translation. */
export const hasKey = (key: string): boolean => Object.hasOwn(messages(), key);

/** The text of the first of these keys that has one; with none, the stand-in for the first key. */
export function textOf(keys: readonly string[], params: Params = {}): string {
  const key = keys.find(hasKey) ?? keys[0] ?? '';
  return t(key, params);
}
