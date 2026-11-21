<script lang="ts">
  import { natureStatus } from '@shinobi/core';
  import { senseiTestInfo } from '../lib/exam-test.ts';
  import { formatDuration } from '../lib/format.ts';
  import { suggestGoal } from '../lib/goal.ts';
  import { t } from '../lib/i18n.ts';
  import { activeSteps } from '../lib/next-step.ts';
  import { game } from '../lib/store.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import EntityLink from './EntityLink.svelte';
  import GoalItem from './GoalItem.svelte';
  import Hint from './Hint.svelte';
  import NatureOffer from './NatureOffer.svelte';
  import QuestStepCard from './QuestStepCard.svelte';

  const content = game.content;

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const wait = $derived(game.read((gs) => senseiTestInfo(gs, game.rules, content)));
  /** The goals the player pinned, in pin order. */
  const goals = $derived(game.read((gs) => [...gs.goals]));
  /** The active step of each chain of the main story: always shown, first, and never unpinned. */
  const story = $derived(
    game.read((gs) => activeSteps(gs, content).filter((s) => s.quest.main === true)),
  );
  /** With nothing pinned the nearest technique is suggested, below the story. */
  const suggestion = $derived(
    game.read((gs) => (gs.goals.length > 0 ? null : suggestGoal(gs, content))),
  );
  /** A story card already leads to the nature test, so the test is offered separately only when none does. */
  const offerNature = $derived(
    game.read((gs) => !(story.length > 0 && natureStatus(gs, content).stage === 'test')),
  );

  function pinSuggestion(): void {
    if (suggestion) game.dispatch({ type: 'goal.pin', ref: { kind: 'technique', id: suggestion } });
  }
</script>

<aside id="meta-panel" class="meta" aria-label={t('meta.title')} data-ui="goal-panel">
  <div class="head">
    <h2>{t('meta.title')}</h2>
    <button type="button" class="close" onclick={onClose}>{t('meta.close')}</button>
  </div>

  <Hint id="goalPanel" />

  {#if offerNature}<NatureOffer />{/if}

  {#if wait}
    <p class="wait" data-exam-wait role="status">
      {t('exam.wait', { time: formatDuration(wait.left) })}
    </p>
  {/if}

  {#if story.length > 0}
    <section class="story" data-story aria-label={t('meta.story')}>
      <h3>{t('meta.story')}</h3>
      {#each story as step (step.quest.id)}
        <QuestStepCard {step} />
      {/each}
    </section>
  {/if}

  {#if goals.length > 0}
    <section class="pinned" data-pinned-goals aria-label={t('meta.pinned')}>
      <h3>{t('meta.pinned')}</h3>
      {#each goals as goal (`${goal.kind}:${goal.id}`)}
        <GoalItem {goal} />
      {/each}
    </section>
  {:else}
    {#if story.length === 0}<p class="empty">{t('meta.empty')}</p>{/if}
    {#if suggestion}
      <div class="suggest" data-suggestion>
        <p>{t('meta.suggest')}</p>
        <p class="target"><EntityLink kind="technique" id={suggestion} /></p>
        <button type="button" class="pin" onclick={pinSuggestion}>{t('meta.pin')}</button>
      </div>
    {/if}
  {/if}
  <Slot name="goal.panel" />
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
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
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
    font-size: var(--text-sm);
    font-weight: 400;
  }

  h3 {
    margin: 0 0 var(--space-2);
    color: var(--fg-dim);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
  }

  .story {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .pinned {
    display: grid;
    gap: var(--space-3);
  }

  .empty {
    margin: 0 0 var(--space-3);
    color: var(--fg-dim);
  }

  .wait {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-md);
    font-weight: 600;
  }

  .suggest {
    padding: var(--space-3);
    border: var(--border-thin) dashed var(--line);
    border-radius: var(--radius-md);
  }

  .suggest p {
    margin: 0 0 var(--space-2);
  }

  .target :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  .pin {
    min-height: var(--control-md);
    margin-top: var(--space-3);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
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
