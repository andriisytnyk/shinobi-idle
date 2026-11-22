<script lang="ts">
  import type { Quest } from '@shinobi/content';
  import { evalReq, NATURES_GAINED } from '@shinobi/core';
  import { stepStatus } from '../lib/next-step.ts';
  import { formatInt } from '../lib/format.ts';
  import { currencyName, currencyOf, held } from '../lib/vocab.ts';
  import { t } from '../lib/i18n.ts';
  import {
    asMet,
    counterEnemy,
    counterLabel,
    counterMission,
    counterProgress,
    counterRegion,
    withoutRankRows,
  } from '../lib/next-step.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';
  import WhereToLook from './WhereToLook.svelte';

  const content = game.content;

  interface Props {
    quest: Quest;
    /** Index of the step whose objective this is. */
    index: number;
  }

  let { quest, index }: Props = $props();

  const objective = $derived(quest.steps[index]?.objective);
  const result = $derived(
    game.read((gs) => {
      if (objective?.t !== 'req') return null;
      const shown = withoutRankRows(evalReq(gs, objective.req, content));
      // A finished step stays met, though the mint or the ointments were spent later.
      return stepStatus(gs, quest, index) === 'done' ? asMet(shown) : shown;
    }),
  );
  const counted = $derived(
    game.read((gs) =>
      objective?.t === 'counter' ? counterProgress(gs, quest, index, objective) : null,
    ),
  );
  const enemy = $derived(objective?.t === 'counter' ? counterEnemy(objective.counter) : null);
  const mission = $derived(objective?.t === 'counter' ? counterMission(objective.counter) : null);
  /** The region an `explored.<region>` counter counts cells of. */
  const label = $derived(objective?.t === 'counter' ? counterLabel(objective.counter) : null);
  const where = $derived(objective?.t === 'counter' ? counterRegion(objective.counter) : null);
  /** A payment objective: the currency, how much it costs and what the player holds. */
  const payment = $derived(
    game.read((gs) => {
      if (objective?.t !== 'pay') return null;
      const id = currencyOf(content, objective.role);
      const status = stepStatus(gs, quest, index);
      return {
        n: objective.n,
        // A paid step counts as paid in full, whatever the purse holds now.
        have: status === 'done' ? objective.n : id === null ? 0 : held(gs, id),
        name: id === null ? '' : currencyName(id),
        done: status === 'done',
        active: status === 'current',
      };
    }),
  );
  let payError = $state<string | null>(null);

  function pay(): void {
    const result = game.dispatch({ type: 'quest.pay', quest: quest.id });
    payError = result.ok ? null : result.reason;
  }
  const fraction = $derived(counted && counted.of > 0 ? counted.n / counted.of : 0);
  const met = $derived(counted !== null && counted.n >= counted.of);
</script>

{#if result}
  <ReqTree node={result} />
{:else if counted}
  <div class="row" class:met data-met={met} data-counter>
    <span class="mark"><Icon name={met ? 'lucide:check' : 'lucide:minus'} size={14} /></span>
    <span class="label">
      {#if objective?.t === 'counter' && objective.also?.length}
        <span class="detail">{t('quests.killsMany')}</span>
      {:else if where}
        <span class="detail">{t(where.surveyed ? 'quests.surveyed' : 'quests.explored')}</span>
        <EntityLink kind="region" id={where.region} />
      {:else if enemy}
        <span class="detail">{t('quests.kill')}</span>
        <EntityLink
          kind={content.bosses.some((b) => b.id === enemy) ? 'boss' : 'enemy'}
          id={enemy}
        />
      {:else if mission}
        <span class="detail">{t('quests.mission')}</span> <EntityLink kind="mission" id={mission} />
      {:else if label}
        <span class="detail">{t(label.key, label.params)}</span>
        {#if objective?.t === 'counter' && objective.counter === NATURES_GAINED}
          <a href="#/nature">{t('req.natureLink')}</a>
        {/if}
      {:else}
        <span class="detail">{t('quests.counter')}</span>
      {/if}
    </span>
    <span class="count">{formatInt(counted.n)} / {formatInt(counted.of)}</span>
    <span class="bar" aria-hidden="true"
      ><span class="fill" style:width="{fraction * 100}%"></span></span
    >
    {#if enemy && !met}
      <div class="look"><WhereToLook target={{ kind: 'enemy', id: enemy }} /></div>
    {/if}
  </div>
{:else if payment}
  <div class="row" class:met={payment.done} data-met={payment.done} data-pay>
    <span class="mark"
      ><Icon name={payment.done ? 'lucide:check' : 'lucide:minus'} size={14} /></span
    >
    <span class="label">
      <span class="detail">{t('quests.pay')}</span>
      {payment.name}
    </span>
    <span class="count"
      >{formatInt(Math.min(payment.have, payment.n))} / {formatInt(payment.n)}</span
    >
    {#if payment.active}
      <button type="button" class="pay" disabled={payment.have < payment.n} onclick={pay}>
        {t('quests.payButton')}
      </button>
      {#if payError}<p class="error" role="alert">{t(payError)}</p>{/if}
    {/if}
  </div>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'mark label count'
      '. bar bar'
      '. look look';
    align-items: center;
    column-gap: var(--space-2);
    padding: var(--space-1) 0;
    color: var(--fg-dim);
  }

  .row.met {
    color: var(--fg);
  }

  .mark {
    grid-area: mark;
    display: inline-flex;
  }

  .met .mark {
    color: var(--success);
  }

  .label {
    grid-area: label;
    min-width: 0;
  }

  .label :global(a) {
    color: var(--fg);
    font-weight: 600;
  }

  .detail {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .pay {
    grid-column: 2 / -1;
    justify-self: start;
    min-height: var(--control-sm);
    margin-top: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .pay:disabled {
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg-dim);
    cursor: default;
  }

  .error {
    grid-column: 2 / -1;
    margin: 0;
    color: var(--danger);
    font-size: var(--text-xs);
  }

  .count {
    grid-area: count;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .look {
    grid-area: look;
  }

  .bar {
    grid-area: bar;
    height: var(--bar-thin);
    border-radius: var(--radius-xs);
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .met .fill {
    background: var(--success);
  }
</style>
