<script lang="ts">
  import { entityName } from '../lib/entities.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { moneyName } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
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
  const invalid = $derived(qty < 1);
  const tooMany = $derived(!invalid && qty > owned);
  const off = $derived(invalid || tooMany);

  function sell(): void {
    if (off) return;
    const result = game.dispatch({ type: 'shop.sell', item, n: qty });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

<li class="ct-row" data-sell={item} data-owned={owned}>
  <span class="ct-icon"><Icon entity={{ kind: 'item', id: item }} size={28} /></span>
  <span class="grow"><EntityLink kind="item" id={item} offered /></span>
  <span class="ct-muted" data-sell-price
    >{t('shop.sellPrice', { n: formatInt(price), currency: moneyName(game.content) })}</span
  >
  <span class="ct-muted" data-have>{t('shop.owned', { n: formatInt(owned) })}</span>
  <Stepper
    bind:value={qty}
    max={owned}
    label={t('shop.qtyOf', { name: entityName({ kind: 'item', id: item }) })}
    onSubmit={sell}
  />
  <button
    type="button"
    class="ct-button"
    data-sell-button={item}
    disabled={off}
    aria-describedby={off ? `why-sell-${item}` : undefined}
    onclick={sell}
  >
    {t('shop.sellFor', { n: formatInt(invalid ? 0 : price * qty) })}
  </button>
  {#if invalid}
    <p class="ct-why" id="why-sell-{item}" data-why="qty">{t('qty.invalid')}</p>
  {:else if tooMany}
    <p class="ct-why" id="why-sell-{item}" data-why="qty">
      {t('qty.tooMany', { n: formatInt(owned) })}
    </p>
  {/if}
</li>

<style>
  .ct-why {
    flex: 1 0 100%;
  }
</style>
