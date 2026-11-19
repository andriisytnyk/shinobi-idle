/** R1: reveal rules are data, so the closure validator checks them: terms that fit the kind, requirement trees that close, kinds that exist. */
import { describe, expect, it } from 'vitest';
import { testmodPack } from '@shinobi/content/testmod';
import { composeContent, content, corePack, type ContentPack } from '../src/index.ts';
import { throwsFor } from './pack-helpers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test data is mutated loosely
type Loose = Omit<ContentPack, 'data' | 'manifest'> & { data: Record<string, any>; manifest: any };

const tm = (change: (pack: Loose) => void): ContentPack => {
  const copy = JSON.parse(JSON.stringify(testmodPack)) as Loose;
  change(copy);
  return copy as unknown as ContentPack;
};
const item = (p: Loose, id: string) => p.data.items.find((i: { id: string }) => i.id === id);

describe('the reveal rules of the core pack', () => {
  it('compose, and every kind that hides something has a rule that its own list can satisfy', () => {
    const kinds = Object.fromEntries(content.entityKinds.map((k) => [k.id, k.reveal]));
    expect(kinds.enemy?.full).toEqual(['encountered']);
    expect(kinds.boss?.full).toEqual(['encountered']);
    expect(kinds.region?.full).toEqual(['explored']);
    expect(kinds.quest?.full).toEqual(['questStarted']);
    // The kinds the author decided to show always have no rule at all.
    for (const open of ['skill', 'technique', 'building', 'status', 'trait', 'combo', 'seal']) {
      expect(kinds[open], open).toBeUndefined();
    }
  });

  it('the test pack composes with its explicit rule and its pack default', () => {
    const both = composeContent([corePack, testmodPack]);
    expect(both.items.find((i) => i.id === 'testmod:elixir')?.reveal?.full).toHaveLength(1);
    expect(both.packs.find((p) => p.id === 'testmod')?.reveal?.item).toEqual({ full: ['owned'] });
  });
});

describe('a reveal rule that does not close is an error that names the pack', () => {
  it('a term that does not fit the kind', () => {
    throwsFor(
      [
        corePack,
        tm((p) => {
          item(p, 'testmod:charm').reveal = { full: ['encountered'] };
        }),
      ],
      'testmod',
      /testmod:charm.*"encountered" does not apply to the kind "item"/,
    );
    throwsFor(
      [
        corePack,
        tm((p) => {
          p.manifest.reveal = { item: { full: ['explored'] } };
        }),
      ],
      'testmod',
      /manifest reveal\.item.*"explored" does not apply/,
    );
  });

  it('a requirement tree that names something that is not there', () => {
    throwsFor(
      [
        corePack,
        tm((p) => {
          item(p, 'testmod:elixir').reveal = {
            full: [{ req: { t: 'skill', skill: 'testmod:nothing', level: 2 } }],
          };
        }),
      ],
      'testmod',
      /testmod:elixir.*testmod:nothing/,
    );
  });

  it('a kind the database does not have', () => {
    throwsFor(
      [
        corePack,
        tm((p) => {
          p.manifest.reveal = { dragon: { full: ['always'] } };
        }),
      ],
      'testmod',
      /"dragon" is not a known entity kind/,
    );
  });

  it('a term that the engine does not know, and a rule with no full part', () => {
    throwsFor(
      [
        corePack,
        tm((p) => {
          item(p, 'testmod:charm').reveal = { full: ['sometimes'] };
        }),
      ],
      'testmod',
      /testmod/,
    );
    throwsFor(
      [
        corePack,
        tm((p) => {
          item(p, 'testmod:charm').reveal = { name: ['always'] };
        }),
      ],
      'testmod',
      /testmod/,
    );
  });
});
