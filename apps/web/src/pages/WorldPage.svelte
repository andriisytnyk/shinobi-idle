<script lang="ts">
  import { content } from '@shinobi/content';
  import { cellInfo, listRegions, type CellInfo } from '@shinobi/core';
  import CellPanel from '../components/CellPanel.svelte';
  import CellTile from '../components/CellTile.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import { t } from '../lib/i18n.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  interface Props {
    /** What the route asks the map to show: a cell with its panel, or a region. */
    focus?: { cell: string | null; region: string | null };
  }

  let { focus = { cell: null, region: null } }: Props = $props();

  const regions = $derived(game.read((gs) => listRegions(gs, content)));

  /** The region the player picked; a route to a cell or region, or the player's own region, is the default. */
  let picked = $state<string | null>(null);
  $effect(() => {
    if (focus.region) picked = focus.region;
  });

  const activeId = $derived(picked ?? regions.find((r) => r.here)?.id ?? regions[0]?.id ?? '');
  const active = $derived(regions.find((r) => r.id === activeId) ?? null);

  const cells = $derived(
    game.read((gs): CellInfo[] =>
      (active?.cells ?? []).flatMap((id) => cellInfo(gs, id, content, game.rules) ?? []),
    ),
  );

  /** Where the bottom sheet rests: just above the Now bar, whatever height that bar has. */
  let sheetBottom = $state<string | null>(null);
  $effect(() => {
    const now = document.querySelector('.now');
    if (!now) return;
    const update = () => {
      sheetBottom = `${Math.max(0, window.innerHeight - now.getBoundingClientRect().top)}px`;
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(now);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  });

  const selected = $derived(focus.cell);
  const close = () => navigate(`#/world`);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && selected) close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<SimplePage title={t('world.title')}>
  <div class="world" data-world style:--sheet-bottom={sheetBottom}>
    <Hint id="world" />
    <p class="intro">{t('world.intro')}</p>

    <nav class="regions" aria-label={t('world.regions')}>
      {#each regions as region (region.id)}
        <div
          class="region"
          class:active={region.id === activeId}
          class:closed={!region.open}
          data-region={region.id}
          data-open={region.open}
          aria-current={region.id === activeId ? 'true' : undefined}
        >
          <span class="region-icon"
            ><Icon entity={{ kind: 'region', id: region.id }} size={22} /></span
          >
          <span class="region-name"><EntityLink kind="region" id={region.id} /></span>
          <span class="region-status">
            {#if region.open}
              {t('world.region.explored', { n: region.explored, total: region.cells.length })}
            {:else}
              <Icon name="lucide:lock" size={12} /> {t('world.region.closed')}
            {/if}
            {#if region.here}
              · <span data-region-here>{t('world.region.here')}</span>
            {/if}
          </span>
        </div>
      {/each}
    </nav>

    {#if active && !active.open}
      <section class="closed-block" data-region-closed>
        <h2><Icon name="lucide:lock" size={18} /> {t('world.region.closedTitle')}</h2>
        <ReqTree node={active.req} />
      </section>
    {/if}

    <div class="layout" class:with-panel={selected !== null}>
      <div class="grid-wrap">
        <ul class="grid" aria-label={t('world.region.grid')} data-grid={activeId}>
          {#each cells as info (info.id)}
            <CellTile {info} selected={info.id === selected} />
          {/each}
        </ul>
      </div>

      {#if selected}
        <button
          type="button"
          class="scrim"
          tabindex="-1"
          aria-label={t('world.panel.close')}
          onclick={close}
        ></button>
        <aside class="side" data-side>
          {#key selected}<CellPanel id={selected} onClose={close} />{/key}
        </aside>
      {/if}
    </div>
  </div>
</SimplePage>

<style>
  .world {
    --sheet-bottom: var(--now-height);
  }

  .intro {
    margin: 0 0 var(--space-3);
    color: var(--fg-dim);
  }

  .regions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .region {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'icon name'
      'icon status';
    column-gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .region.active {
    border-color: var(--accent);
    background: var(--surface-raised);
  }

  .region.closed {
    color: var(--fg-dim);
  }

  .region-icon {
    grid-area: icon;
    display: inline-flex;
    align-items: center;
  }

  .region-name {
    grid-area: name;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .region-name :global(a) {
    color: var(--fg);
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
  }

  /* The name link stretches over the whole region card. */
  .region-name :global(a)::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .region-status {
    grid-area: status;
    margin-top: -0.5rem;
    color: var(--fg-dim);
    font-size: 0.8rem;
  }

  .closed-block {
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .closed-block h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    font-size: 1rem;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }

  .grid-wrap {
    container-type: inline-size;
    min-width: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
  }

  @container (min-width: 26rem) {
    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @container (min-width: 40rem) {
    .grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  /* Below the wide layout the cell panel is a bottom sheet over a dimmed page. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 11;
    border: 0;
    background: var(--scrim);
    cursor: pointer;
  }

  .side {
    position: fixed;
    right: 0;
    bottom: var(--sheet-bottom);
    left: 0;
    z-index: 12;
    max-height: 70dvh;
    padding: var(--space-4);
    padding-bottom: var(--space-6);
    border-top: 2px solid var(--accent);
    background: var(--surface-raised);
    overflow-y: auto;
  }

  @media (max-width: 768px) {
    .world {
      --sheet-bottom: calc(var(--now-height) + var(--tabbar-height));
    }
  }

  @media (min-width: 1280px) {
    .layout.with-panel {
      grid-template-columns: minmax(0, 1fr) 22rem;
    }

    .scrim {
      display: none;
    }

    .side {
      position: sticky;
      top: 0;
      z-index: auto;
      max-height: calc(100dvh - var(--topbar-height) - var(--now-height) - var(--space-6) * 2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
    }
  }
</style>
