<script lang="ts">
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import Stepper from './Stepper.svelte';

  interface Props {
    item: string;
    /** What the bank holds. */
    owned: number;
    /** Ryo for one unit. */
    price: number;
  }

  let { item, owned, price }: Props = $props();

  let qty = $state(1);
  // The bank can shrink under the stepper (a craft eats the item); the sale never asks for more.
  const count = $derived(Math.min(qty, Math.max(1, owned)));

  function sell(): void {
    const result = game.dispatch({ type: 'shop.sell', item, n: count });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }
</script>

<li class="ct-row" data-sell={item} data-owned={owned}>
  <span class="ct-icon"><Icon entity={{ kind: 'item', id: item }} size={28} /></span>
  <span class="grow"><EntityLink kind="item" id={item} /></span>
  <span class="ct-muted" data-sell-price>{t('shop.sellPrice', { n: formatInt(price) })}</span>
  <span class="ct-muted" data-have>{t('shop.owned', { n: formatInt(owned) })}</span>
  <Stepper bind:value={qty} max={Math.max(1, owned)} label={t('shop.qty')} />
  <button type="button" class="ct-button" data-sell-button={item} onclick={sell}>
    {t('shop.sellFor', { n: formatInt(price * count) })}
  </button>
</li>
