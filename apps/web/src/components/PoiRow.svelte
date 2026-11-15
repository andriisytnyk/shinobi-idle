<script lang="ts">
  import { entityDesc } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { GENERIC_POI_ICON, poiKindKey, poiLinks } from '../lib/world.ts';
  import PanelHost from '../lib/ext/PanelHost.svelte';
  import { tryUi } from '../lib/ext/runtime.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    poi: { id: string; kind: string } & Record<string, unknown>;
    /** The cell the point of interest lies in. */
    cell: string;
  }

  let { poi, cell }: Props = $props();

  const ui = tryUi();
  /** The renderer a pack registered for this kind; a kind without one is drawn generically. */
  const renderer = $derived(ui?.registry.poiRenderer(poi.kind));
  const desc = $derived(entityDesc({ kind: 'poi', id: poi.id }));
  const links = $derived(renderer?.mount ? [] : poiLinks(poi));
</script>

<li
  class="poi"
  data-poi={poi.id}
  data-poi-kind={poi.kind}
  data-ui="poi-row"
  data-entity="poi:{poi.id}"
>
  <p class="poi-name">
    <Icon name={renderer?.icon ?? GENERIC_POI_ICON} size={18} />
    <EntityLink kind="poi" id={poi.id} />
    <span class="kind">{t(poiKindKey(poi.kind))}</span>
  </p>
  {#if desc}<p class="small dim">{desc}</p>{/if}

  {#if renderer?.mount}
    <PanelHost
      owner={renderer.key}
      packId={renderer.packId}
      mount={renderer.mount}
      ctx={{ poi, cell }}
    />
  {:else if links.length > 0}
    <p class="small" data-poi-links>
      {#each links as link, i (link.kind + link.id)}{#if i > 0},
        {/if}<EntityLink kind={link.kind} id={link.id} />{/each}
    </p>
  {/if}
</li>

<style>
  .poi {
    padding-bottom: var(--space-3);
    border-bottom: var(--border-thin) solid var(--line);
  }

  .poi:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .poi-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-weight: 600;
  }

  .poi-name .kind {
    color: var(--fg-dim);
    font-size: var(--text-2xs);
    font-weight: 400;
  }

  /* The lines the renderers draw belong to the row, whoever draws them. */
  .poi :global(.dim) {
    color: var(--fg-dim);
  }

  .poi :global(.small) {
    margin: var(--space-1) 0;
    font-size: var(--text-xs);
  }

  .poi :global(.go) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--control-md);
    min-height: var(--control-md);
    color: var(--accent);
  }

  .poi :global(.done) {
    color: var(--success);
  }
</style>
