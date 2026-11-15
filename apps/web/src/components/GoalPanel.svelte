<script lang="ts">
  import { content } from '@shinobi/content';
  import { evalReq } from '@shinobi/core';
  import { webRef } from '../lib/entities.ts';
  import { goalReq, suggestGoal } from '../lib/goal.ts';
  import { t } from '../lib/i18n.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Hint from './Hint.svelte';
  import NextStepCard from './NextStepCard.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const goal = $derived(game.state.goal);
  const goalRef = $derived(webRef(goal));
  const req = $derived(goal ? goalReq(goal, content) : null);
  const result = $derived(req ? evalReq(game.state, req, content) : null);
  const quest = $derived(goal ? null : nextStep(game.state, content));
  /** With nothing pinned and no quest under way, the nearest technique is suggested. */
  const suggestion = $derived(goal || quest ? null : suggestGoal(game.state, content));

  function pinSuggestion(): void {
    if (suggestion) game.dispatch({ type: 'goal.set', ref: { kind: 'technique', id: suggestion } });
  }
</script>

<aside id="meta-panel" class="meta" aria-label={t('meta.title')}>
  <div class="head">
    <h2>{t('meta.title')}</h2>
    <button type="button" class="close" onclick={onClose}>{t('meta.close')}</button>
  </div>

  <Hint id="goalPanel" />

  {#if goal}
    <div class="tree" data-goal>
      {#if result}
        <ReqTree node={result} />
      {:else if goalRef}
        <p class="target"><EntityLink kind={goalRef.kind} id={goalRef.id} /></p>
      {/if}
    </div>
    {#if result?.met}<p class="done">{t('meta.done')}</p>{/if}
    <button type="button" class="unpin" onclick={() => game.dispatch({ type: 'goal.clear' })}>
      {t('meta.unpin')}
    </button>
  {:else if quest}
    <div data-suggestion="quest"><NextStepCard /></div>
  {:else}
    <p class="empty">{t('meta.empty')}</p>
    {#if suggestion}
      <div class="suggest" data-suggestion>
        <p>{t('meta.suggest')}</p>
        <p class="target"><EntityLink kind="technique" id={suggestion} /></p>
        <button type="button" class="pin" onclick={pinSuggestion}>{t('meta.pin')}</button>
      </div>
    {/if}
  {/if}
</aside>

<style>
  .meta {
    padding: var(--space-4);
    background: var(--surface);
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  .close {
    display: none;
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
  }

  @media (max-width: 768px) {
    .close {
      display: inline-block;
    }
  }

  h2 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1rem;
    font-weight: 400;
  }

  .empty {
    margin: 0 0 var(--space-3);
    color: var(--fg-dim);
  }

  .done {
    margin: var(--space-2) 0;
    color: var(--success);
    font-weight: 600;
  }

  .suggest {
    padding: var(--space-3);
    border: 1px dashed var(--line);
    border-radius: var(--radius);
  }

  .suggest p {
    margin: 0 0 var(--space-2);
  }

  .target :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  .pin,
  .unpin {
    min-height: 2.75rem;
    margin-top: var(--space-3);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .pin {
    margin-top: 0;
    border-color: var(--accent);
  }
</style>
