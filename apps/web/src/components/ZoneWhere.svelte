<script lang="ts">
  import { content } from '@shinobi/content';
  import { zoneAvailable, zoneCellOf } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** Fight zone to place on the map. */
    zone: string;
  }

  let { zone }: Props = $props();

  const cellId = $derived(zoneCellOf(zone, content));
  const cell = $derived(content.cells.find((c) => c.id === cellId));
  /** From the map: the zone is available once its cell is explored. The combat rules do not enforce this yet. */
  const available = $derived(game.read((gs) => zoneAvailable(gs, zone, content)));
</script>

{#if cellId && cell}
  <p class="where" data-zone-where={zone} data-zone-available={available}>
    <span class="dim">{t('world.where.cell')}</span>
    <EntityLink kind="cell" id={cellId} />
    (<EntityLink kind="region" id={cell.region} />)
    <span class="state" class:ok={available}>
      {available ? t('world.where.open') : t('world.where.closed')}
    </span>
  </p>
{/if}

<style>
  .where {
    margin: 0;
    font-size: var(--text-xs);
  }

  .dim {
    color: var(--fg-dim);
  }

  .state {
    color: var(--fg-dim);
  }

  .state.ok {
    color: var(--success);
  }

  .where :global(a) {
    color: var(--fg);
    font-weight: 600;
  }
</style>
