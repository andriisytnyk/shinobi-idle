import { ukLocale } from '@shinobi/content';

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

/** Translates a key with `{name}` interpolation and Ukrainian plural support. */
export const t = createTranslator(ukLocale);

/** Whether a key has a translation. */
export const hasKey = (key: string): boolean => Object.hasOwn(ukLocale, key);
