/** Descriptions: every listed kind has a plain Ukrainian text of one or two sentences. */
import { describe, expect, it } from 'vitest';
import { content, ukLocale } from '../src/index.ts';

/** Problems of one description; an empty list means it is fine. */
function descProblems(text: string | undefined): string[] {
  if (text === undefined || text.trim() === '') return ['empty'];
  const problems: string[] = [];
  if (text.trim().length < 20) problems.push('shorter than 20 characters');
  if (/todo|tbd|lorem|fixme|xxx/i.test(text)) problems.push('placeholder');
  if (!/[а-яіїєґ]/i.test(text)) problems.push('no Ukrainian letters');
  const sentences = text.split(/[.!?…]+(?=\s|$)/).filter((s) => s.trim() !== '');
  if (sentences.length > 2) problems.push(`${sentences.length} sentences`);
  return problems;
}

const KINDS: [string, readonly { id: string }[]][] = [
  ['technique', content.techniques],
  ['skill', content.skills],
  ['item', content.items],
  ['enemy', content.enemies],
  ['boss', content.bosses],
  ['building', content.buildings],
  ['region', content.regions],
  ['seal', content.seals],
  ['status', content.statuses],
  ['trait', content.traits],
  ['combo', content.combos],
  ['operation', content.operations],
];

describe('description rules', () => {
  it('reject empty, short, placeholder, Latin-only and long texts', () => {
    expect(descProblems(undefined)).toContain('empty');
    expect(descProblems('')).toContain('empty');
    expect(descProblems('Занадто коротко.')).toContain('shorter than 20 characters');
    expect(descProblems('TODO: написати опис для цієї сутності.')).toContain('placeholder');
    expect(descProblems('A plain English description of the thing.')).toContain(
      'no Ukrainian letters',
    );
    expect(descProblems('Перше речення. Друге речення. Третє речення.')).toContain('3 sentences');
    expect(descProblems('Одне речення про щось корисне. І ще одне речення.')).toEqual([]);
  });
});

describe('descriptions of content entities', () => {
  it('covers the expected number of entities', () => {
    expect(content.techniques).toHaveLength(60);
    expect(content.skills).toHaveLength(16);
    expect(content.enemies).toHaveLength(24);
    expect(content.bosses).toHaveLength(8);
    expect(content.buildings).toHaveLength(16);
    expect(content.regions).toHaveLength(3);
    expect(content.seals).toHaveLength(17);
    expect(content.statuses).toHaveLength(5);
    expect(content.traits).toHaveLength(8);
  });

  for (const [kind, list] of KINDS) {
    it(`gives every ${kind} a valid description and a name`, () => {
      for (const e of list) {
        const problems = descProblems(ukLocale[`${kind}.${e.id}.desc`]);
        expect(
          problems,
          `${kind} ${e.id}: ${ukLocale[`${kind}.${e.id}.desc`] ?? 'no desc'}`,
        ).toEqual([]);
        expect(ukLocale[`${kind}.${e.id}.name`], `${kind} ${e.id} name`).toBeTruthy();
      }
    });
  }
});
