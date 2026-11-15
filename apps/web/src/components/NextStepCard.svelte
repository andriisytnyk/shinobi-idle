<script lang="ts">
  import { content } from '@shinobi/content';
  import { t } from '../lib/i18n.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import NatureOffer from './NatureOffer.svelte';
  import QuestObjective from './QuestObjective.svelte';

  const step = $derived(game.read((gs) => nextStep(gs, content)));
</script>

{#if step}
  <section class="next" data-next-step aria-label={t('next.title')}>
    <p class="quest"><EntityLink kind="quest" id={step.quest.id} /></p>
    <p class="text">{t(step.quest.steps[step.index]?.textKey ?? '')}</p>
    <div class="objective"><QuestObjective quest={step.quest} index={step.index} /></div>
    <a class="go" href={step.target} data-go>{t('next.go')}</a>
  </section>
{:else}
  <NatureOffer />
  <p class="empty">{t('next.done')}</p>
{/if}

<style>
  .next {
    padding: var(--space-3);
    border: 1px dashed var(--accent);
    border-radius: var(--radius);
  }

  .quest {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--font-size-0-9);
  }

  .quest :global(a) {
    color: inherit;
  }

  .text {
    margin: var(--space-2) 0;
  }

  .objective {
    margin-bottom: var(--space-3);
  }

  .go {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-size);
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font-weight: 600;
    text-decoration: none;
  }

  .empty {
    margin: 0;
    color: var(--fg-dim);
  }
</style>
