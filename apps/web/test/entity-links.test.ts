import { composeBoot } from '../src/lib/boot.ts';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { findEntity, entityRefsIn } from '../src/lib/entity-data.ts';
import { hrefFor, parseHash } from '../src/lib/route.ts';
import { game } from '../src/lib/store.ts';
import EntityPage from '../src/pages/EntityPage.svelte';
import { coreContext } from './helpers/core-registry.ts';

/*
 * The generic entity page lists, as links, the entities that an entity's data names, and shows a
 * requirement tree. It serves every kind that has no page of its own, so every link it can show for
 * a core entity must land on a real entity: a walk over all of them.
 */

const content = composeBoot().content;
const GENERIC = [
  'boss',
  'combo',
  'status',
  'practice',
  'exercise',
  'obstacle',
  'trait',
  'seal',
  'enemy',
];
const lists = content as unknown as Record<string, readonly { id: string }[] | undefined>;

describe('the generic entity page, over every core entity of its kinds', () => {
  for (const kind of GENERIC) {
    const list = content.entityKinds.find((k) => k.id === kind)?.list;
    const entities = (list ? lists[list] : undefined) ?? [];
    it(`${kind}: renders, and every link lands on a real entity`, () => {
      expect(entities.length).toBeGreaterThan(0);
      for (const entity of entities) {
        const ref = { kind, id: entity.id };
        const data = findEntity(content, ref);
        expect(data, `${kind} ${entity.id}`).not.toBeNull();
        const links = entityRefsIn(data, content, ref);
        const body = render(EntityPage, { props: { entity: ref }, context: coreContext() }).body;
        expect(body).not.toContain('data-not-found');
        for (const link of links) {
          expect(
            findEntity(content, link),
            `${kind} ${entity.id} -> ${link.kind} ${link.id}`,
          ).not.toBeNull();
          // The hash that the link carries parses back to the same entity.
          const route = parseHash(hrefFor(link));
          expect(route).toEqual({ page: 'entity', ref: link });
          expect(body).toContain(`href="${hrefFor(link)}"`);
        }
      }
    });
  }

  it('is mounted against the content of the running game', () => {
    expect(game.content.entityKinds.length).toBe(content.entityKinds.length);
  });
});
