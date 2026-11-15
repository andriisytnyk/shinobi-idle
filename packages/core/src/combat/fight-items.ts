import type { ContentDb, Item } from '@shinobi/content';
import { addEffect } from './fight-effects.ts';
import {
  alive,
  cancelCasts,
  count,
  dealDamage,
  pickTarget,
  roll,
  rollHit,
  stat,
} from './fight.ts';
import { fightData } from './fight-data.ts';
import { applyStatus, removeStatus, removeTagged, runTagOps } from './fight-status.ts';
import type { Combatant, FightCtx, FightState } from './fight-types.ts';
import { hitChance } from './numbers.ts';
import { workOf } from './units.ts';

/*
 * Tools and pills in a fight. What an item does comes from its data (its effect, its tags) and the
 * numbers of the balance object; no item is named here. A use takes one unit from the pouch.
 */

const itemCache = new WeakMap<ContentDb, Map<string, Item>>();

/** The item of the content with this id; the fight engine keeps its own index so it never reads the game's. */
function itemOf(content: ContentDb, id: string): Item | undefined {
  let items = itemCache.get(content);
  if (!items) {
    items = new Map(content.items.map((i) => [i.id, i]));
    itemCache.set(content, items);
  }
  return items.get(id);
}

/**
 * How an item acts in a fight, or null when it cannot ride in the pouch. A tool's tags say what it
 * does when the content is known (`sweep`, `snare`, `venom`); without it a tool is a thrown one.
 */
export function pouchUse(item: Item, content?: ContentDb): string | null {
  const fx = item.fx;
  if (fx) {
    switch (fx.kind) {
      case 'heal':
      case 'restore':
      case 'cleanse':
      case 'dispel':
      case 'bomb':
      case 'sleep':
        return fx.kind;
      default:
        break;
    }
  }
  if (!item.pouch) return null;
  if (content) {
    const tags = fightData(content).tags;
    for (const tag of item.tags) {
      const use = tags.get(tag)?.pouch;
      if (use) return use;
    }
  }
  return 'throw';
}

/**
 * Whether an item answers a trait when used from the pouch: it carries the tag that counters the
 * trait and rides in the pouch (a sleeping powder is for the player to use by hand, not an answer).
 */
export function itemAnswers(item: Item, trait: string, content: ContentDb): boolean {
  const use = pouchUse(item, content);
  if (use === null || use === 'sleep') return false;
  const def = fightData(content).traits.get(trait);
  return def !== undefined && (item.tags as readonly string[]).includes(def.answer);
}

/** What the AI sees of an item in the pouch. */
export interface ItemFacts {
  tags: readonly string[];
  use: string;
  answers: readonly string[];
  interrupts: boolean;
  guard: boolean;
}

const itemFacts = new WeakMap<ContentDb, Map<string, ItemFacts | null>>();

export function itemView(content: ContentDb, id: string): ItemFacts | null {
  let facts = itemFacts.get(content);
  if (!facts) {
    facts = new Map();
    itemFacts.set(content, facts);
  }
  const have = facts.get(id);
  if (have !== undefined) return have;
  const item = itemOf(content, id);
  const use = item ? pouchUse(item, content) : null;
  let made: ItemFacts | null = null;
  if (item && use) {
    const data = fightData(content);
    made = Object.freeze({
      tags: Object.freeze([...item.tags]),
      use,
      answers: Object.freeze([...data.traits.keys()].filter((t) => itemAnswers(item, t, content))),
      interrupts: item.tags.some((tag) => data.tags.get(tag)?.interrupts === true),
      guard: item.tags.some((tag) => data.tags.get(tag)?.guard === true),
    });
  }
  facts.set(id, made);
  return made;
}

/** Whether a body is an ordinary enemy rather than a boss. */
const ordinary = (content: ContentDb, c: Combatant): boolean =>
  !content.bosses.some((b) => b.id === c.entry);

function addBomb(
  fight: FightState,
  target: Combatant,
  id: string,
  stat_: 'evasion' | 'accuracy',
  mult: number,
  durationMs: number,
): void {
  addEffect(target, {
    kind: 'modifier',
    id: `bomb.${stat_}`,
    src: id,
    until: fight.t + workOf(durationMs),
    stat: stat_,
    op: 'mul',
    value: mult,
  });
}

/**
 * Applies one use of an item to the fight. Returns false, changing nothing, when the item has no
 * use in a fight. Time and the pouch count are the caller's.
 */
