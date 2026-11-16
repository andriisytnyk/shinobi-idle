/**
 * The game addresses the player as «ти»: no Ukrainian text of the core pack may use the formal
 * «Ви» forms or a plural imperative. A word that only looks like one goes into ALLOWED, each with
 * the reason it is legitimate.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = join(import.meta.dirname, '../src/packs/core/locales');

/** A letter of a Ukrainian word, apostrophes included. */
const L = "[\\p{L}'’ʼ]";

/** The patterns of formal address; each matches whole words, case-insensitively. */
export const FORMAL_PATTERNS: readonly { name: string; re: RegExp }[] = [
  {
    name: 'pronoun Ви/Вас/Вам/Вами',
    re: new RegExp(`(?<!${L})(?:ви|вас|вам|вами)(?!${L})`, 'giu'),
  },
  { name: 'possessive Ваш…', re: new RegExp(`(?<!${L})ваш${L}*`, 'giu') },
  {
    name: 'plural imperative (-іть, -йте, -ьте, -жте, -чте, -ште)',
    re: new RegExp(`(?<!${L})${L}+(?:іть|йте|ьте|жте|чте|ште|іться|йтесь|ьтесь)(?!${L})`, 'giu'),
  },
  {
    name: 'second person plural (-ете, -єте, -ите)',
    re: new RegExp(`(?<!${L})${L}+(?:ете|єте|ите)(?!${L})`, 'giu'),
  },
];

/** Words that match a pattern but are not formal address. Keyed by the lower-case word. */
export const ALLOWED: Readonly<Record<string, string>> = {
  навіть: 'the particle «навіть» («even»), not an imperative',
};

function* strings(value: unknown, path: string): Generator<[string, string]> {
  if (typeof value === 'string') yield [path, value];
  else if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) yield* strings(inner, `${path}.${key}`);
  }
}

/** Every formal-address hit of a text, as `[pattern name, word]`, allowed words left out. */
export function formalHits(text: string): [string, string][] {
  const hits: [string, string][] = [];
  for (const { name, re } of FORMAL_PATTERNS) {
    for (const match of text.matchAll(re)) {
      if (!(match[0].toLowerCase() in ALLOWED)) hits.push([name, match[0]]);
    }
  }
  return hits;
}

const files = readdirSync(LOCALES).filter((f) => f === 'uk.json' || f.endsWith('.uk.json'));

describe('informal address', () => {
  it('finds the Ukrainian locale files of the core pack', () => {
    expect(files).toEqual(expect.arrayContaining(['ui.uk.json', 'content.uk.json', 'uk.json']));
  });

  it('flags formal forms and lets informal ones pass', () => {
    expect(formalHits('Ви — учень Академії.')).toEqual([['pronoun Ви/Вас/Вам/Вами', 'Ви']]);
    expect(formalHits('Як вас звати?')).toHaveLength(1);
    expect(formalHits('Ваші предмети.')).toHaveLength(1);
    expect(formalHits('Відкрийте сторінку й натисніть кнопку.')).toHaveLength(2);
    expect(formalHits('Стежте за нею.')).toHaveLength(1);
    expect(formalHits('Ви знаєте це?')).toHaveLength(2);
    expect(formalHits('Ти — учень. Натисни кнопку й обери мету, навіть якщо вона далека.')).toEqual(
      [],
    );
    expect(formalHits('Кущ відростає: збір стоїть.')).toEqual([]);
  });

  for (const file of files) {
    it(`${file} has no formal address`, () => {
      const json: unknown = JSON.parse(readFileSync(join(LOCALES, file), 'utf8'));
      const found: string[] = [];
      for (const [path, text] of strings(json, '')) {
        for (const [name, word] of formalHits(text)) found.push(`${path}: «${word}» (${name})`);
      }
      expect(found).toEqual([]);
    });
  }
});
