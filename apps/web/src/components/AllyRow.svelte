<script lang="ts">
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import type { FighterView, Outcome } from '../lib/fight-scene.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import StatBar from './StatBar.svelte';
  import TimeBar from './TimeBar.svelte';

  /*
   * A body of the player's side that is not the character (a combat clone), drawn small: a name,
   * health and chakra on one line each, and what it is doing with its own progress. The arena holds
   * as many of these as the fight has, so one is a few lines, never a card.
   */

  interface Props {
    f: FighterView;
    /** What young actions did to this body: the last figure that flew off it. */
    outcomes?: readonly Outcome[];
  }

  let { f, outcomes = [] }: Props = $props();

  const action = $derived(f.action);
  const technique = $derived(f.phase === 'act' && action?.kind === 'technique' && action.id);
  const label = $derived(
    f.heldBy !== null ? 'held' : f.phase === 'wait' ? 'wait' : technique ? 'cast' : 'basic',
  );
  const pop = $derived(outcomes.find((o) => o.kind === 'damage' || o.kind === 'dodge'));
</script>

<article
  class="ally"
  class:down={!f.alive}
  data-ui="fighter"
  data-side="player"
  data-ally={f.ally}
  data-alive={f.alive}
>
  <header class="head">
    <span class="face"><Icon name="fist" size={20} /></span>
    <h3 class="name" data-fighter="ally">{t('fight.ally', { n: f.ally ?? f.nth })}</h3>
    {#if !f.alive}<span class="down-tag">{t('fight.down')}</span>{/if}
    {#if pop}
      <span class="pop" data-ui="fight-outcome" data-kind="pop" data-outcome={pop.kind}>
        {#if pop.kind === 'damage'}<span class="dmg"
            >{t('fight.out.damage', { n: formatInt(pop.amount) })}</span
          >{:else}<span class="dodge">{t('fight.out.dodged')}</span>{/if}
      </span>
    {/if}
  </header>

  {#if f.alive}
    <div class="bars">
      <StatBar label={t('combat.hpBar')} value={f.hp} max={f.maxHp} tone="hp" dense />
      {#if f.maxChakra > 0}
        <StatBar
          label={t('combat.chakraBar')}
          value={f.chakra}
          max={f.maxChakra}
          tone="chakra"
          dense
        />
      {/if}
    </div>

    <div class="action" data-ui="fight-action" data-phase={f.phase} data-action={label}>
      {#if label === 'cast' && action?.id}
        <ActionEmblem kind="technique" id={action.id} size="sm" />
      {:else}
        <ActionEmblem
          kind="fight"
          id={label}
          icon={label === 'wait'
            ? 'lucide:hourglass'
            : label === 'held'
              ? 'lucide:zap-off'
              : 'fist'}
          size="sm"
        />
      {/if}
      <p class="what">
        {#if label === 'cast' && action?.id}
          <EntityLink kind="technique" id={action.id} />
        {:else}
          <span class="verb">{t(`fight.action.${label}`)}</span>
        {/if}
      </p>
      <TimeBar timing={f.timing} size="thin" tone="chakra" label={t('fight.progress')} />
    </div>
  {/if}
</article>

<style>
  .ally {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .ally.down {
    opacity: 0.6;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .face {
    display: inline-flex;
    color: var(--steel);
  }

  .name {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: 400;
  }

  .down-tag {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .pop {
    margin-left: auto;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .dmg {
    color: var(--danger);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .dodge {
    color: var(--chakra);
    font-weight: 600;
  }

  .bars {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .action {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-2);
    row-gap: var(--space-1);
  }

  .action > :global(.emblem) {
    grid-row: 1 / span 2;
  }

  .what {
    margin: 0;
    min-width: 0;
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .verb {
    color: var(--fg-dim);
  }

  .what :global(a) {
    display: inline;
    min-height: 0;
    color: var(--accent);
    font-weight: 600;
  }

  .action > :global(.time-bar) {
    grid-column: 2;
  }

  /* On a phone a clone is two lines: the name beside the bars, then what it does beside its progress. */
  @media (max-width: 768px) {
    .ally {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      column-gap: var(--space-2);
      row-gap: 0;
      padding: var(--space-1) var(--space-2);
    }

    .face {
      display: none;
    }

    .bars {
      flex-direction: row;
      gap: var(--space-2);
    }

    .bars > :global(*) {
      flex: 1 1 0;
      min-width: 0;
    }

    .action {
      grid-column: 1 / -1;
      grid-template-columns: minmax(0, 1fr) minmax(var(--space-8), 35%);
    }

    .action > :global(.emblem) {
      display: none;
    }

    .what {
      grid-column: 1;
    }

    .action > :global(.time-bar) {
      grid-column: 2;
    }
  }
</style>
