<script lang="ts">
  import { examFor } from '@shinobi/core';
  import { webRef } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { isAcademyRank } from '@shinobi/core';
  import { rankEntries } from '../lib/rank-ladder.ts';
  import { rankName } from '../lib/vocab.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Modal from './Modal.svelte';

  const content = game.content;

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  /** The rank the player has just reached and the exam that led to it. */
  const reached = $derived(game.read((gs) => gs.player.rank));
  const exam = $derived(examFor(content, reached));
  /** The rank before it: the Academy's graduation is told in the Academy's words, any other promotion in general ones. */
  const previous = $derived(
    content.playerRanks[content.playerRanks.findIndex((r) => r.id === reached) - 1]?.id ?? '',
  );
  const fromAcademy = $derived(isAcademyRank(content, previous));
  /** What the new rank opens, from the data: skills and missions whose requirement names it. */
  const opens = $derived(rankEntries(content, reached).find((e) => e.id === reached)?.opens ?? []);
  /** Skills that opened with the rank. */
  const unlocked = $derived(
    content.skills.filter((s) => s.unlockReq?.t === 'rank' && s.unlockReq.rank === reached),
  );
  const goal = $derived(game.read((gs) => webRef(gs.goals[gs.goals.length - 1] ?? null)));
  /** The chakra paper test is the first thing a new genin does: until a nature is chosen the screen is offered. */
  const needsTest = $derived(fromAcademy && game.read((gs) => gs.player.natures.length === 0));
  const reward = $derived(exam?.rewards.items ?? []);

  function toNature(): void {
    onClose();
    navigate('#/nature');
  }

  function toBank(): void {
    onClose();
    navigate('#/bank');
  }
</script>

<Modal title={t(fromAcademy ? 'graduation.title' : 'graduation.promoted.title')} {onClose}>
  <!-- A link inside the dialog leaves the page, so the dialog closes with it. -->
  <div
    data-graduation
    role="presentation"
    onclick={(e) => {
      if (e.target instanceof Element && e.target.closest('a')) onClose();
    }}
  >
    <p>{t(fromAcademy ? 'graduation.body' : 'graduation.promoted.body')}</p>

    <h3>{t('graduation.rank')}</h3>
    <p class="rank">{rankName(reached)}</p>

    {#if needsTest}
      <section class="test" data-nature-test>
        <h3>{t('graduation.nature')}</h3>
        <p>{t('graduation.natureBody')}</p>
      </section>
    {/if}

    {#if !fromAcademy && opens.length > 0}
      <h3>{t('graduation.unlocked')}</h3>
      <ul data-opens>
        {#each opens as ref (ref.kind + ref.id)}
          <li><EntityLink kind={ref.kind} id={ref.id} /></li>
        {/each}
      </ul>
    {:else if unlocked.length > 0}
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
      {#if reward.some((r) => content.items.find((i) => i.id === r.item)?.scroll)}
        <p class="note">{t('graduation.scrollHint')}</p>
      {/if}
    {/if}

    {#if goal}
      <h3>{t('graduation.goal')}</h3>
      <p><EntityLink kind={goal.kind} id={goal.id} /></p>
    {/if}
  </div>
  {#snippet actions()}
    {#if needsTest}
      <button type="button" class="primary" data-nature-go onclick={toNature}>
        {t('graduation.natureGo')}
      </button>
    {/if}
    <button type="button" onclick={toBank}>{t('graduation.bank')}</button>
    <button type="button" class={needsTest ? '' : 'primary'} onclick={onClose}
      >{t('graduation.close')}</button
    >
  {/snippet}
</Modal>

<style>
  h3 {
    margin: var(--space-3) 0 var(--space-1);
    color: var(--heading);
    font-size: var(--text-sm);
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
    font-size: var(--text-lg);
  }

  .note {
    margin-top: var(--space-1);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  div :global(a) {
    color: var(--accent);
    font-weight: 600;
  }
</style>
