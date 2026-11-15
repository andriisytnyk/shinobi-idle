<script lang="ts">
  import type { Modifier } from '@shinobi/core';
  import { isEntityKind } from '../lib/entities.ts';
  import { formatBonus } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** The figure as shown; pressing it opens the list of its parts. */
    display: string;
    /** The parts a forecast or selector already worked out, each with its source. */
    parts: Modifier[];
    /** What the figure is before any bonus, as text. */
    base?: string;
    /** The base as a number, for the machine-readable line. */
    baseRaw?: number;
    /** Extra lines after the parts (a ration, a floor, the runs per hour), already as text; `raw` is the number behind the text. */
    notes?: { label: string; value: string; id?: string; raw?: number }[];
  }

  let { display, parts, base, baseRaw, notes = [] }: Props = $props();

  let open = $state(false);

  const valueText = (m: Modifier): string =>
    m.op === 'mul' ? `×${m.value}` : formatBonus(1 + m.value);
</script>

<span class="mod">
  <button type="button" class="figure" aria-expanded={open} onclick={() => (open = !open)}>
    {display}
  </button>
  {#if open}
    <span class="list" role="group" aria-label={t('mod.title')}>
      {#if base !== undefined}
        <span class="line" data-line="base" data-raw={baseRaw}
          ><span>{t('mod.base')}</span><span>{base}</span></span
        >
      {/if}
      {#each parts as part, i (i)}
        <span
          class="line"
          data-line="part"
          data-op={part.op}
          data-group={part.group}
          data-raw={part.value}
        >
          <span class="source">
            {#if typeof part.source !== 'string' && isEntityKind(part.source.kind)}
              <EntityLink kind={part.source.kind} id={part.source.id} />
            {:else if typeof part.source === 'string'}
              {hasKey(part.source) ? t(part.source) : part.source}
            {/if}
          </span>
          <span>{valueText(part)}</span>
        </span>
      {/each}
      {#each notes as note (note.label)}
        <span class="line" data-line="note" data-key={note.id} data-raw={note.raw}
          ><span>{note.label}</span><span>{note.value}</span></span
        >
      {/each}
      {#if parts.length === 0 && notes.length === 0}
        <span class="line none">{t('mod.none')}</span>
      {/if}
    </span>
  {/if}
</span>

<style>
  .mod {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .figure {
    padding: 0;
    border: 0;
    border-bottom: var(--border-thin) dotted var(--fg-dim);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .figure:hover,
  .figure[aria-expanded='true'] {
    border-bottom-color: var(--accent);
    color: var(--accent);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: var(--card-min);
    max-width: 100%;
    margin-top: var(--space-1);
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: var(--text-xs);
  }

  .line {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .none {
    color: var(--fg-dim);
  }

  /* Whole-tap targets of at least 44 px on a phone. */
  @media (max-width: 768px) {
    .figure {
      display: inline-flex;
      align-items: center;
      min-width: var(--control-md);
      min-height: var(--control-md);
    }
  }
</style>
