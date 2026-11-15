<script lang="ts">
  import { evalReq, sellPrice, shopEntries, shopPrice } from '@shinobi/core';
  import { onMount } from 'svelte';
  import GearLine from '../components/GearLine.svelte';
  import Hint from '../components/Hint.svelte';
  import ShopGood from '../components/ShopGood.svelte';
  import ShopSell from '../components/ShopSell.svelte';
  import { blockOf, shopSection, type ShopSection } from '../lib/crafts.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { held, moneyName, moneyOf } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  const content = game.content;

  interface Props {
    /** `sell` brings the sell section into view. */
    section?: 'sell';
  }

  let { section }: Props = $props();

  const money = moneyOf(content);
  const ryo = $derived(game.read((gs) => held(gs, money)));
  const goods = $derived(
    game.read((gs) =>
      shopEntries(content).flatMap((entry) => {
        const price = shopPrice(gs, entry.item, content);
        if (price === null) return [];
        return [
          {
            item: entry.item,
            price,
            section: shopSection(entry),
            owned: gs.bank[entry.item] ?? 0,
            req: evalReq(gs, entry.req, content),
          },
        ];
      }),
    ),
  );
  const sells = $derived(
    game.read((gs) =>
      content.items.flatMap((item) => {
        const owned = gs.bank[item.id] ?? 0;
        const price = owned > 0 ? sellPrice(item.id, content) : null;
        return price === null ? [] : [{ item: item.id, owned, price }];
      }),
    ),
  );

  /** Every good waits for a rank: the shop says so once instead of on each row. */
  const shut = $derived(
    goods.length > 0 && goods.every((g) => !g.req.met && blockOf(g.req)?.kind === 'rank'),
  );

  const SECTIONS: readonly ShopSection[] = ['market', 'forge', 'library'];

  let sellBox = $state<HTMLElement | null>(null);
  onMount(() => {
    if (section === 'sell') sellBox?.scrollIntoView?.({ block: 'start' });
  });
</script>

<SimplePage title={t('shop.title')}>
  <Hint id="shop" />
  <p class="purse" data-purse>
    {t('shop.purse', { n: formatInt(ryo), currency: moneyName(content) })}
  </p>
  {#if shut}
    <p class="ct-why" id="shop-locked" data-shop-locked data-why="rank">{t('shop.shut')}</p>
  {/if}

  {#each SECTIONS as id (id)}
    <section class="ct-section" data-section={id}>
      <h2>{t(`shop.section.${id}`)}</h2>
      <ul class="list">
        {#each goods.filter((g) => g.section === id) as good (good.item)}
          <ShopGood
            item={good.item}
            price={good.price}
            owned={good.owned}
            req={good.req}
            quiet={shut}
          />
        {/each}
      </ul>
    </section>
  {/each}

  <section class="ct-section" data-section="sell" bind:this={sellBox}>
    <h2>{t('shop.section.sell')}</h2>
    {#if sells.length === 0}
      <p class="empty" data-sell-empty>{t('shop.sellEmpty')}</p>
    {:else}
      <ul class="list">
        {#each sells as row (row.item)}
          <ShopSell item={row.item} owned={row.owned} price={row.price} />
        {/each}
      </ul>
    {/if}
  </section>

  <section class="ct-section" data-section="gear">
    <h2>{t('shop.section.gear')}</h2>
    <div class="gears">
      {#each content.gear as line (line.id)}
        <GearLine {line} />
      {/each}
    </div>
  </section>
</SimplePage>

<style>
  .purse {
    margin: 0;
    color: var(--fg-dim);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
  }

  .gears {
    --_grid-template-columns: 18rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--_grid-template-columns)), 1fr));
    gap: var(--space-3);
  }

  .empty {
    color: var(--fg-dim);
  }
</style>
