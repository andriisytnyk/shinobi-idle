<script lang="ts">
  import { listRegions, travelBlocked, walkMs } from '@shinobi/core';
  import { formatDuration } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { entryCellOf } from '../lib/world.ts';
  import EntityLink from './EntityLink.svelte';

  const content = game.content;

  interface Props {
    region: string;
  }

  let { region }: Props = $props();

  const entry = $derived(entryCellOf(region));
  /** Shown only for an open region the player does not stand in. */
  const data = $derived(
    game.read((gs) => {
      const info = listRegions(gs, content).find((r) => r.id === region);
      const cell = content.cells.find((c) => c.id === entry);
      if (!info || !info.open || info.here || !cell) return null;
      return {
        blocked: travelBlocked(gs, cell.id, content),
        walkMs: walkMs(gs, cell, content, game.rules),
      };
    }),
  );

  const go = (mode: 'instant' | 'walk') =>
    void game.dispatch({ type: 'world.travel', cell: entry ?? '', mode, slot: 0 });
</script>

{#if data && entry}
  <section class="entry" data-region-entry={region}>
    <p class="where">
      {t('world.entry.where')}
      <EntityLink kind="cell" id={entry} />
    </p>
    <div class="buttons">
      <button
        type="button"
        class="primary"
        data-region-enter
        disabled={data.blocked !== null}
        onclick={() => go('instant')}
      >
        {t('world.entry.go')} · {t('world.travel.free')}
      </button>
      <button
        type="button"
        class="secondary"
        data-region-walk
        disabled={data.blocked !== null}
        onclick={() => go('walk')}
      >
        {t('world.travel.walk')} · {formatDuration(data.walkMs)}
      </button>
    </div>
    {#if data.blocked}<p class="why" data-why="entry">{t(data.blocked)}</p>{/if}
  </section>
{/if}

<style>
  .entry {
    margin: 0 0 var(--space-3);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .where {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
  }

  .where :global(a) {
    font-weight: 600;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  button {
    --_flex: 10rem;
    flex: 1 1 var(--_flex);
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .primary {
    background: var(--accent);
    color: var(--ink-900);
  }

  .secondary {
    background: var(--surface-raised);
    color: var(--fg);
  }

  button:disabled {
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg-dim);
    cursor: not-allowed;
  }

  .why {
    margin: var(--space-1) 0 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }
</style>
