<script lang="ts">
  import { content } from '@shinobi/content';
  import type { Quest } from '@shinobi/content';
  import { evalReq } from '@shinobi/core';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { counterEnemy, counterProgress, withoutRankRows } from '../lib/next-step.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    quest: Quest;
    /** Index of the step whose objective this is. */
    index: number;
  }

  let { quest, index }: Props = $props();

  const objective = $derived(quest.steps[index]?.objective);
  const result = $derived(
    game.read((gs) =>
      objective?.t === 'req' ? withoutRankRows(evalReq(gs, objective.req, content)) : null,
    ),
  );
  const counted = $derived(
    game.read((gs) =>
      objective?.t === 'counter' ? counterProgress(gs, quest, index, objective) : null,
    ),
  );
  const enemy = $derived(objective?.t === 'counter' ? counterEnemy(objective.counter) : null);
  const fraction = $derived(counted && counted.of > 0 ? counted.n / counted.of : 0);
  const met = $derived(counted !== null && counted.n >= counted.of);
</script>

{#if result}
  <ReqTree node={result} />
{:else if counted}
  <div class="row" class:met data-met={met} data-counter>
    <span class="mark"><Icon name={met ? 'lucide:check' : 'lucide:minus'} size={14} /></span>
    <span class="label">
      {#if enemy}
        <span class="detail">{t('quests.kill')}</span> <EntityLink kind="enemy" id={enemy} />
      {:else}
        <span class="detail">{t('quests.counter')}</span>
      {/if}
    </span>
    <span class="count">{formatInt(counted.n)} / {formatInt(counted.of)}</span>
    <span class="bar" aria-hidden="true"
      ><span class="fill" style:width="{fraction * 100}%"></span></span
    >
  </div>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'mark label count'
      '. bar bar';
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
    font-size: var(--font-size-0-85);
  }

  .count {
    grid-area: count;
    font-size: var(--font-size-0-85);
    font-variant-numeric: tabular-nums;
  }

  .bar {
    grid-area: bar;
    height: var(--bar-3);
    border-radius: var(--radius-2);
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
