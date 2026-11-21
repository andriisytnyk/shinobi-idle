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
  import { squadFigures } from '../lib/squad.ts';
  import { squadUi } from '../lib/squad-ui.svelte.ts';
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

  /** The mark drawn on a hex of a terrain: the path its data gives (a pack's terrain draws the same way); none for a bare hex. */
  const glyphs = new Map(
    content.terrains.flatMap((x) =>
      x.glyph ? [[x.id, { d: x.glyph, fill: x.glyphFill === true }] as const] : [],
    ),
  );

  /** The mark of a named place by its role; any other role gets a plain disc. */
  const PLACE_MARKS: Readonly<Record<string, string>> = {
    settlement: 'M-7 6V-1L0 -8L7 -1V6ZM-2 6V1H2V6',
    training: 'M0 -9L2.5 -2.5L9 0L2.5 2.5L0 9L-2.5 2.5L-9 0L-2.5 -2.5Z',
    landmark: 'M-5 8V-8M-5 -8H7L3 -3L7 2H-5',
  };
  const PLACE_FALLBACK = 'M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0';
  /** The marker of a point of interest: a diamond (filled once found), a flag for an outpost, a question mark while only a hint is known. */
  const POINT_DIAMOND = 'M0 -4L3.4 0L0 4L-3.4 0Z';
  const POINT_FLAG = 'M-2.5 4V-4M-2.5 -4H3.5L1.5 -1.8L3.5 0.4H-2.5';

  /** The colour of a terrain: the token its data names, or ours. */
  const fillOf = (terrain: string | null): string | undefined => {
    if (terrain === null) return undefined;
    const token = content.terrains.find((x) => x.id === terrain)?.token;
    return `var(${token ?? `--terrain-${terrain}`})`;
  };

  /** Who surveys each hex now, by hex key; the performer's mark is «Ти» for the character, «К1» for a clone. */
  const surveyingAt = $derived(
    new Map(
      view.surveying.map((s) => [
        s.coord,
        { ...s, mark: s.slot === 0 ? t('squad.you') : t('map.mark.clone', { n: s.slot }) },
      ]),
    ),
  );
  /** The place of each hex in the plan of the auto-survey, counted from 1. */
  const orderAt = $derived(new Map(view.autoOrder.map((c, i) => [c, i + 1])));

  const pipsOf = (h: MapHex): { filled: boolean }[] =>
    Array.from({ length: Math.min(h.info.maxLevel, 5) }, (_, i) => ({ filled: i < h.info.level }));

  const stateOf = (h: MapHex): 'here' | 'fog' | 'reach' | 'partial' | 'full' | 'marked' => {
    const i = h.info;
    if (i.here) return 'here';
    if (!i.surveyed) return i.inRange && i.surveyWhy === null ? 'reach' : 'fog';
    if (i.maxLevel > 0 && i.level >= i.maxLevel) return 'full';
    return i.level >= 1 ? 'partial' : 'marked';
  };

  /** A surveyed hex the performer cannot enter, cross or survey for want of a key (water without the way to walk on it). */
  const shut = (h: MapHex): boolean => h.info.keys.some((k) => !k.req.met);
  const BRIDGE = 'M-5 1Q0 -4 5 1M-5 3H5M-3 1V3M3 1V3';
  const FORD = 'M-5 0H-3M-1 0H1M3 0H5M-4 3H-2M0 3H2M4 3H5';
  const LOCK = 'M-3 0V-2a3 3 0 0 1 6 0V0M-4 0H4V5H-4Z';

  const nameOf = (h: MapHex): string => {
    const cell = h.info.cell ? entityName({ kind: 'cell', id: h.info.cell }) : null;
    if (cell && cell !== MASK) return cell;
    const named = h.places.map((p) => t(`place.${p.id}.name`));
    if (named.length > 0) return named.join(', ');
    return h.terrain ? t(`terrain.${h.terrain}.name`) : t('map.hex.fog');
  };

  // A hex in fog is already "a hex in fog": the state is said only when it adds something.
  const label = (h: MapHex): string => {
    const s = stateOf(h);
    const state = s === 'fog' ? nameOf(h) : `${nameOf(h)}, ${t(`map.state.${s}`)}`;
    const named = h.info.crossing ? `${state}, ${t(`map.crossing.${h.info.crossing}`)}` : state;
    return shut(h) ? `${named}, ${t('map.state.shut')}` : named;
  };

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
      if (!ready) return;
      cam = clamp(cam);
      // After a change of size (a window made narrow, a phone turned) the player may be off screen: bring them back.
      const p = view.here ? pointOf(view.here) : null;
      if (!p) return;
      const sx = p.x * cam.k + cam.x;
      const sy = p.y * cam.k + cam.y;
      if (sx < 0 || sx > width || sy < 0 || sy > height) focusOn(view.here ?? '', cam.k);
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
  /** Where each figure stands around its hex's centre; clones on one hex take the corners in turn. */
  const CORNERS: readonly (readonly [number, number])[] = [
    [8, -8],
    [-8, -8],
    [8, 8],
    [-8, 8],
    [0, -12],
    [0, 12],
  ];
  const figures = $derived(game.read((gs) => squadFigures(gs, game.content, game.rules)));
  const others = $derived.by(() => {
    const seen: Record<string, number> = {};
    return figures.flatMap((f) => {
      const p = pointOf(f.coord);
      if (!p) return [];
      const turn = seen[f.coord] ?? 0;
      seen[f.coord] = turn + 1;
      const [dx, dy] = CORNERS[turn % CORNERS.length] ?? [8, -8];
      return [{ ...f, x: p.x + dx, y: p.y + dy }];
    });
  });

  const figureLabel = (f: { n: number; state: string }): string =>
    t('squad.map.figure', { n: f.n, state: t(`squad.state.${f.state}`) });

  function pickFigure(id: number): void {
    squadUi.pick(squadUi.picked === id ? null : id);
  }

  function onFigureKey(event: KeyboardEvent, id: number): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    pickFigure(id);
  }
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
        {@const glyph = h.terrain ? glyphs.get(h.terrain) : undefined}
        {@const mark = h.places[0]}
        <g
          class="hex {s}"
          class:shut={shut(h)}
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
          {#if h.info.points.length > 0}
            <g class="points" data-ui="map-point" aria-hidden="true">
              {#each h.info.points as point, i (i)}
                <g transform="translate({9 - i * 8} -13)" data-point-status={point.status}>
                  {#if point.status === 'veiled'}
                    <circle class="point veiled" r="3.6" />
                    <text class="point-q" font-size="6" text-anchor="middle" y="2.2">?</text>
                  {:else}
                    <path
                      class="point {point.status}"
                      class:active={point.active && point.power.length > 0}
                      d={point.travel !== null ? POINT_FLAG : POINT_DIAMOND}
                      data-point-outpost={point.travel !== null ? '' : undefined}
                    />
                  {/if}
                </g>
              {/each}
            </g>
          {/if}
          {#if surveyingAt.get(h.coord)}
            {@const who = surveyingAt.get(h.coord)}
            <path d={HEX_PATH} class="surveying" data-surveying={who?.slot} aria-hidden="true" />
            <g class="who" data-survey-mark aria-hidden="true" transform="translate(7 8)">
              <rect x="-9" y="-6" width="18" height="11" rx="3" />
              <text text-anchor="middle" y="2.5" font-size="7">{who?.mark}</text>
            </g>
          {/if}
          {#if orderAt.get(h.coord)}
            {@const n = orderAt.get(h.coord)}
            <g
              class="order"
              class:current={n === 1}
              data-auto-order={n}
              aria-hidden="true"
              transform="translate(-11 -9)"
            >
              <circle r="5.5" />
              <text text-anchor="middle" y="2.4" font-size="7">{n}</text>
            </g>
          {/if}
          {#if h.info.crossing}
            <path
              d={h.info.crossing === 'bridge' ? BRIDGE : FORD}
              class="crossing"
              data-crossing={h.info.crossing}
              aria-hidden="true"
              transform="translate(-8 8) scale(0.9)"
            />
          {/if}
          {#if shut(h)}
            <path
              d={LOCK}
              class="lock"
              data-shut
              aria-hidden="true"
              transform="translate(8 8) scale(0.9)"
            />
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

      {#each view.links as link (link.id)}
        <path
          class="link link-{link.kind.replace(/[^a-z0-9_-]/gi, '')}"
          d="M{link.a.x} {link.a.y}L{link.b.x} {link.b.y}"
          aria-hidden="true"
        />
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

      {#each others as f (f.id)}
        <g
          class="figure"
          class:picked={squadUi.picked === f.n}
          class:idle={f.state === 'idle'}
          transform="translate({f.x} {f.y})"
          data-ui="map-token"
          data-figure={f.slot}
          data-performer={f.n}
          data-state={f.state}
          role="button"
          tabindex="0"
          aria-label={figureLabel(f)}
          aria-pressed={squadUi.picked === f.n}
          onclick={(e) => {
            e.stopPropagation();
            pickFigure(f.id);
          }}
          onkeydown={(e) => onFigureKey(e, f.id)}
        >
          <circle r="6.5" class="dot" />
          <text class="num" text-anchor="middle" dy="0.35em">{f.n}</text>
          {#if f.state === 'idle'}<circle class="idle-mark" cx="5" cy="-5" r="2.4" />{/if}
        </g>
      {/each}

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

  .link {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 2 5;
    stroke-linecap: round;
    opacity: 0.8;
    pointer-events: none;
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

  /* The hex being surveyed: a ring that breathes, still when motion is reduced. */
  .surveying {
    fill: none;
    stroke: var(--chakra);
    stroke-width: 2.4;
    pointer-events: none;
    animation: survey-pulse 1.6s ease-in-out infinite;
  }

  @keyframes survey-pulse {
    50% {
      stroke-opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .surveying {
      animation: none;
    }
  }

  .who rect {
    fill: var(--chakra);
  }

  .who text {
    fill: var(--ink-900);
    font-weight: 700;
  }

  .order circle {
    fill: var(--surface-raised);
    stroke: var(--accent);
    stroke-width: 1.2;
  }

  .order.current circle {
    fill: var(--accent);
  }

  .order text {
    fill: var(--fg);
    font-weight: 700;
  }

  .order.current text {
    fill: var(--ink-900);
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

  /* A hex shut for want of a key: a dashed edge and a lock, so that it reads as «not yet». */
  .hex.shut .face {
    stroke-dasharray: 3 2;
  }

  .crossing {
    fill: none;
    stroke: var(--fg);
    stroke-width: 1.4;
    stroke-linecap: round;
    pointer-events: none;
  }

  .lock {
    fill: var(--bg);
    stroke: var(--fg);
    stroke-width: 1.2;
    stroke-linejoin: round;
    stroke-linecap: round;
    pointer-events: none;
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

  .point {
    fill: none;
    stroke: var(--paper);
    stroke-width: 1;
    stroke-linejoin: round;
  }

  .point.found {
    fill: var(--accent);
    stroke: var(--bg);
  }

  .point.active {
    fill: var(--chakra);
  }

  .point.veiled {
    fill: var(--bg);
    stroke: var(--paper);
  }

  .point-q {
    fill: var(--paper);
    font-weight: 700;
    pointer-events: none;
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

  .figure {
    cursor: pointer;
  }

  .figure .dot {
    fill: var(--leaf);
  }

  .figure.picked .dot {
    stroke: var(--accent);
    stroke-width: 2.4;
  }

  .figure:focus-visible .dot {
    stroke: var(--accent);
  }

  .num {
    fill: var(--ink-900);
    --_size: 8px;
    font-size: var(--_size);
    font-weight: 700;
    pointer-events: none;
  }

  .idle-mark {
    fill: var(--stamina);
    stroke: var(--ink-900);
    stroke-width: 0.8;
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
