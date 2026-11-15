import type { ContentDb, Item } from '@shinobi/content';
import { addEffect, removeEffect } from './fight-effects.ts';
import {
  alive,
  applyBind,
  cancelCasts,
  count,
  dealDamage,
  pickTarget,
  roll,
  rollHit,
  secWork,
  stat,
} from './fight.ts';
import type { Combatant, FightCtx, FightState } from './fight-types.ts';
import { hitChance } from './numbers.ts';
import { TICK_MS, workOf } from './units.ts';

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

/** How an item acts in a fight, or null when it cannot ride in the pouch. */
export function pouchUse(item: Item): string | null {
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
  if (item.tags.includes('area')) return 'area';
  if (item.tags.includes('bind')) return 'bind';
  if (item.tags.includes('dot')) return 'dot';
  return 'throw';
}

/** What the AI sees of an item in the pouch. */
export function itemView(content: ContentDb, id: string): { tags: string[]; use: string } | null {
  const item = itemOf(content, id);
  const use = item ? pouchUse(item) : null;
  return item && use ? { tags: [...item.tags], use } : null;
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
  const use = item ? pouchUse(item) : null;
  if (!item || !use) return false;
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
      if (fx?.kind === 'cleanse') for (const status of fx.statuses) removeEffect(player, status);
      return true;
    case 'dispel':
      removeEffect(player, 'illusion');
      return true;
    case 'bomb':
      if (fx?.kind === 'bomb') {
        if (fx.target === 'self') addBomb(fight, player, id, fx.stat, fx.mult, fx.durationMs);
        else for (const e of living) addBomb(fight, e, id, fx.stat, fx.mult, fx.durationMs);
      }
      if (item.tags.includes('interrupt')) {
        let any = false;
        for (const e of living) any = cancelCasts(ctx, e, true) || any;
        if (any) fight.tally.interrupts++;
      }
      return true;
    case 'sleep':
      // A sleeping powder works on an ordinary enemy, by chance: it is stunned for a while.
      if (first && ordinary(content, first) && roll(fight, K.itemFx.sleep.chance)) {
        addEffect(first, {
          kind: 'modifier',
          id: 'stun',
          src: id,
          until: fight.t + secWork(K.stun.C),
          stat: 'speed',
          op: 'mul',
          value: 0,
        });
        cancelCasts(ctx, first);
        count(fight.tally.statuses, 'stun');
      }
      return true;
    case 'area':
      for (const e of living) dealDamage(ctx, e, fight.kit.toolDamage, id);
      return true;
    case 'bind':
      for (const e of living) applyBind(ctx, e, K.bindEva, id);
      return true;
    case 'dot':
      if (first) {
        addEffect(first, {
          kind: 'periodic',
          id: 'toolPoison',
          src: id,
          until: fight.t + secWork(K.toolFx.dot.durS),
          suppresses: 'regen',
          mode: 'damage',
          amount: K.toolFx.dot.pct * first.maxHp,
          every: workOf(TICK_MS),
          next: fight.t + workOf(TICK_MS),
        });
      }
      return true;
    default: {
      // A thrown tool: an interrupting one always stops a cast, the damage needs a hit.
      if (!first) return true;
      if (item.tags.includes('interrupt') && cancelCasts(ctx, first, true)) {
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
