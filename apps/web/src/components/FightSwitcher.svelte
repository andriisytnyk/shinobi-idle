<script lang="ts">
  import { entityName } from '../lib/entities.ts';
  import { fightView } from '../lib/fight-view.svelte.ts';
  import { t } from '../lib/i18n.ts';
  import { fightersOf, performersOf } from '../lib/squad.ts';
  import { game } from '../lib/store.ts';

  const content = game.content;
  /** The performers that fight now; the switcher shows when there are several. */
  const fighters = $derived(game.read((gs) => fightersOf(performersOf(gs, content, game.rules))));
  /** The slot whose fight is shown: the one the fight screen and the battle log share. */
  const current = $derived(fightView.shown(fighters.map((p) => p.slot)));
</script>

{#if fighters.length > 1}
  <div class="switcher" data-ui="fight-switcher" role="tablist" aria-label={t('squad.fight.title')}>
    {#each fighters as p (p.id)}
      <button
        type="button"
        role="tab"
        class:active={current === p.slot}
        aria-selected={current === p.slot}
        data-performer={p.n}
        onclick={() => (fightView.chosen = p.slot)}
      >
        <span class="who">{p.clone ? t('squad.clone', { n: p.n }) : t('squad.you')}</span>
        {#if p.ref}<span class="what">{entityName(p.ref)}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .switcher {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
  }

  button {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: flex-start;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  button.active {
    border-color: var(--danger);
    font-weight: 600;
  }

  .what {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }
</style>
