import type { ContentDb } from '@shinobi/content';
import type { EntityRef } from './route.ts';
import { skillByActivity } from './vocab.ts';

/** One line of "where it comes from" or "where it is used": a link, or plain text for places without a page. */
export interface ItemRelation {
  ref?: EntityRef;
  /** Localization key of the text when there is no link. */
  textKey?: string;
  /** How many items are involved, where that matters. */
  n?: number;
}

export interface ItemRelations {
  sources: ItemRelation[];
  usedIn: ItemRelation[];
}

/** Collects where an item comes from and where it is used, straight from the content tables. */
export function itemRelations(id: string, content: ContentDb): ItemRelations {
  const sources: ItemRelation[] = [];
  const usedIn: ItemRelation[] = [];

  const gatherer = skillByActivity(content, 'patch');
  for (const herb of content.herbs) {
    if (herb.id === id && gatherer) sources.push({ ref: { kind: 'skill', id: gatherer } });
  }
  for (const recipe of content.recipes) {
    if (recipe.output.item === id)
      sources.push({ ref: { kind: 'recipe', id: recipe.id }, n: recipe.output.n });
    const ingredient = recipe.ingredients.find((i) => i.item === id);
    if (ingredient) usedIn.push({ ref: { kind: 'recipe', id: recipe.id }, n: ingredient.n });
  }
  for (const mission of content.missions) {
    if (mission.pay.some((p) => p.kind === 'item' && p.item === id)) {
      sources.push({ ref: { kind: 'mission', id: mission.id } });
    }
    if (mission.stages.some((s) => s.t === 'items' && s.item === id)) {
      usedIn.push({ ref: { kind: 'mission', id: mission.id } });
    }
  }
  for (const entry of content.market) {
    if (entry.item !== id) continue;
    sources.push(
      entry.supplier
        ? { ref: { kind: 'building', id: entry.supplier } }
        : { textKey: 'item.source.market' },
    );
  }
  const item = content.items.find((i) => i.id === id);
  for (const extra of item?.extraSources ?? []) sources.push({ textKey: `item.source.${extra}` });
  for (const made of content.items) {
    const part = made.madeFrom.find((m) => m.item === id);
    if (part) usedIn.push({ ref: { kind: 'item', id: made.id }, n: part.n });
  }
  for (const part of item?.madeFrom ?? []) {
    sources.push({ ref: { kind: 'item', id: part.item }, n: part.n });
  }
  return { sources, usedIn };
}
