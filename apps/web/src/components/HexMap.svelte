<script lang="ts">
  import { untrack } from 'svelte';
  import { formatDuration } from '../lib/format.ts';
  import {
    HEX_PATH,
    SIZE,
    cameraAt,
    clampCamera,
    fitZoom,
    pointOf,
    stepByArrow,
    zoomAbout,
    type Arrow,
    type Camera,
    type MapHex,
    type MapView,
  } from '../lib/hex-map.ts';
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { MASK } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';

  /** What the route preview draws: the hexes it enters in order and its length. */
  interface Preview {
    hexes: string[];
    ms: number;
  }

  interface Props {
    view: MapView;
    /** The hex whose panel is open. */
    selected: string | null;
    /** The route to draw; null for none. */
    preview: Preview | null;
    /** Shown in a bottom sheet: the map keeps the selected hex in the part of the screen that is not covered. */
    sheet?: boolean;
    onSelect: (coord: string | null) => void;
    onHover?: (coord: string | null) => void;
  }

  let { view, selected, preview, sheet = false, onSelect, onHover }: Props = $props();

  const content = game.content;

  // ---------- what is drawn ----------

  /** Shapes drawn on a hex of a terrain: our own, one path each, in units of the hex. */
  const GLYPHS: Readonly<Record<string, { d: string; fill?: boolean }>> = {
    forest: { d: 'M-10 6L-5 -4L0 6Z M0 7L5 -7L10 7Z', fill: true },
    hills: { d: 'M-11 6Q-6 -6 -1 6M-3 6Q4 -8 11 6' },
    plains: {
      d: 'M-8 5V1M-8 5L-10 2M-8 5L-6 2M6 -1V-5M6 -1L4 -4M6 -1L8 -4M0 8V4M0 8L-2 5M0 8L2 5',
    },
    road: { d: 'M-12 8Q-3 3 0 0T12 -8' },
    river: { d: 'M-12 -4q4 -4 8 0t8 0t8 0M-12 4q4 -4 8 0t8 0t8 0' },
    lake: { d: 'M-10 0a10 6 0 1 0 20 0a10 6 0 1 0 -20 0M-5 0a5 3 0 1 0 10 0a5 3 0 1 0 -10 0' },
    coast: { d: 'M-11 -2q3 -3 5.5 0t5.5 0t5.5 0t5.5 0M-11 5q3 -3 5.5 0t5.5 0t5.5 0t5.5 0' },
    settlement: { d: 'M-8 7V-1L0 -8L8 -1V7Z', fill: true },
  };

  /** The mark of a named place by its role; any other role gets a plain disc. */
  const PLACE_MARKS: Readonly<Record<string, string>> = {
    settlement: 'M-7 6V-1L0 -8L7 -1V6ZM-2 6V1H2V6',
    training: 'M0 -9L2.5 -2.5L9 0L2.5 2.5L0 9L-2.5 2.5L-9 0L-2.5 -2.5Z',
    landmark: 'M-5 8V-8M-5 -8H7L3 -3L7 2H-5',
  };
  const PLACE_FALLBACK = 'M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0';

  /** The colour of a terrain: the token its data names, or ours. */
  const fillOf = (terrain: string | null): string | undefined => {
    if (terrain === null) return undefined;
    const token = content.terrains.find((x) => x.id === terrain)?.token;
    return `var(${token ?? `--terrain-${terrain}`})`;
  };

  const pipsOf = (h: MapHex): { filled: boolean }[] =>
    Array.from({ length: Math.min(h.info.maxLevel, 5) }, (_, i) => ({ filled: i < h.info.level }));

  const stateOf = (h: MapHex): 'here' | 'fog' | 'reach' | 'partial' | 'full' | 'marked' => {
    const i = h.info;
    if (i.here) return 'here';
    if (!i.surveyed) return i.inRange && i.surveyWhy === null ? 'reach' : 'fog';
    if (i.maxLevel > 0 && i.level >= i.maxLevel) return 'full';
    return i.level >= 1 ? 'partial' : 'marked';
  };

  const nameOf = (h: MapHex): string => {
    const cell = h.info.cell ? entityName({ kind: 'cell', id: h.info.cell }) : null;
    if (cell && cell !== MASK) return cell;
    const named = h.places.map((p) => t(`place.${p.id}.name`));
    if (named.length > 0) return named.join(', ');
    return h.terrain ? t(`terrain.${h.terrain}.name`) : t('map.hex.fog');
  };

  const label = (h: MapHex): string => `${nameOf(h)}, ${t(`map.state.${stateOf(h)}`)}`;

  // ---------- the camera ----------

  let width = $state(0);
  let height = $state(0);
  let cam = $state<Camera>({ x: 0, y: 0, k: 1 });
  let ready = false;
  /** The hex width, in screen units, that a new map starts at. */
  const START_HEX = 3 * 16;

  const zoomMin = $derived(fitZoom(view.bounds, width, height) * 0.9);
  const clamp = (c: Camera): Camera => clampCamera(c, view.bounds, width, height, zoomMin);

  /** The height of the map that a sheet leaves free, as a share of the whole. */
  const freeShare = $derived(sheet ? 0.3 : 0.5);

  export function focusOn(coord: string, zoom?: number): void {
    const p = pointOf(coord);
    if (!p || width === 0) return;
    cam = clamp(cameraAt(p, width / 2, height * freeShare, zoom ?? Math.max(cam.k, 1)));
  }

  export function showAll(): void {
    const k = fitZoom(view.bounds, width, height);
    const cx = (view.bounds.x0 + view.bounds.x1) / 2;
    const cy = (view.bounds.y0 + view.bounds.y1) / 2;
    cam = clamp(cameraAt({ x: cx, y: cy }, width / 2, height / 2, k));
  }

  export function centreOnMe(): void {
    if (view.here) focusOn(view.here, cam.k);
  }

  const zoomBy = (factor: number): void => {
    cam = clamp(zoomAbout(cam, factor, width / 2, height / 2));
  };

  // The first time the map has a size, it opens on the player at a size a finger can hit.
  $effect(() => {
    if (ready || width === 0 || height === 0) return;
    ready = true;
    untrack(() => {
      const k = Math.max(zoomMin, START_HEX / (SIZE * Math.sqrt(3)));
      const at = view.here ?? selected;
      const p = at ? pointOf(at) : null;
      cam = p
        ? clamp(cameraAt(p, width / 2, height / 2, k))
        : clamp(cameraAt({ x: 0, y: 0 }, width / 2, height / 2, k));
    });
  });

  // A resize keeps the map in view.
  $effect(() => {
    void width;
    void height;
    untrack(() => {
      if (ready) cam = clamp(cam);
    });
  });

  // ---------- pointer: drag, pinch, wheel ----------

  let svg: SVGSVGElement | undefined = $state();
  // Gesture bookkeeping that nothing renders from: a plain map, not a reactive one.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number; cam: Camera; moved: boolean; id: number } | null = null;
  let pinch: { d: number; cam: Camera; mid: { x: number; y: number } } | null = null;
  let panning = $state(false);
  const DRAG_START = 6;

  const local = (e: { clientX: number; clientY: number }) => {
    const box = svg?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  };

  function onPointerDown(e: PointerEvent): void {
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      const at = local(e);
      drag = { ...at, cam, moved: false, id: e.pointerId };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = {
        d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        cam,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      for (const id of pointers.keys()) svg?.setPointerCapture(id);
      panning = true;
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAbout(pinch.cam, d / pinch.d, pinch.mid.x, pinch.mid.y);
      cam = clamp({
        ...zoomed,
        x: zoomed.x + mid.x - pinch.mid.x,
        y: zoomed.y + mid.y - pinch.mid.y,
      });
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const at = local(e);
    const dx = at.x - drag.x;
    const dy = at.y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_START) {
      drag.moved = true;
      panning = true;
      svg?.setPointerCapture(e.pointerId);
    }
    if (drag.moved) cam = clamp({ x: drag.cam.x + dx, y: drag.cam.y + dy, k: drag.cam.k });
  }

  function onPointerUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      drag = null;
      panning = false;
    } else if (pointers.size === 1) {
      // One finger of a pinch is left: it pans from where it is now.
      const [id, at] = [...pointers.entries()][0] as [number, { x: number; y: number }];
      drag = { ...at, cam, moved: true, id };
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const at = local(e);
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    cam = clamp(zoomAbout(cam, factor, at.x, at.y));
  }

  $effect(() => {
    const el = svg;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---------- selection and keyboard ----------

  const byCoord = $derived(new Map(view.hexes.map((h) => [h.coord, h])));
  /** The hex that takes the focus when the player tabs into the map. */
  let focused = $state<string | null>(null);
  const tabStop = $derived(
    focused && byCoord.has(focused)
      ? focused
      : (selected ?? view.here ?? view.hexes[0]?.coord ?? null),
  );
  let prefer: 'east' | 'west' = 'east';

  function ensureVisible(coord: string): void {
    const p = pointOf(coord);
    if (!p) return;
    const sx = p.x * cam.k + cam.x;
    const sy = p.y * cam.k + cam.y;
    const margin = SIZE * 2 * cam.k;
    if (sx < margin || sx > width - margin || sy < margin || sy > height - margin)
      focusOn(coord, cam.k);
  }

  function onHexKey(e: KeyboardEvent, h: MapHex): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(h.coord);
      return;
    }
    if (e.key === 'Escape') {
      onSelect(null);
      return;
    }
    if (e.key === '+' || e.key === '=') {
      zoomBy(1.25);
      return;
    }
    if (e.key === '-') {
      zoomBy(0.8);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') prefer = 'west';
    if (e.key === 'ArrowRight') prefer = 'east';
    const next = stepByArrow(h, e.key as Arrow, (q, r) => byCoord.has(`${q},${r}`), prefer);
    if (!next) return;
    const coord = `${next.q},${next.r}`;
    focused = coord;
    ensureVisible(coord);
    queueMicrotask(() => svg?.querySelector<SVGElement>(`[data-hex="${coord}"]`)?.focus());
  }

  // ---------- route ----------

  const routePoints = $derived.by(() => {
    if (!preview || preview.hexes.length === 0 || !view.here) return null;
    const stops = [view.here, ...preview.hexes].flatMap((c) => {
      const p = pointOf(c);
      return p ? [p] : [];
    });
    return stops.length >= 2 ? stops : null;
  });
  const routeEnd = $derived(routePoints ? routePoints[routePoints.length - 1] : null);
  const routePath = $derived(
    routePoints
      ? `M${routePoints.map((p) => `${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join('L')}`
      : '',
  );
  const labelWidth = $derived(formatDuration(preview?.ms ?? 0).length * 7 + 16);

  const me = $derived(view.here ? pointOf(view.here) : null);
</script>

<div class="map" data-ui="map" class:panning bind:clientWidth={width} bind:clientHeight={height}>
  <svg
    bind:this={svg}
    class="canvas"
    role="group"
    aria-label={t('map.canvas')}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <defs>
      <pattern
        id="map-fog-hatch"
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="6" height="6" class="fog-base" />
        <line x1="0" y1="0" x2="0" y2="6" class="fog-line" />
      </pattern>
    </defs>
    <g transform="translate({cam.x} {cam.y}) scale({cam.k})">
      {#each view.hexes as h (h.coord)}
        {@const s = stateOf(h)}
        {@const glyph = h.terrain ? GLYPHS[h.terrain] : undefined}
        {@const mark = h.places[0]}
        <g
          class="hex {s}"
          class:selected={selected === h.coord}
          data-ui="hex"
          data-hex={h.coord}
          data-state={s}
          transform="translate({h.x} {h.y})"
          role="button"
          tabindex={tabStop === h.coord ? 0 : -1}
          aria-label={label(h)}
          aria-pressed={selected === h.coord}
          onclick={() => onSelect(h.coord)}
          onkeydown={(e) => onHexKey(e, h)}
          onfocus={() => (focused = h.coord)}
          onpointerenter={(e) => e.pointerType === 'mouse' && onHover?.(h.coord)}
          onpointerleave={(e) => e.pointerType === 'mouse' && onHover?.(null)}
        >
          <path d={HEX_PATH} class="face" style:--_fill={fillOf(h.terrain)} />
          {#if mark}
            <path
              d={PLACE_MARKS[mark.role] ?? PLACE_FALLBACK}
              class="place"
              data-place-role={mark.role}
              transform="translate(0 -2) scale(1.1)"
            />
          {:else if glyph}
            <path d={glyph.d} class="glyph" class:solid={glyph.fill} />
          {/if}
          {#if h.pois.length > 0}
            <g class="pois" aria-hidden="true">
              {#each h.pois.slice(0, 4) as kind, i (i)}
                <circle class="poi poi-{kind}" cx={-9 + i * 6} cy="-13" r="2.2" />
              {/each}
            </g>
          {/if}
          {#if s !== 'fog' && s !== 'reach'}
            <g class="pips" aria-hidden="true">
              {#each pipsOf(h) as pip, i (i)}
                {@const n = pipsOf(h).length}
                <circle
                  class="pip"
                  class:on={pip.filled}
                  cx={(i - (n - 1) / 2) * 5}
                  cy="13"
                  r="1.8"
                />
              {/each}
            </g>
          {/if}
        </g>
      {/each}

      {#if routePoints && routeEnd}
        <path class="route" d={routePath} data-route />
        <circle class="route-end" cx={routeEnd.x} cy={routeEnd.y} r="4" />
        <g
          transform="translate({routeEnd.x} {routeEnd.y - SIZE * 0.9}) scale({1 / cam.k})"
          class="route-label"
          data-route-label
        >
          <rect x={-labelWidth / 2} y="-18" width={labelWidth} height="22" rx="4" />
          <text text-anchor="middle" y="-3">
            {formatDuration(preview?.ms ?? 0)}
          </text>
        </g>
      {/if}

      {#if me}
        <g class="me" transform="translate({me.x} {me.y})" data-ui="map-token" aria-hidden="true">
          <circle r="8" class="halo" />
          <circle r="4.5" class="dot" />
        </g>
      {/if}
    </g>
  </svg>

  <div class="zoom" role="group" aria-label={t('map.zoom')}>
    <button type="button" data-zoom="in" aria-label={t('map.zoomIn')} onclick={() => zoomBy(1.4)}>
      <Icon name="lucide:plus" size={18} />
    </button>
    <button
      type="button"
      data-zoom="out"
      aria-label={t('map.zoomOut')}
      onclick={() => zoomBy(1 / 1.4)}
    >
      <Icon name="lucide:minus" size={18} />
    </button>
    <button type="button" data-zoom="me" aria-label={t('map.centerMe')} onclick={centreOnMe}>
      <Icon name="lucide:locate-fixed" size={18} />
    </button>
    <button type="button" data-zoom="all" aria-label={t('map.fitAll')} onclick={showAll}>
      <Icon name="lucide:maximize" size={18} />
    </button>
  </div>
</div>

<style>
  .map {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--map-sea);
    overflow: hidden;
  }

  .canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* The map handles drags and pinches itself. */
    touch-action: none;
    cursor: grab;
    user-select: none;
  }

  .panning .canvas {
    cursor: grabbing;
  }

  .fog-base {
    fill: var(--map-fog);
  }

  .fog-line {
    stroke: var(--map-fog-line);
    stroke-width: 2;
  }

  .hex {
    cursor: pointer;
    outline: none;
  }

  .face {
    fill: var(--_fill, url(#map-fog-hatch));
    stroke: var(--bg);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }

  .hex.fog .face {
    fill: url(#map-fog-hatch);
  }

  .hex.reach .face {
    fill: url(#map-fog-hatch);
    stroke: var(--accent);
    stroke-width: 1.6;
    stroke-dasharray: 4 3;
  }

  /* A hex that is marked but not yet surveyed to its first level, and one that is surveyed in part. */
  .hex.marked .face {
    stroke: var(--steel);
  }

  .hex.full .face {
    stroke: var(--accent);
    stroke-width: 1.6;
  }

  .hex:hover .face {
    filter: brightness(1.25);
  }

  .hex.selected .face {
    stroke: var(--fg);
    stroke-width: 2.6;
    stroke-dasharray: none;
  }

  .hex:focus-visible .face {
    stroke: var(--chakra);
    stroke-width: 3;
    stroke-dasharray: none;
  }

  .glyph {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.55;
    pointer-events: none;
  }

  .glyph.solid {
    fill: var(--bg);
    opacity: 0.4;
  }

  .place {
    fill: var(--paper);
    stroke: var(--paper-ink);
    stroke-width: 1.2;
    stroke-linejoin: round;
    pointer-events: none;
  }

  .poi {
    fill: var(--orange);
    stroke: var(--bg);
    stroke-width: 0.8;
  }

  .poi-zone {
    fill: var(--hanko);
  }

  .poi-training {
    fill: var(--chakra);
  }

  .poi-cache,
  .poi-vault {
    fill: var(--stamina);
  }

  .pip {
    fill: var(--bg);
    stroke: var(--paper);
    stroke-width: 0.7;
    opacity: 0.8;
  }

  .pip.on {
    fill: var(--accent);
    stroke: var(--bg);
  }

  .route {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 7 5;
    pointer-events: none;
  }

  .route-end {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 1.5;
    pointer-events: none;
  }

  .route-label {
    pointer-events: none;
  }

  .route-label rect {
    fill: var(--bg);
    stroke: var(--accent);
    stroke-width: 1;
  }

  .route-label text {
    fill: var(--fg);
    font-family: var(--font-text);
    font-size: var(--text-xs);
  }

  .me {
    pointer-events: none;
  }

  .halo {
    fill: var(--chakra);
    opacity: 0.35;
  }

  .dot {
    fill: var(--chakra);
    stroke: var(--paper);
    stroke-width: 1.6;
  }

  .zoom {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .zoom button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--control-md);
    min-height: var(--control-md);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    cursor: pointer;
  }

  .zoom button:hover {
    border-color: var(--accent);
  }
</style>
