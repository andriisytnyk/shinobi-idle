<script lang="ts">
  import { entityAttr, idAttr } from '../lib/reveal.ts';
  import { shopTotal, type ReqResult } from '@shinobi/core';
  import { blockOf, blockText } from '../lib/crafts.ts';
  import { entityName } from '../lib/entities.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { currencyName, held, moneyOf } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import BuildingNeed from './BuildingNeed.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';
  import Stepper from './Stepper.svelte';

  const content = game.content;

  interface Props {
    item: string;
    /** Price of one unit in `currency`. */
    price: number;
    /** The currency the price is paid in; the money of the game when the shop entry names none. */
    currency?: string;
    /** What the bank holds. */
    owned: number;
    /** The requirement of the good, evaluated; unmet means it is locked. */
    req: ReqResult;
    /** The whole shop is shut and says so once above the list; the row adds no reason of its own. */
    quiet?: boolean;
  }

  let { item, price, owned, req, quiet = false, currency }: Props = $props();

  let qty = $state(1);
  const money = $derived(currency ?? moneyOf(content));
  const unit = $derived(currencyName(money));
  const ryo = $derived(game.read((gs) => held(gs, money)));
  /** What the stack costs now: the Market's discount comes off the whole stack. */
  const total = $derived(
    game.read((gs) => shopTotal(gs, item, Math.max(1, qty), content, game.rules) ?? price * qty),
  );
  const block = $derived(req.met ? null : blockOf(req));
  const invalid = $derived(qty < 1);
  const poor = $derived(!invalid && ryo < total);
  const off = $derived(block !== null || invalid || poor);
  const whyId = $derived(quiet ? 'shop-locked' : `why-good-${item}`);

  function buy(): void {
    if (off) return;
    const result = game.dispatch({ type: 'shop.buy', item, n: qty });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

<li
  class="ct-row good"
  data-good={item}
  data-owned={owned}
  data-ui="shop-good"
  data-entity={entityAttr({ kind: 'item', id: item })}
>
  <span class="ct-icon"><Icon entity={{ kind: 'item', id: item }} size={28} /></span>
  <span class="grow"><EntityLink kind="item" id={item} offered /></span>
  <span class="ct-muted" data-price>{t('shop.price', { n: formatInt(price), currency: unit })}</span
  >
  <span class="ct-muted" data-have>{t('shop.owned', { n: formatInt(owned) })}</span>
  <Stepper
    bind:value={qty}
    max={Math.floor(ryo / price)}
    label={t('shop.qtyOf', { name: entityName({ kind: 'item', id: item }) })}
    onSubmit={buy}
  />
  <button
    type="button"
    class="ct-button"
    data-buy={idAttr('item', item)}
    disabled={off}
    aria-describedby={off ? whyId : undefined}
    onclick={buy}
  >
    {t('shop.buyFor', { n: formatInt(invalid ? 0 : total) })}
  </button>
  {#if quiet}
    <!-- the notice above the list explains it -->
  {:else if block}
    <div class="why-box">
      {#if block.kind === 'building'}
        <p class="ct-why" id={whyId} data-why="building">
          <BuildingNeed id={block.id} level={block.n} />
        </p>
      {:else}
        <p class="ct-why" id={whyId} data-why={block.kind}>{blockText(block)}</p>
      {/if}
      {#if block.kind === 'locked' || block.kind === 'building'}<ReqTree node={req} />{/if}
    </div>
  {:else if invalid}
    <p class="ct-why" id={whyId} data-why="qty">{t('qty.invalid')}</p>
  {:else if poor}
    <p class="ct-why" id={whyId} data-why="money">
      {t('shop.reason.money', {
        currency: unit,
        need: formatInt(total),
        have: formatInt(ryo),
      })}
    </p>
  {/if}
</li>

<style>
  .why-box {
    flex: 1 0 100%;
    font-size: var(--text-xs);
  }

  .ct-why {
    flex: 1 0 100%;
  }
</style>
