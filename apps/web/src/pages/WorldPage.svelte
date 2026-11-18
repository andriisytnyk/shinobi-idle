<script lang="ts">
  import { hexKey, hexOfAddress, isSurveyed, travelPlan } from '@shinobi/core';
  import { untrack } from 'svelte';
  import AutoSurveyButton from '../components/AutoSurveyButton.svelte';
  import HexMap from '../components/HexMap.svelte';
  import HexPanel from '../components/HexPanel.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import { entityName } from '../lib/entities.ts';
  import { autoState, mapView, type MapView } from '../lib/hex-map.ts';
  import { t } from '../lib/i18n.ts';
  import { MASK } from '../lib/reveal.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  const content = game.content;

  interface Props {
    /** What the route asks the map to show: a cell with its panel, or a region. */
    focus?: { cell: string | null; region: string | null };
  }

  let { focus = { cell: null, region: null } }: Props = $props();

  const view = $derived(game.read((gs): MapView => mapView(gs, content, game.rules)));
  const byCoord = $derived(new Map(view.hexes.map((h) => [h.coord, h])));

  let selected = $state<string | null>(null);
  let hovered = $state<string | null>(null);
  let map = $state<ReturnType<typeof HexMap> | undefined>();

  const hexOfCell = (id: string): string | null => {
    const cell = content.cells.find((c) => c.id === id);
    return cell ? hexKey(cell.hex[0], cell.hex[1]) : null;
  };

  // A route to a cell or a region opens it on the map.
  $effect(() => {
    const cell = focus.cell;
    const region = focus.region;
    const at = cell
      ? hexOfCell(cell)
      : region
        ? hexOfCell(content.regions.find((r) => r.id === region)?.cells[0] ?? '')
        : null;
    if (!at) return;
    // A cell the player has not surveyed is not placed on the map: the address would give its hex away.
    if (!untrack(() => game.read((gs) => isSurveyed(gs, content, at)))) return;
    if (cell) selected = at;
    queueMicrotask(() => map?.focusOn(at));
  });

  /** The hex the walk in progress leads to, so the route stays drawn while the player walks. */
  const walking = $derived(
    game.read((gs) => {
      const action = gs.slots.find((s) => s.action?.kind === 'walk')?.action;
      const hex = action ? hexOfAddress(content, action.id) : null;
      return hex ? hexKey(hex.q, hex.r) : null;
    }),
  );

  const previewTarget = $derived(hovered ?? selected ?? walking);
  const preview = $derived(
    game.read((gs) => {
      const target = previewTarget ? byCoord.get(previewTarget) : null;
      if (!target || target.info.here || !target.info.surveyed) return null;
      const plan = travelPlan(gs, target.info.address, content, game.rules);
      return plan.hexes.length > 0 ? { hexes: plan.hexes, ms: plan.ms } : null;
    }),
  );

  const auto = $derived(game.read((gs) => autoState(gs, content)));

  const here = $derived(view.here ? byCoord.get(view.here) : null);
  const hereName = $derived.by(() => {
    if (!here) return '';
    const cell = here.info.cell ? entityName({ kind: 'cell', id: here.info.cell }) : null;
    if (cell && cell !== MASK) return cell;
    if (here.places.length > 0) return here.places.map((p) => t(`place.${p.id}.name`)).join(', ');
    return here.terrain ? t(`terrain.${here.terrain}.name`) : '';
  });

  // ---------- layout ----------

  let stageWidth = $state(0);
  let stageEl = $state<HTMLElement | undefined>();
  /** Wide enough for the panel to stand beside the map; otherwise it is a bottom sheet. */
  const wide = $derived.by(() => {
    if (typeof document === 'undefined') return true;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return stageWidth === 0 || stageWidth >= rem * 44;
  });
  const sheet = $derived(!wide && selected !== null);

  /** Where the bottom sheet rests: just above the Now bar, whatever height that bar has. */
  let sheetBottom = $state<string | null>(null);
  /** The room between the top bar and the Now bar, in px: the sheet takes a share of it, and the map keeps the rest. */
  let room = $state(0);
  /** The sheet is opened wide: most of the room, for reading a long panel; the map is a strip then. */
  let expanded = $state(false);
  $effect(() => {
    const now = document.querySelector('.now');
    const top = document.querySelector('.topbar');
    if (!now) return;
    const update = () => {
      const upper = now.getBoundingClientRect().top;
      sheetBottom = `${Math.max(0, window.innerHeight - upper)}px`;
      room = Math.max(0, upper - (top?.getBoundingClientRect().bottom ?? 0));
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(now);
    if (top) observer?.observe(top);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  });
  // A new hex starts with the sheet at its usual height.
  $effect(() => {
    void selected;
    expanded = false;
  });
  const sheetMax = $derived(
    room > 0 ? `${Math.round(room * (expanded ? 0.92 : 0.62))}px` : expanded ? '85dvh' : '55dvh',
  );

  const select = (coord: string | null): void => {
    selected = coord;
    // A cell route that was left behind is cleared with the panel.
    if (coord === null && focus.cell) navigate('#/world');
    if (coord !== null && !wide) {
      // The sheet covers the lower part of the screen: the map comes to the top, with the hex above the sheet.
      stageEl?.scrollIntoView({ block: 'start' });
      queueMicrotask(() => map?.focusOn(coord));
    }
  };

  const terrains = content.terrains;
</script>

<SimplePage title={t('world.title')} compact>
  <div class="world" data-world style:--sheet-bottom={sheetBottom} style:--sheet-max={sheetMax}>
    <Hint id="world" />

    <div class="strip" data-map-status>
      <p class="where">
        <Icon name="lucide:map-pin" size={16} />
        <span>{t('map.statusHere')} <strong data-here-name>{hereName}</strong></span>
        <span class="range" data-range
          ><span class="sep" aria-hidden="true">· </span>{t('map.range', { n: view.range })}</span
        >
      </p>
      <div class="auto-row">
        <AutoSurveyButton whyId="why-auto-strip" />
        {#if auto.why && auto.slot < 0}
          <span class="why" id="why-auto-strip" data-why="auto-strip">{t(auto.why)}</span>
        {/if}
      </div>
    </div>

    <div
      class="stage"
      class:wide
      class:with-panel={selected !== null}
      bind:clientWidth={stageWidth}
      bind:this={stageEl}
    >
      <div class="map-wrap">
        <HexMap
          bind:this={map}
          {view}
          {selected}
          {preview}
          {sheet}
          onSelect={select}
          onHover={(c) => (hovered = c)}
        />
      </div>

      {#if selected}
        <aside class="side" class:sheet={!wide} data-side aria-label={t('map.panel.label')}>
          {#key selected}<HexPanel
              coord={selected}
              sheet={!wide}
              {expanded}
              onToggle={() => (expanded = !expanded)}
              onClose={() => select(null)}
            />{/key}
        </aside>
      {/if}
    </div>

    <details class="legend" data-legend>
      <summary>{t('map.legend')}</summary>
      <p class="intro">{t('map.intro')}</p>
      <ul class="terrains">
        {#each terrains as terrain (terrain.id)}
          <li>
            <span class="swatch" style:--_fill="var({terrain.token ?? `--terrain-${terrain.id}`})"
            ></span>
            {t(`terrain.${terrain.id}.name`)}
          </li>
        {/each}
      </ul>
      <ul class="marks">
        <li><span class="swatch fog"></span>{t('map.legend.fog')}</li>
        <li><span class="swatch reach"></span>{t('map.legend.reach')}</li>
        <li><span class="swatch you"></span>{t('map.legend.you')}</li>
        <li><span class="swatch route"></span>{t('map.legend.route')}</li>
        <li><Icon name="lucide:landmark" size={16} />{t('map.legend.place')}</li>
        <li><span class="swatch poi"></span>{t('map.legend.poi')}</li>
        <li><span class="swatch pips"></span>{t('map.legend.pips')}</li>
      </ul>
    </details>
  </div>
</SimplePage>

<style>
  .world {
    --sheet-bottom: var(--now-live, var(--now-height));
    --_stage-h: max(26rem, calc(100dvh - 21rem));
  }

  .intro {
    margin: var(--space-2) 0;
    color: var(--fg-dim);
  }

  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    margin-bottom: var(--space-3);
  }

  .strip p {
    margin: 0;
  }

  .where {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .range {
    color: var(--fg-dim);
  }

  .auto-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-inline-start: auto;
  }

  /* On a phone the status takes two short lines beside the button, so the map starts higher up. */
  @media (max-width: 768px) {
    .strip {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }

    .where {
      gap: 0 var(--space-2);
    }

    .range {
      flex-basis: 100%;
      font-size: var(--text-xs);
    }

    .sep {
      display: none;
    }

    .auto-row {
      margin-inline-start: 0;
    }

    .why {
      grid-column: 1 / -1;
    }
  }

  .why {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    height: var(--_stage-h);
  }

  .stage.wide.with-panel {
    --_panel-w: 22rem;
    grid-template-columns: minmax(0, 1fr) var(--_panel-w);
  }

  .map-wrap {
    min-width: 0;
    min-height: 0;
  }

  .side {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    overflow: hidden;
  }

  /* Below the wide layout the hex panel is a bottom sheet over the map. */
  .side.sheet {
    position: fixed;
    right: 0;
    bottom: var(--sheet-bottom);
    left: 0;
    z-index: var(--z-popover-top);
    max-height: var(--sheet-max, 55dvh);
    border-width: var(--border-thick) 0 0;
    border-top-color: var(--accent);
    border-radius: 0;
  }

  .legend {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .legend summary {
    display: flex;
    align-items: center;
    min-height: var(--control-sm);
    font-weight: 600;
    cursor: pointer;
  }

  .legend ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: var(--space-2) 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-xs);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .swatch {
    --_swatch: 1rem;
    display: inline-block;
    width: var(--_swatch);
    height: var(--_swatch);
    border: var(--border-thin) solid var(--bg);
    border-radius: var(--radius-xs);
    background: var(--_fill, var(--map-fog));
  }

  .swatch.fog {
    --_stripe: 3px;
    --_stripe-end: 5px;
    background: repeating-linear-gradient(
      45deg,
      var(--map-fog),
      var(--map-fog) var(--_stripe),
      var(--map-fog-line) var(--_stripe),
      var(--map-fog-line) var(--_stripe-end)
    );
  }

  .swatch.reach {
    border: var(--border-thin) dashed var(--accent);
    background: var(--map-fog);
  }

  .swatch.you {
    border-color: var(--paper);
    border-radius: var(--radius-pill);
    background: var(--chakra);
  }

  .swatch.route {
    height: 0;
    border: 0;
    border-top: var(--border-thick) dashed var(--accent);
    border-radius: 0;
    background: none;
  }

  .swatch.poi {
    --_swatch: 0.6rem;
    border-radius: var(--radius-pill);
    background: var(--hanko);
  }

  .swatch.pips {
    --_swatch: 0.6rem;
    border-color: var(--paper);
    border-radius: var(--radius-pill);
    background: var(--accent);
  }

  @media (max-width: 768px) {
    .world {
      --_stage-h: max(20rem, calc(100dvh - 22rem));
    }
  }
</style>
