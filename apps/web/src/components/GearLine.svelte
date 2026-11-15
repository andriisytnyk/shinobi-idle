<script lang="ts">
  import { content, type Gear } from '@shinobi/content';
  import { evalReq, nextTierPrice, nextTierReq, ownedTiers } from '@shinobi/core';
  import { blockOf, blockText } from '../lib/crafts.ts';
  import { entityDesc } from '../lib/entities.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import BuildingNeed from './BuildingNeed.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    line: Gear;
    /** On a skill page: facts and a link to the shop, no buy button. */
    compact?: boolean;
  }

  let { line, compact = false }: Props = $props();

  const ref = $derived({ kind: 'gear', id: line.id } as const);
  const desc = $derived(entityDesc(ref));
  const view = $derived(
    game.read((gs) => {
      const owned = ownedTiers(gs, line.id);
      const next = line.tiers[owned];
      const req = nextTierReq(gs, line, content);
      return {
        owned,
        next: next ? { tier: next.tier } : null,
        price: nextTierPrice(gs, line, content),
        req: req ? evalReq(gs, req, content) : null,
        ryo: gs.currencies.ryo,
      };
    }),
  );
  const block = $derived(view.req && !view.req.met ? blockOf(view.req) : null);
  const poor = $derived(view.price !== null && view.ryo < view.price);
  const maxed = $derived(view.next === null);

  function buy(): void {
    const result = game.dispatch({ type: 'gear.buy', line: line.id });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }
</script>

<section class="gear" data-gear={line.id} data-owned={view.owned}>
  <h3 class="name">
    <span class="icon"><Icon entity={ref} size={24} /></span>
    <EntityLink kind="gear" id={line.id} />
    <span class="tiers" data-tiers>{t('gear.tiers', { n: view.owned, of: line.tiers.length })}</span
    >
  </h3>
  {#if desc}<p class="effect">{desc}</p>{/if}

  {#if maxed}
    <p class="done" data-maxed>{t('gear.maxed')}</p>
  {:else if view.next && view.price !== null}
    <p class="next" data-next>
      {t('gear.next', { tier: view.next.tier, price: formatInt(view.price) })}
    </p>
    {#if view.req && !view.req.met}<div class="req"><ReqTree node={view.req} /></div>{/if}
    {#if !compact}
      <button
        type="button"
        class="ct-button"
        data-buy-gear={line.id}
        disabled={block !== null || poor}
        aria-describedby={block !== null || poor ? `why-gear-${line.id}` : undefined}
        onclick={buy}
      >
        {t('shop.buy')}
      </button>
      {#if block}
        <p class="ct-why" id="why-gear-{line.id}" data-why={block.kind}>
          {#if block.kind === 'building'}<BuildingNeed
              id={block.id}
              level={block.n}
            />{:else}{blockText(block)}{/if}
        </p>
      {:else if poor}
        <p class="ct-why" id="why-gear-{line.id}" data-why="ryo">
          {t('shop.reason.ryo', { need: formatInt(view.price), have: formatInt(view.ryo) })}
        </p>
      {/if}
    {/if}
  {/if}
  {#if compact}<a class="shop-link ct-link" href="#/shop" data-shop-link>{t('gear.toShop')}</a>{/if}
</section>

<style>
  .gear {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-raised);
  }

  .name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: 1rem;
  }

  .name :global(a) {
    color: var(--heading);
  }

  .icon {
    display: inline-flex;
    color: var(--steel);
  }

  .tiers {
    color: var(--fg-dim);
    font-size: 0.85rem;
    font-weight: 400;
  }

  .effect,
  .next,
  .done {
    margin: 0;
  }

  .effect,
  .done {
    color: var(--fg-dim);
  }

  .req {
    font-size: 0.9rem;
  }
</style>