export function applyItem(ctx: FightCtx, id: string): boolean {
  const { fight, content } = ctx;
  const K = content.balance.K;
  const item = itemOf(content, id);
  const use = item ? pouchUse(item, content) : null;
  if (!item || !use) return false;
  const data = fightData(content);
  const interrupts = item.tags.some((tag) => data.tags.get(tag)?.interrupts === true);
  const player = fight.player;
  const fx = item.fx;
  const living = fight.enemies.filter(alive);
  const first = pickTarget(fight, fight.target);
  switch (use) {
    case 'heal':
      if (fx?.kind === 'heal') {
        player.hp = Math.min(player.maxHp, player.hp + fx.hp);
        fight.tally.woundMin += fx.woundMin ?? 0;
      }
      return true;
    case 'restore':
      if (fx?.kind === 'restore') {
        player.chakra = Math.min(player.maxChakra, player.chakra + (fx.chakra ?? 0));
        player.stamina = Math.min(player.maxStamina, player.stamina + (fx.stamina ?? 0));
      }
      return true;
    case 'cleanse':
      if (fx?.kind === 'cleanse') {
        for (const status of fx.statuses) removeStatus(player, status);
        // An ointment against burns also hardens the skin against that nature for a while.
        if (fx.resist) {
          addEffect(player, {
            kind: 'modifier',
            id: 'resist',
            src: id,
            until: fight.t + workOf(fx.resist.durationMs),
            stat: 'resist',
            op: 'mul',
            value: K.toolFx.resist,
            nature: fx.resist.nature,
          });
        }
      }
      return true;
    case 'dispel':
      // What the item answers is what its tag takes off the player.
      if (fx?.kind === 'dispel') removeTagged(player, data.tags.get(fx.tag)?.removes ?? []);
      return true;
    case 'bomb':
      if (fx?.kind === 'bomb') {
        if (fx.target === 'self') addBomb(fight, player, id, fx.stat, fx.mult, fx.durationMs);
        else for (const e of living) addBomb(fight, e, id, fx.stat, fx.mult, fx.durationMs);
      }
      if (interrupts) {
        let any = false;
        for (const e of living) any = cancelCasts(ctx, e, true) || any;
        if (any) fight.tally.interrupts++;
      }
      return true;
    case 'sleep':
      // A sleeping powder works on an ordinary enemy, by chance: it is stunned for a while.
      if (fx?.kind === 'sleep' && first && ordinary(content, first)) {
        const chance = (K.itemFx[fx.fx] as { chance?: number } | undefined)?.chance ?? 0;
        const status = fx.status === undefined ? undefined : data.statuses.get(fx.status);
        if (roll(fight, chance) && status) {
          applyStatus(ctx, first, status, id, { rank: fx.rank ?? null });
        }
      }
      return true;
    case 'sweep':
      for (const e of living) dealDamage(ctx, e, fight.kit.toolDamage, id);
      return true;
    case 'snare':
    case 'venom': {
      // The tool does what its tag says: a snare on every body, a venom on the one aimed at.
      const ops = item.tags.flatMap((tag) => {
        const def = data.tags.get(tag);
        return def?.pouch === use ? def.onUse : [];
      });
      if (use === 'snare') for (const e of living) runTagOps(ctx, e, ops, id);
      else if (first) runTagOps(ctx, first, ops, id);
      return true;
    }
    default: {
      // A thrown tool: an interrupting one always stops a cast, the damage needs a hit.
      if (!first) return true;
      if (interrupts && cancelCasts(ctx, first, true)) {
        fight.tally.interrupts++;
      }
      const chance = hitChance(
        stat(ctx, player, 'accuracy', player.accuracy),
        stat(ctx, first, 'evasion', first.evasion),
        content,
      );
      if (rollHit(ctx, first, chance)) dealDamage(ctx, first, fight.kit.toolDamage, id);
      return true;
    }
  }
}

/**
 * The player empties a healing or restoring slot by hand: at once, with no action time. Returns
 * a localization key when it cannot be done, null when it was.
 */
export function useSlotByHand(ctx: FightCtx, slot: number): string | null {
  const { fight, content } = ctx;
  const entry = fight.pouch[slot];
  if (fight.result !== 'ongoing') return 'error.notFighting';
  if (!entry || entry.n < 1) return 'error.emptySlot';
  const use = itemView(content, entry.id)?.use;
  if (use !== 'heal' && use !== 'restore') return 'error.itemNotUsable';
  if (!applyItem(ctx, entry.id)) return 'error.itemNotUsable';
  entry.n--;
  count(fight.tally.uses, entry.id);
  return null;
}
