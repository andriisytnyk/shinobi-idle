<script lang="ts">
  import type { CellInfo } from '@shinobi/core';
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { isEntryCell, KEY_ICON, keyNameKey, POI_ICON, poiKindKey } from '../lib/world.ts';
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

  const started = $derived(!explored && info.explores > 0);
</script>

<li
  class="tile"
  class:selected
  class:locked={keyLocked || regionClosed}
  class:here={info.located}
  data-cell={info.id}
  data-ui="world-cell"
  data-entity="cell:{info.id}"
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
    {#if isEntryCell(info.id) && !regionClosed}
      <span class="badge entry" data-entry>
        <Icon name="lucide:tent" size={14} />{t('world.tile.entry')}
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
  {:else if keyLocked}
    <!-- The full requirement, as links, is in the cell panel. -->
    <p class="need" data-need>
      <Icon name="lucide:lock" size={12} />
      {t('world.tile.lockedShort')}
    </p>
  {/if}
</li>

<style>
  .tile {
    --_min-height: 7rem;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--_min-height);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    list-style: none;
  }

  .tile.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .tile.here {
    border-left: var(--border-heavy) solid var(--chakra);
  }

  .tile.locked {
    background: var(--surface);
    color: var(--fg-dim);
  }

  .name {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  /* The name link stretches over the tile, so a tap anywhere on it opens the cell. */
  .name :global(a) {
    color: var(--fg);
    min-height: var(--control-md);
    display: inline-flex;
    align-items: center;
  }

  .name :global(a)::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-md);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .badge {
    --_line-height: 1.5rem;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-pill);
    font-size: var(--text-2xs);
    line-height: var(--_line-height);
  }

  .entry {
    border-color: var(--leaf);
    color: var(--leaf);
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
    gap: var(--space-1);
  }

  .pip {
    --_width: 0.7rem;
    --_height: 0.7rem;
    width: var(--_width);
    height: var(--_height);
    border: var(--border-thin) solid var(--steel);
    border-radius: 50%;
  }

  .pip.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  .bar {
    display: block;
    height: var(--bar-thin);
    border-radius: var(--radius-xs);
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
    font-size: var(--text-2xs);
    font-weight: 600;
  }

  .unexplored {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
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
    z-index: var(--z-raised);
    margin: 0;
    font-size: var(--text-xs);
  }
</style>
