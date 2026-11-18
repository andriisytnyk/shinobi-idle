import type { ContentDb, RenownRank } from '@shinobi/content';
import { addItem } from './bank.ts';
import { emit } from './events.ts';
import type { Modifier, ModifierProvider } from './modifiers.ts';
import { rewardScroll } from './scrolls.ts';
import type { GameState } from './state.ts';
import { currencyOf } from './vocab.ts';

/** The flag that says a Renown rank was reached. */
export const renownFlag = (id: string): string => `renownRank.${id}`;

/** The ranks in the order of their thresholds (ties keep the order of the content). */
export function renownLadder(content: ContentDb): RenownRank[] {
  const cached = ladders.get(content);
  if (cached) return cached;
  const sorted = content.renownRanks
    .map((rank, n) => ({ rank, n }))
    .sort((a, b) => a.rank.renown - b.rank.renown || a.n - b.n)
    .map((x) => x.rank);
  ladders.set(content, sorted);
  return sorted;
}

const ladders = new WeakMap<ContentDb, RenownRank[]>();

/** The Reputation the player holds: the balance of the currency with the role `renown`. */
export function renownOf(state: GameState, content: ContentDb): number {
  const currency = currencyOf(content, 'renown');
  return currency === null ? 0 : (state.currencies[currency] ?? 0);
}

export const hasRenownRank = (state: GameState, id: string): boolean =>
  state.flags[renownFlag(id)] !== undefined;

function pay(state: GameState, rank: RenownRank, content: ContentDb): void {
  const { rewards } = rank;
  for (const { item, n } of rewards.items) {
    if (addItem(state, item, n)) emit(state, { type: 'itemGained', id: item, n });
  }
  if (rewards.scroll) {
    const scroll = rewardScroll(state, rewards.scroll.library, content);
    if (scroll && addItem(state, scroll, 1)) emit(state, { type: 'itemGained', id: scroll, n: 1 });
  }
  for (const flag of rewards.flags) state.flags[flag] = true;
}

/**
 * Grants every Renown rank whose threshold the Reputation has reached and that is not held yet,
 * in the order of the thresholds, each once. Returns whether any was granted. After a long
 * absence several ranks fall at once and come out in order.
 */
export function updateRenownRanks(state: GameState, content: ContentDb): boolean {
  if (content.renownRanks.length === 0) return false;
  const renown = renownOf(state, content);
  let granted = false;
  for (const rank of renownLadder(content)) {
    if (rank.renown > renown) break;
    if (hasRenownRank(state, rank.id)) continue;
    state.flags[renownFlag(rank.id)] = true;
    pay(state, rank, content);
    emit(state, { type: 'renownRank', rank: rank.id });
    granted = true;
  }
  return granted;
}

/** The modifiers of the Renown ranks held (a discount in the shop). */
export const renownProvider: ModifierProvider = (state, content) => {
  const out: Modifier[] = [];
  for (const rank of content.renownRanks) {
    if (!hasRenownRank(state, rank.id)) continue;
    for (const m of rank.rewards.mods) {
      if (m.nature !== undefined && !state.player.natures.includes(m.nature)) continue;
      out.push({
        key: m.key,
        op: m.op,
        value: m.value,
        group: 'character',
        source: `renownRank.${rank.id}`,
      });
    }
  }
  return out;
};
