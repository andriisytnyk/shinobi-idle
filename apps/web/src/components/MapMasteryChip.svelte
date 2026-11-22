<script lang="ts">
  import { mapMastery } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';
  import ModLine from './ModLine.svelte';

  const content = game.content;

  const mastery = $derived(game.read((gs) => mapMastery(gs, content)));
  let open = $state(false);
</script>

<button
  type="button"
  class="chip"
  data-mastery-chip
  aria-expanded={open}
  aria-controls="map-mastery-tiers"
  onclick={() => (open = !open)}
>
  <Icon name="lucide:map" size={14} />
  {t('map.mastery.chip', { n: mastery.count, total: mastery.total })}
</button>
{#if open}
  <section class="tiers-box" id="map-mastery-tiers" data-ui="map-mastery" data-map-mastery>
    <h3>{t('map.mastery.title')}</h3>
    <p class="small">
      {t('map.mastery.progress', { n: mastery.count, total: mastery.total })}
    </p>
    <ul class="tiers">
      {#each mastery.tiers as tier, i (i)}
        <li class="tier" class:reached={tier.reached} data-tier-reached={tier.reached}>
          <Icon name={tier.reached ? 'lucide:check' : 'lucide:minus'} size={14} />
          <span
            >{tier.need === mastery.total
              ? t('map.mastery.tierAll')
              : t('map.mastery.tier', { n: tier.need })}
            {#each tier.mods as m, j (j)}{j > 0 ? ', ' : ''}<ModLine mod={m} />{/each}</span
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--control-sm);
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .chip[aria-expanded='true'] {
    border-color: var(--accent);
  }

  .tiers-box {
    flex: 0 0 100%;
    box-sizing: border-box;
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .small {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
  }

  .tiers {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tier {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .tier.reached {
    color: var(--fg);
  }
</style>
