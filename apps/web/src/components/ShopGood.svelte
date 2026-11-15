<script lang="ts">
  import type { ReqResult } from '@shinobi/core';
  import { blockOf, blockText } from '../lib/crafts.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';
  import Stepper from './Stepper.svelte';

  interface Props {
    item: string;
    /** Price of one unit in ryo. */
    price: number;
    /** What the bank holds. */
    owned: number;
    /** The requirement of the good, evaluated; unmet means it is locked. */
    req: ReqResult;
  }

  let { item, price, owned, req }: Props = $props();

  let qty = $state(1);
  const ryo = $derived(game.read((gs) => gs.currencies.ryo));
  const total = $derived(price * qty);
  const block = $derived(req.met ? null : blockOf(req));
  const poor = $derived(ryo < total);

  function buy(): void {
    const result = game.dispatch({ type: 'shop.buy', item, n: qty });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }
</script>

<li class="ct-row good" data-good={item} data-owned={owned}>
  <span class="ct-icon"><Icon entity={{ kind: 'item', id: item }} size={28} /></span>
  <span class="grow"><EntityLink kind="item" id={item} /></span>
  <span class="ct-muted" data-price>{t('shop.price', { n: formatInt(price) })}</span>
  <span class="ct-muted" data-have>{t('shop.owned', { n: formatInt(owned) })}</span>
  <Stepper bind:value={qty} label={t('shop.qty')} />
  <button
    type="button"
    class="ct-button"
    data-buy={item}
    disabled={block !== null || poor}
    aria-describedby={block !== null || poor ? `why-good-${item}` : undefined}
    onclick={buy}
  >
    {t('shop.buyFor', { n: formatInt(total) })}
  </button>
  {#if block}
    <div class="why-box">
      <p class="ct-why" id="why-good-{item}" data-why={block.kind}>{blockText(block)}</p>
      <ReqTree node={req} />
    </div>
  {:else if poor}
    <p class="ct-why" id="why-good-{item}" data-why="ryo">
      {t('shop.reason.ryo', { need: formatInt(total), have: formatInt(ryo) })}
    </p>
  {/if}
</li>

<style>
  .why-box {
    flex: 1 0 100%;
    font-size: 0.9rem;
  }

  .ct-why {
    flex: 1 0 100%;
  }
</style>
