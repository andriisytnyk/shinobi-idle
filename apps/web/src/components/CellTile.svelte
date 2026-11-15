<script lang="ts">
  import type { CellInfo } from '@shinobi/core';
  import { entityName, webRef } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { KEY_ICON, keyNameKey, POI_ICON, poiKindKey, unmetLeaves } from '../lib/world.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    info: CellInfo;
    /** The cell whose panel is open. */
    selected?: boolean;
  }

  let { info, selected = false }: Props = $props();

  const explored = $derived(info.level >= 1);
  const maxed = $derived(info.level >= info.maxLevel);
  /** Points the player has found; the others are not revealed here. */
  const found = $derived(explored ? info.pois.filter((p) => p.found) : []);
  const loot = $derived(
    info.pois.some((p) => p.found && !p.claimed && (p.kind === 'cache' || p.kind === 'vault')),
  );
  const regionClosed = $derived(info.why === 'error.regionClosed');
  const keyLocked = $derived(info.keyReq !== null && !info.keyReq.met);
  const keyRows = $derived(info.keyReq ? unmetLeaves(info.keyReq) : []);

  const started = $derived(!explored && info.explores > 0);
</script>

<li
  class="tile"
  class:selected
  class:locked={keyLocked || regionClosed}
  class:here={info.located}
  data-cell={info.id}
  data-level={info.level}
  data-located={info.located}
  data-maxed={maxed}
>
  <h3 class="name"><EntityLink kind="cell" id={info.id} /></h3>

  <div class="badges">
    {#if info.located}
      <span class="badge here-badge" data-here title={t('world.tile.here')}>
        <Icon name="lucide:map-pin" size={14} />{t('world.tile.here')}
      </span>
    {/if}
    {#if loot}
      <span class="badge loot" data-loot title={t('world.tile.loot')}>
        <Icon name="lucide:gift" size={14} /><span class="sr">{t('world.tile.loot')}</span>
      </span>
    {/if}
    {#if info.key}
      <span class="badge key" data-key={info.key} class:unmet={keyLocked}>
        <Icon name={KEY_ICON[info.key]} size={14} />
        <span>{t(keyNameKey(info.key))}</span>
        {#if keyLocked}<Icon name="lucide:lock" size={12} />{/if}
      </span>
    {/if}
  </div>

  {#if explored}
    <div class="level">
      <span
        class="pips"
        role="img"
        aria-label={t('world.tile.level', { n: info.level, max: info.maxLevel })}
      >
        {#each Array.from({ length: info.maxLevel }, (_, i) => i) as i (i)}
          <span class="pip" class:on={i < info.level}></span>
        {/each}
      </span>
      {#if maxed}
        <span class="max" data-max>{t('world.tile.max')}</span>
      {:else}
        <span class="bar" aria-hidden="true"
          ><span class="fill" style:width="{Math.round(info.progress * 100)}%"></span></span
        >
      {/if}
    </div>
  {:else}
    <p class="unexplored">{t('world.tile.unexplored')}</p>
    {#if started}
      <span class="bar" aria-hidden="true"
        ><span class="fill" style:width="{Math.round(info.progress * 100)}%"></span></span
      >
    {/if}
  {/if}

  {#if found.length > 0}
    <ul class="pois" aria-label={t('world.tile.pois')}>
      {#each found as poi (poi.id)}
        {@const name = entityName({ kind: 'poi', id: poi.id })}
        <li
          class="poi"
          data-poi-kind={poi.kind}
          title={`${t(poiKindKey(poi.kind))}: ${name}`}
          role="img"
          aria-label={`${t(poiKindKey(poi.kind))}: ${name}`}
        >
          <Icon name={POI_ICON[poi.kind]} size={16} />
        </li>
      {/each}
    </ul>
  {/if}

  {#if regionClosed}
    <p class="need" data-need>{t('world.tile.regionClosed')}</p>
  {:else if keyLocked && keyRows.length > 0}
    <p class="need" data-need>
      <span class="dim">{t('world.tile.need')}</span>
      {#each keyRows as row, i (i)}
        {#if i > 0}<span class="dim">/</span>{/if}
        {@const ref = webRef(row.ref)}
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} />{/if}
        {#if row.req.t === 'skill'}<span class="dim">{t('req.level', { n: row.req.level })}</span
          >{/if}
      {/each}
    </p>
  {/if}
</li>

<style>
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    min-height: 7rem;
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-raised);
    list-style: none;
  }

  .tile.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .tile.here {
    border-left: 4px solid var(--chakra);
  }

  .tile.locked {
    background: var(--surface);
    color: var(--fg-dim);
  }

  .name {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  /* The name link stretches over the tile, so a tap anywhere on it opens the cell. */
  .name :global(a) {
    color: var(--fg);
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
  }

  .name :global(a)::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 0.75rem;
    line-height: 1.5rem;
  }

  .here-badge {
    border-color: var(--chakra);
    color: var(--chakra);
  }

  .loot {
    border-color: var(--stamina);
    color: var(--stamina);
  }

  .key.unmet {
    border-style: dashed;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .level {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .pips {
    display: flex;
    gap: 0.25rem;
  }

  .pip {
    width: 0.7rem;
    height: 0.7rem;
    border: 1px solid var(--steel);
    border-radius: 50%;
  }

  .pip.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  .bar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .max {
    color: var(--success);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .unexplored {
    margin: 0;
    color: var(--fg-dim);
    font-size: 0.8rem;
  }

  .pois {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    color: var(--fg);
  }

  .poi {
    display: inline-flex;
    list-style: none;
  }

  .need {
    position: relative;
    z-index: 1;
    margin: 0;
    font-size: 0.8rem;
  }

  .need :global(a) {
    color: var(--fg);
    font-weight: 600;
    text-decoration: underline;
  }

  .dim {
    color: var(--fg-dim);
  }
</style>
