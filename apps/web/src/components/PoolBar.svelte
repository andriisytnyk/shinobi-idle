<script lang="ts">
  import { content, localeKey, type SkillId } from '@shinobi/content';
  import { poolCapacity } from '@shinobi/core';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';

  interface Props {
    skill: SkillId;
  }

  let { skill }: Props = $props();

  const capacity = $derived(poolCapacity(skill, content));
  const checkpoints = $derived(
    content.pools.filter((p) => p.skill === skill).sort((a, b) => a.pct - b.pct),
  );
  const xp = $derived(game.read((gs) => gs.pools[skill].xp));
  const fraction = $derived(capacity > 0 ? Math.min(1, xp / capacity) : 0);
</script>

{#if capacity > 0}
  <section class="pool" aria-label={t('pool.title')}>
    <h2>{t('pool.title')}</h2>
    <p class="amount">{formatInt(xp)} / {formatInt(capacity)}</p>
    <div
      class="bar"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(fraction * 100)}
    >
      <span class="fill" style:width="{fraction * 100}%"></span>
      {#each checkpoints as cp (cp.id)}
        <span class="tick" class:reached={fraction * 100 >= cp.pct} style:left="{cp.pct}%"></span>
      {/each}
    </div>
    <ul class="checkpoints">
      {#each checkpoints as cp (cp.id)}
        {@const reached = fraction * 100 >= cp.pct}
        <li class:reached data-checkpoint={cp.id}>
          <span class="pct"
            ><Icon name={reached ? 'lucide:check' : 'lucide:lock'} size={14} /> {cp.pct}%</span
          >
          <span class="text">{t(localeKey('pool', cp.id, 'desc'))}</span>
          {#if cp.mods.length > 0}
            <span class="state" data-active={reached}>
              {#if reached}
                <ModBreakdown keys={cp.mods.map((m) => m.key)} display={t('pool.active')} />
              {:else}
                {t('pool.inactive')}
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .pool {
    margin-top: var(--space-6);
  }

  h2 {
    margin: 0 0 var(--space-1);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.1rem;
    font-weight: 400;
  }

  .amount {
    margin: 0 0 var(--space-2);
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  .bar {
    position: relative;
    height: 0.75rem;
    border-radius: var(--radius-sm);
    background: var(--line);
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-sm);
    background: var(--accent);
  }

  .tick {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    background: var(--fg-dim);
  }

  .tick.reached {
    background: var(--fg);
  }

  .checkpoints {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    color: var(--fg-dim);
  }

  li.reached {
    color: var(--fg);
  }

  .state {
    margin-left: auto;
    font-size: 0.85rem;
  }

  .pct {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    width: 4.5rem;
    font-weight: 600;
  }

  li.reached .pct {
    color: var(--success);
  }
</style>
