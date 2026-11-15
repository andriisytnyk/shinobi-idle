<script lang="ts">
  import { content } from '@shinobi/content';
  import { actionInfo, SHARE_FULL } from '@shinobi/core';
  import { actionRef } from '../lib/entities.ts';
  import { senseiTestInfo } from '../lib/exam-test.ts';
  import { formatDuration, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Row {
    slot: number;
    ref: ReturnType<typeof actionRef>;
    fraction: number;
    /** Skill XP per hour; null for actions that pay none by the hour (fights, exams). */
    xpPerHour: number | null;
  }

  const rows = $derived.by((): Row[] => {
    const state = game.state;
    const out: Row[] = [];
    state.slots.forEach((slot, index) => {
      if (!slot.action) return;
      const info = actionInfo(state, slot.action, content, game.rules);
      // Fights and exams are not skill tiles, so their cycle comes straight from their kind.
      const kind = game.rules.actionKinds[slot.action.kind];
      const intervalMs =
        info?.intervalMs ?? kind?.intervalMs(state, slot.action.id, content, game.rules);
      if (intervalMs === undefined) return;
      out.push({
        slot: index,
        ref: actionRef(slot.action),
        fraction: Math.min(1, slot.progress / (intervalMs * SHARE_FULL)),
        xpPerHour: info ? (info.xpPerHour * slot.share) / SHARE_FULL : null,
      });
    });
    return out;
  });

  /** On a phone the bar is one line; the toggle opens the other slots. */
  let expanded = $state(false);
  const shown = $derived(expanded ? rows : rows.slice(0, 1));

  const wait = $derived(senseiTestInfo(game.state, game.rules, content));

  const stop = (slot: number) => void game.dispatch({ type: 'action.stop', slot });
</script>

<footer class="now" aria-label={t('now.title')}>
  <span class="title">{t('now.title')}</span>
  {#if rows.length === 0}
    <span class="idle">{t('now.idle')}</span>
  {:else}
    <ul class="slots">
      {#each shown as row (row.slot)}
        <li class="slot" data-slot={row.slot}>
          <span class="name"><EntityLink kind={row.ref.kind} id={row.ref.id} /></span>
          <span
            class="bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(row.fraction * 100)}
            aria-label={t('now.progress')}
          >
            <span class="fill" style:width="{row.fraction * 100}%"></span>
          </span>
          <span class="xph"
            >{#if row.xpPerHour !== null}{t('tile.xphValue', {
                n: formatXp(row.xpPerHour),
              })}{/if}</span
          >
          {#if wait && wait.slot === row.slot}
            <span class="wait" data-exam-wait
              >{t('rank.testLeft', { time: formatDuration(wait.left) })}</span
            >
          {/if}
          <button type="button" class="stop" onclick={() => stop(row.slot)}>{t('now.stop')}</button>
        </li>
      {/each}
    </ul>
    {#if rows.length > 1}
      <button
        type="button"
        class="more"
        aria-expanded={expanded}
        aria-label={t('now.more')}
        onclick={() => (expanded = !expanded)}
      >
        <Icon name={expanded ? 'lucide:chevron-down' : 'lucide:plus'} size={16} />
        {#if !expanded}<span>{rows.length - 1}</span>{/if}
      </button>
    {/if}
  {/if}
</footer>

<style>
  .now {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--now-height);
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--line);
    background: var(--surface);
  }

  .title {
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 0.85rem;
  }

  .idle {
    flex: 1;
    color: var(--fg-dim);
  }

  .slots {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .slot {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .name {
    flex: none;
    max-width: 14rem;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name :global(a:hover) {
    text-decoration: underline;
  }

  .bar {
    flex: 1;
    height: 6px;
    min-width: 3rem;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .wait {
    flex: none;
    color: var(--accent);
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .xph {
    flex: none;
    color: var(--fg-dim);
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .stop,
  .more {
    min-height: 2rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .more {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  @media (max-width: 768px) {
    .now {
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      font-size: 0.85rem;
    }

    .title,
    .xph {
      display: none;
    }

    .name {
      max-width: 8rem;
    }

    /* Whole-tap targets of at least 44 px on a phone. */
    .stop,
    .more {
      min-width: 2.75rem;
      min-height: 2.75rem;
    }
  }
</style>
