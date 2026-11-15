<script lang="ts">
  import type { NatureId } from '@shinobi/content';
  import type { NatureConsequences, NatureSetSummary } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    nature: NatureId;
    cons: NatureConsequences;
    /** What the natures owned so far plus this one would open; shown while an extra nature is being chosen. */
    together?: NatureSetSummary | null;
    /** Label of the action button, or null when the nature cannot be chosen now. */
    action: 'choose' | 'add' | null;
    onPick: (nature: NatureId) => void;
  }

  let { nature, cons, together = null, action, onPick }: Props = $props();
</script>

<li
  class="card"
  class:owned={cons.owned}
  data-nature={nature}
  data-owned={cons.owned}
  data-native={cons.native}
  style:--nature-color={`var(--nature-${nature})`}
>
  <header>
    <span class="icon"><Icon entity={{ kind: 'skill', id: nature }} size={28} /></span>
    <div class="title">
      <h3><EntityLink kind="skill" id={nature} /></h3>
      <p class="character">{t(`nature.character.${nature}`)}</p>
    </div>
    {#if cons.native}
      <span class="badge" data-badge="native">{t('nature.native')}</span>
    {:else if cons.owned}
      <span class="badge" data-badge="owned">{t('nature.owned')}</span>
    {/if}
  </header>

  <dl>
    <div class="row" data-row="missions">
      <dt>{t('nature.cons.missions')}</dt>
      <dd>
        {#each cons.missions as id (id)}<EntityLink kind="mission" {id} />{:else}<span class="none"
            >—</span
          >{/each}
      </dd>
    </div>
    <div class="row" data-row="buildings">
      <dt>{t('nature.cons.buildings')}</dt>
      <dd>
        {#each cons.buildings as id (id)}<EntityLink kind="building" {id} />{:else}<span
            class="none">—</span
          >{/each}
      </dd>
    </div>
    <div class="row" data-row="cells">
      <dt>{t('nature.cons.cells')}</dt>
      <dd>
        {#each cons.cells as id (id)}<EntityLink kind="cell" {id} />{:else}<span class="none"
            >—</span
          >{/each}
      </dd>
    </div>
    <div class="row" data-row="traits">
      <dt>{t('nature.cons.traits')}</dt>
      <dd>
        {#each cons.traits as id (id)}<EntityLink kind="trait" {id} />{:else}<span class="none"
            >—</span
          >{/each}
      </dd>
    </div>
    <div class="row" data-row="wheel">
      <dt>{t('nature.cons.wheel')}</dt>
      <dd>
        <span class="pair"
          >{t('nature.cons.strong')} <EntityLink kind="skill" id={cons.strongAgainst} /></span
        >
        <span class="pair"
          >{t('nature.cons.weak')} <EntityLink kind="skill" id={cons.weakAgainst} /></span
        >
      </dd>
    </div>
    <div class="row" data-row="team">
      <dt>{t('nature.team')}</dt>
      <dd>
        <span class="pair"
          >{t('nature.cons.rival')} <EntityLink kind="skill" id={cons.rival} /></span
        >
        <span class="pair">{t('nature.cons.aya')} <EntityLink kind="skill" id={cons.aya} /></span>
      </dd>
    </div>
    <div class="row" data-row="combos">
      <dt>{t('nature.cons.combos')}</dt>
      <dd>
        {#each cons.combos as id (id)}<EntityLink kind="combo" {id} />{:else}<span class="none"
            >—</span
          >{/each}
      </dd>
    </div>
  </dl>

  {#if together}
    <p class="together" data-together>
      {t('nature.cons.together', {
        m: together.missions.ids.length,
        mt: together.missions.total,
        b: together.buildings.ids.length,
        bt: together.buildings.total,
        c: together.cells.ids.length,
        ct: together.cells.total,
      })}
    </p>
  {/if}

  {#if action}
    <button type="button" class="pick" data-pick={nature} onclick={() => onPick(nature)}>
      {t(action === 'choose' ? 'nature.choose' : 'nature.add')}
    </button>
  {/if}
</li>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-top: 4px solid var(--nature-color);
    border-radius: var(--radius);
    background: var(--surface);
    list-style: none;
  }

  .card.owned {
    background: var(--surface-raised);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .icon {
    display: inline-flex;
    color: var(--nature-color);
  }

  .title {
    flex: 1;
    min-width: 0;
  }

  h3 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.15rem;
    font-weight: 400;
  }

  h3 :global(a) {
    color: inherit;
  }

  .character {
    margin: 0;
    color: var(--fg-dim);
  }

  .badge {
    padding: 0 var(--space-2);
    border: 1px solid var(--nature-color);
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
  }

  dl {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  .row {
    min-width: 0;
  }

  dt {
    color: var(--fg-dim);
    font-size: 0.8rem;
  }

  dd {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    margin: 0;
    overflow-wrap: anywhere;
  }

  dd :global(a) {
    color: var(--accent);
  }

  .pair {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .none {
    color: var(--fg-dim);
  }

  .together {
    margin: 0;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    font-size: 0.9rem;
  }

  .pick {
    min-height: 2.75rem;
    margin-top: auto;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--nature-color);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .pick:hover {
    background: var(--nature-color);
    color: var(--ink-900);
  }
</style>
