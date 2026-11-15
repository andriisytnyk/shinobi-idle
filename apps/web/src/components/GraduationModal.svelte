<script lang="ts">
  import { content } from '@shinobi/content';
  import { examFor } from '@shinobi/core';
  import { webRef } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Modal from './Modal.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const exam = $derived(examFor(content, 'genin'));
  /** Skills that opened with the rank. */
  const unlocked = $derived(
    content.skills.filter((s) => s.unlockReq?.t === 'rank' && s.unlockReq.rank === 'genin'),
  );
  const goal = $derived(webRef(game.state.goal));
  const reward = $derived(exam?.rewards.items ?? []);

  function toBank(): void {
    onClose();
    navigate('#/bank');
  }
</script>

<Modal title={t('graduation.title')} {onClose}>
  <!-- A link inside the dialog leaves the page, so the dialog closes with it. -->
  <div
    data-graduation
    role="presentation"
    onclick={(e) => {
      if (e.target instanceof Element && e.target.closest('a')) onClose();
    }}
  >
    <p>{t('graduation.body')}</p>

    <h3>{t('graduation.rank')}</h3>
    <p class="rank">{t(`rank.${game.state.player.rank}`)}</p>

    {#if unlocked.length > 0}
      <h3>{t('graduation.unlocked')}</h3>
      <ul>
        {#each unlocked as skill (skill.id)}
          <li><EntityLink kind="skill" id={skill.id} /></li>
        {/each}
      </ul>
    {/if}

    {#if reward.length > 0}
      <h3>{t('graduation.reward')}</h3>
      <ul>
        {#each reward as r (r.item)}
          <li><EntityLink kind="item" id={r.item} /> &times;{r.n}</li>
        {/each}
      </ul>
      <p class="note">{t('graduation.scrollHint')}</p>
    {/if}

    {#if goal}
      <h3>{t('graduation.goal')}</h3>
      <p><EntityLink kind={goal.kind} id={goal.id} /></p>
    {/if}
  </div>
  {#snippet actions()}
    <button type="button" onclick={toBank}>{t('graduation.bank')}</button>
    <button type="button" class="primary" onclick={onClose}>{t('graduation.close')}</button>
  {/snippet}
</Modal>

<style>
  h3 {
    margin: var(--space-3) 0 var(--space-1);
    color: var(--heading);
    font-size: 0.95rem;
  }

  ul {
    margin: 0;
    padding-left: var(--space-4);
  }

  p {
    margin: 0;
  }

  .rank {
    font-family: var(--font-heading);
    font-size: 1.2rem;
  }

  .note {
    margin-top: var(--space-1);
    color: var(--fg-dim);
    font-size: 0.9rem;
  }

  div :global(a) {
    color: var(--accent);
    font-weight: 600;
  }
</style>
