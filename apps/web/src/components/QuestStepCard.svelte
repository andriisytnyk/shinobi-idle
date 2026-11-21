<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { idAttr } from '../lib/reveal.ts';
  import type { NextStep } from '../lib/next-step.ts';
  import EntityLink from './EntityLink.svelte';
  import PinGoal from './PinGoal.svelte';
  import QuestObjective from './QuestObjective.svelte';
  import StepGo from './StepGo.svelte';

  interface Props {
    /** The active step of a quest chain: its text, progress and the way to where it is done. */
    step: NextStep;
  }

  let { step }: Props = $props();
</script>

<section class="next" data-next-step data-quest={idAttr('quest', step.quest.id)} aria-label={t('next.title')}>
  <div class="head">
    <p class="quest"><EntityLink kind="quest" id={step.quest.id} /></p>
    <PinGoal kind="quest" id={step.quest.id} always />
  </div>
  <p class="text">{t(step.quest.steps[step.index]?.textKey ?? '')}</p>
  <div class="objective"><QuestObjective quest={step.quest} index={step.index} /></div>
  <StepGo target={step.target} />
</section>

<style>
  .next {
    padding: var(--space-3);
    border: var(--border-thin) dashed var(--accent);
    border-radius: var(--radius-md);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .quest {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-xs);
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
</style>
