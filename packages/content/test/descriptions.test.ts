/** Descriptions: every listed kind has a plain Ukrainian text of one or two sentences. */
import { describe, expect, it } from 'vitest';
import { content, ukLocale } from '../src/index.ts';
import { descProblems } from './helpers.ts';

const KINDS: [string, readonly { id: string }[]][] = [
  ['technique', content.techniques],
  ['skill', content.skills],
  ['item', content.items],
  ['enemy', content.enemies],
  ['boss', content.bosses],
  ['building', content.buildings],
  ['resource', content.resources],
  ['region', content.regions],
  ['seal', content.seals],
  ['status', content.statuses],
  ['trait', content.traits],
  ['combo', content.combos],
  ['operation', content.operations],
];

/** A zone is exempt from own texts: it shows the name and description of its enemy. */

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
    expect(descProblems('Станеться через 5 секунд після удару.')).toContain('contains a number');
    expect(descProblems('Blood Increasing Pill для відновлення сил.')).toContain(
      'contains Latin words',
    );
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

  it('lets a zone borrow the name and description of its enemy', () => {
    const all = new Map([...content.enemies, ...content.bosses].map((e) => [e.id, e.id]));
    const kindOf = (id: string) => (content.bosses.some((b) => b.id === id) ? 'boss' : 'enemy');
    for (const z of content.zones) {
      expect(all.has(z.enemy), `zone ${z.id}: enemy ${z.enemy}`).toBe(true);
      const kind = kindOf(z.enemy);
      expect(descProblems(ukLocale[`${kind}.${z.enemy}.desc`]), z.id).toEqual([]);
      expect(ukLocale[`${kind}.${z.enemy}.name`], z.id).toBeTruthy();
      expect(ukLocale[`zone.${z.id}.name`], z.id).toBeUndefined();
    }
  });
});
