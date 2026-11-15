<script lang="ts">
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { currencyName, moneyOf } from '../lib/vocab.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** An amount of the money currency (the field the content calls `ryo`). */
    money?: number;
    /** Amounts of other currencies, by id. */
    currencies?: Readonly<Record<string, number>>;
    items?: readonly { id: string; n: number }[];
  }

  let { money = 0, currencies = {}, items = [] }: Props = $props();

  /** Every currency payout, the money first; a currency is named in the nominative and the amount follows. */
  const payouts = $derived([
    ...(money > 0 ? [{ id: moneyOf(game.content), n: money }] : []),
    ...Object.entries(currencies)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => ({ id, n })),
  ]);
</script>

{#each payouts as payout (payout.id)}
  <span data-reward="currency" data-currency={payout.id}
    >{t('reward.currency', { currency: currencyName(payout.id), n: formatInt(payout.n) })}</span
  >
{/each}
{#each items as item (item.id)}
  <span data-reward="item"><EntityLink kind="item" id={item.id} /> ×{item.n}</span>
{/each}
