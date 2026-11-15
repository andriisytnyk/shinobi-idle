<script lang="ts">
  import { content } from '@shinobi/content';
  import { evalReq } from '@shinobi/core';
  import { suggestGoal, techniqueGoal } from '../lib/goal.ts';
  import { t } from '../lib/i18n.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Hint from './Hint.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const goal = $derived(settings.goal);
  const result = $derived(goal ? evalReq(game.state, goal, content) : null);
  const suggestion = $derived(goal ? null : suggestGoal(game.state, content));

  function pinSuggestion(): void {
    const req = suggestion ? techniqueGoal(suggestion, content) : null;
    if (req) settings.pinGoal(req);
  }
</script>

<aside id="meta-panel" class="meta" aria-label={t('meta.title')}>
  <div class="head">
    <h2>{t('meta.title')}</h2>
    <button type="button" class="close" onclick={onClose}>{t('meta.close')}</button>
  </div>

  <Hint id="goalPanel" text="hint.goal" />

  {#if result}
    <div class="tree" data-goal>
      <ReqTree node={result} />
    </div>
    {#if result.met}<p class="done">{t('meta.done')}</p>{/if}
    <button type="button" class="unpin" onclick={() => settings.unpinGoal()}>
      {t('meta.unpin')}
    </button>
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
