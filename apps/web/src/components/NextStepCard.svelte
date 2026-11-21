<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { game } from '../lib/store.ts';
  import NatureOffer from './NatureOffer.svelte';
  import QuestStepCard from './QuestStepCard.svelte';

  const content = game.content;

  const step = $derived(game.read((gs) => nextStep(gs, content)));
</script>

{#if step}
  <QuestStepCard {step} />
{:else}
  <NatureOffer />
  <p class="empty">{t('next.done')}</p>
{/if}

<style>
  .empty {
    margin: 0;
    color: var(--fg-dim);
  }
</style>
