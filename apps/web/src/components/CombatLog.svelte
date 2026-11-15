<script lang="ts">
  import type { LogEntry } from '../lib/game.svelte.ts';
  import { t } from '../lib/i18n.ts';
  import { formatInt } from '../lib/format.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** Lines of the battle log, oldest first. */
    entries: readonly LogEntry[];
  }

  let { entries }: Props = $props();

  /** The newest line is shown last; the list keeps itself scrolled to it. */
  let box: HTMLElement | undefined = $state();
  $effect(() => {
    void entries.length;
    if (box) box.scrollTop = box.scrollHeight;
  });
</script>

<div class="log" bind:this={box} role="log" aria-label={t('combat.log')} data-log>
  {#if entries.length === 0}
    <p class="empty">{t('combat.logEmpty')}</p>
  {/if}
  <ul>
    {#each entries as { id, event } (id)}
      <li data-side={event.type === 'combatLog' ? event.side : 'system'}>
        {#if event.type === 'enemyDefeated'}
          <span>{t('log.enemyDefeated')}</span> <EntityLink kind="enemy" id={event.enemy} />
        {:else if event.type === 'playerDefeated'}
          <span>{t('log.playerDefeated')}</span> <EntityLink kind="enemy" id={event.enemy} />
        {:else if event.side === 'enemy'}
          <EntityLink kind="enemy" id={event.enemy} />
          <span>{t(event.act === 'hit' ? 'log.enemyHit' : 'log.enemyMiss')}</span>
          {#if event.act === 'hit'}<span class="dmg"
              >{t('log.damage', { n: formatInt(event.dmg) })}</span
            >{/if}
        {:else if event.tech}
          <span
            >{t(
              event.act === 'cast' ? 'log.cast' : event.act === 'hit' ? 'log.hit' : 'log.miss',
            )}</span
          >
          <EntityLink kind="technique" id={event.tech} />
          {#if event.act === 'hit'}<span class="dmg"
              >{t('log.damage', { n: formatInt(event.dmg) })}</span
            >{/if}
        {:else}
          <span>{t(event.act === 'hit' ? 'log.basicHit' : 'log.basicMiss')}</span>
          {#if event.act === 'hit'}<span class="dmg"
              >{t('log.damage', { n: formatInt(event.dmg) })}</span
            >{/if}
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .log {
    max-height: 16rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow-y: auto;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    padding: 2px 0;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }

  li[data-side='enemy'] {
    color: var(--fg-dim);
  }

  li[data-side='system'] {
    color: var(--heading);
    font-weight: 600;
  }

  li :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  .dmg {
    color: var(--danger);
    font-variant-numeric: tabular-nums;
  }

  li[data-side='player'] .dmg {
    color: var(--success);
  }

  .empty {
    margin: 0;
    color: var(--fg-dim);
  }
</style>
