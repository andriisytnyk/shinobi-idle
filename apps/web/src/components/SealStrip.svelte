<script lang="ts">
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { sealWindows, type PracticeView } from '../lib/timing.ts';
  import { timeProgress, type ProgressTiming } from '../lib/time-progress.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** Ids of the seals in casting order. */
    seals: readonly string[];
    /** The running practice of this technique; without it the strip is still. */
    view?: PracticeView | null;
    /** Kanji only, with the names on hover and tap: for a tile. */
    compact?: boolean;
  }

  let { seals, view = null, compact = false }: Props = $props();

  const content = game.content;
  const glyphOf = (id: string) => content.seals.find((s) => s.id === id)?.glyph ?? '?';
  const windows = $derived(view ? sealWindows(view.phases) : []);
  const sweep = $derived(view?.sweep ?? false);
  const idle: ProgressTiming = { fraction: 0, cycleMs: 0, running: false };
  const timing = $derived(view?.timing ?? idle);

  /** Slope of the lighting ramp: a step in the discrete mode, one seal's window in a sweep. */
  const slope = (i: number): number => {
    const w = windows[i];
    if (!w) return 1000;
    return sweep ? 1 / Math.max(0.001, w.to - w.from) : 1000;
  };
</script>

<div
  class="live"
  class:compact
  data-seal-strip
  data-mode={view ? (sweep ? 'sweep' : 'steps') : 'still'}
  data-phase={view?.phase.name}
  data-seal={view && view.phase.name === 'seal' ? view.phase.seal : undefined}
  use:timeProgress={timing}
>
  <ol class="strip" aria-label={t('technique.seals')}>
    {#each seals as id, i (i)}
      {@const w = windows[i]}
      <li
        class="seal"
        data-seal-index={i}
        title={compact ? entityName({ kind: 'seal', id }) : undefined}
        style:--_a={w?.from}
        style:--_b={w?.to}
        style:--_k={slope(i)}
      >
        <span class="glyph" lang="ja">{glyphOf(id)}</span>
        {#if !compact}<span class="name"><EntityLink kind="seal" {id} /></span>{/if}
      </li>
    {/each}
  </ol>
  {#if compact && view && !sweep}
    <p class="caption" aria-hidden="true">
      {#each seals as id, i (i)}
        {@const w = windows[i]}
        <span class="cap" style:--_a={w?.from} style:--_b={w?.to} style:--_k={slope(i)}
          >{entityName({ kind: 'seal', id })}</span
        >
      {/each}
    </p>
  {/if}
</div>

<style>
  .live {
    min-width: 0;
  }

  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .seal {
    --_min-width: 4rem;
    --_a: 2;
    --_b: 3;
    --_k: 1000;
    /* How far into this seal's window the cycle is: on is 1 once it began, off once it ended. */
    --_on: clamp(0, (var(--tp, 0) - var(--_a)) * var(--_k), 1);
    --_off: clamp(0, (var(--tp, 0) - var(--_b)) * var(--_k), 1);
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    min-width: var(--_min-width);
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }

  .compact .seal {
    --_min-width: 0;
    padding: 0 var(--space-1);
    border-color: transparent;
    background: none;
  }

  .glyph {
    position: relative;
    color: var(--accent);
    font-family: var(--font-kanji);
    font-size: var(--text-display);
    line-height: 1;
  }

  .compact .glyph {
    font-size: var(--text-lg);
  }

  .name {
    font-size: var(--text-xs);
  }

  /* A running strip: the seals not yet made are dim, the one being made is bigger and lit. */
  [data-mode='steps'] .seal,
  [data-mode='sweep'] .seal {
    opacity: calc(0.45 + 0.55 * var(--_on));
  }

  [data-mode='steps'] .seal {
    transform: scale(calc(1 + 0.3 * (var(--_on) - var(--_off))));
    border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
  }

  /* A sweep lights the strip from end to end; nothing is enlarged. */
  [data-mode='sweep'] .seal::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--accent);
    opacity: calc(0.3 * var(--_on));
    pointer-events: none;
  }

  [data-mode='steps'] .seal::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--accent);
    opacity: calc(0.28 * (var(--_on) - var(--_off)));
    pointer-events: none;
  }

  /* The name of the seal being made, under the strip; all names share one cell. */
  .caption {
    display: grid;
    margin: var(--space-1) 0 0;
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .cap {
    --_a: 2;
    --_b: 3;
    --_k: 1000;
    grid-area: 1 / 1;
    opacity: calc(
      clamp(0, (var(--tp, 0) - var(--_a)) * var(--_k), 1) -
        clamp(0, (var(--tp, 0) - var(--_b)) * var(--_k), 1)
    );
  }
</style>
