<script lang="ts">
  import { entityName } from '../lib/entities.ts';
  import { formatSeconds } from '../lib/format.ts';
  import type { HandView } from '../lib/fight-scene.ts';
  import { t } from '../lib/i18n.ts';
  import { entityAttr } from '../lib/reveal.ts';
  import type { ProgressTiming } from '../lib/time-progress.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import EntityLink from './EntityLink.svelte';
  import TimeBar from './TimeBar.svelte';

  interface Props {
    hand: readonly HandView[];
    /** The progress of the cast under way (the `casting` technique's bar). */
    timing: ProgressTiming;
  }

  let { hand, timing }: Props = $props();

  const oneDecimal = new Intl.NumberFormat('uk', { maximumFractionDigits: 1 });

  const costOf = (h: HandView): string =>
    t(h.pool === 'chakra' ? 'fight.hand.costChakra' : 'fight.hand.costStamina', {
      n: oneDecimal.format(h.cost),
    });

  /** The reason a technique waits, in words; the same text is the tooltip and the spoken label. */
  function reason(h: HandView): string {
    switch (h.state) {
      case 'casting':
        return t('fight.hand.casting');
      case 'cooldown':
        return t('fight.hand.cooldown', { s: formatSeconds(h.leftMs) });
      case 'chakra':
        return t('fight.hand.chakra', { cost: costOf(h) });
      case 'stamina':
        return t('fight.hand.stamina', { cost: costOf(h) });
      case 'stance':
        return t('fight.hand.stance');
      case 'spent':
        return t('fight.hand.spent');
      default:
        return t('fight.hand.ready');
    }
  }

  /** The short text printed on the chip itself. */
  function short(h: HandView): string {
    switch (h.state) {
      case 'cooldown':
        return formatSeconds(h.leftMs);
      case 'chakra':
        return t('fight.hand.shortChakra', { cost: costOf(h) });
      case 'stamina':
        return t('fight.hand.shortStamina', { cost: costOf(h) });
      case 'stance':
        return t('fight.hand.shortStance');
      case 'spent':
        return t('fight.hand.shortSpent');
      default:
        return '';
    }
  }

  const label = (h: HandView): string =>
    t('fight.hand.label', { name: entityName({ kind: 'technique', id: h.id }), state: reason(h) });
</script>

{#if hand.length > 0}
  <section class="hand" data-ui="fight-hand" aria-label={t('fight.hand.title')}>
    <h4 class="title">{t('fight.hand.title')}</h4>
    <ul class="chips">
      {#each hand as h (h.id)}
        <li
          class="chip"
          data-ui="fight-hand-chip"
          data-state={h.state}
          data-entity={entityAttr({ kind: 'technique', id: h.id })}
          title={label(h)}
          aria-label={label(h)}
        >
          <ActionEmblem kind="technique" id={h.id} size="sm" />
          <span class="body">
            <span class="name"><EntityLink kind="technique" id={h.id} /></span>
            <span class="note" data-hand-note>{short(h)}</span>
          </span>
          {#if h.state === 'casting'}
            <TimeBar {timing} size="thin" tone="chakra" />
          {:else if h.state === 'cooldown' && h.cooldownMs > 0}
            <span class="drain" aria-hidden="true"
              ><span class="fill" style:width="{Math.min(100, (h.leftMs / h.cooldownMs) * 100)}%"
              ></span></span
            >
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .hand {
    min-width: 0;
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .title {
    margin: 0 0 var(--space-1);
    color: var(--fg-dim);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chip {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    overflow: hidden;
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    font-size: var(--text-xs);
  }

  .chip[data-state='ready'],
  .chip[data-state='casting'] {
    border-color: var(--accent);
  }

  .chip[data-state='cooldown'],
  .chip[data-state='stance'],
  .chip[data-state='spent'] {
    color: var(--fg-dim);
  }

  .chip[data-state='chakra'],
  .chip[data-state='stamina'] {
    color: var(--fg-dim);
    border-style: dashed;
  }

  .body {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-weight: 600;
  }

  .note {
    font-variant-numeric: tabular-nums;
    color: var(--fg-dim);
  }

  .note:empty {
    display: none;
  }

  .drain,
  .chip > :global(.time-bar) {
    position: absolute;
    inset: auto 0 0 0;
    height: var(--bar-thin);
  }

  .drain {
    background: var(--line);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  /* Phone: one scrolling row inside the box, chips compact; the name stays in the label. */
  @media (max-width: 768px) {
    .chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: var(--space-1);
    }

    .chip {
      flex: none;
    }

    .name {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .note {
      color: inherit;
    }
  }
</style>
