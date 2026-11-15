<script lang="ts">
  import type { Poi } from '@shinobi/content';
  import { cellInfo } from '@shinobi/core';
  import { t } from '../../lib/i18n.ts';
  import { game } from '../../lib/store.ts';
  import EntityLink from '../EntityLink.svelte';
  import RewardList from '../RewardList.svelte';

  const content = game.content;

  interface Props {
    poi: Extract<Poi, { kind: 'cache' | 'vault' }>;
    cell: string;
  }

  let { poi, cell }: Props = $props();

  const claimed = $derived(
    game.read(
      (gs) => cellInfo(gs, cell, content, game.rules)?.pois.find((p) => p.id === poi.id)?.claimed,
    ),
  );
</script>

<p class="small">
  {t(poi.kind === 'cache' ? 'world.poi.lootCache' : 'world.poi.lootVault')}
  {#if poi.kind === 'cache'}
    <RewardList
      money={poi.ryo}
      currencies={poi.currencies ?? {}}
      items={poi.items.map((i) => ({ id: i.item, n: i.n }))}
    />
  {:else}
    <EntityLink kind="item" id={poi.item} />
  {/if}
</p>
{#if claimed}
  <p class="small done" data-claimed>{t('world.poi.claimed')}</p>
{/if}
