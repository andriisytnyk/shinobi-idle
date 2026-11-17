<script lang="ts">
  import { killsKey, missionDoneKey } from '@shinobi/core';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { perksOf } from '../lib/rank-ladder.ts';
  import { rankName } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Modal from './Modal.svelte';

  const content = game.content;

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const rank = $derived(game.read((gs) => gs.player.rank));
  const perks = $derived(perksOf(content, rank));
  /** What the player did on the way, counted from the state. */
  const done = $derived(
    game.read((gs) => ({
      chains: content.quests.filter((q) => gs.quests[q.id]?.done),
      bosses: content.bosses.filter((b) => (gs.counters[killsKey(b.id)] ?? 0) > 0),
      missions: Object.entries(gs.counters)
        .filter(([key]) => key.startsWith(missionDoneKey('')))
        .reduce((sum, [, n]) => sum + n, 0),
      time: gs.now,
    })),
  );
  const name = $derived(game.read((gs) => gs.player.name));

  function toJournal(): void {
    onClose();
    navigate('#/quests');
  }
</script>

<Modal title={t('finale.title')} {onClose}>
  <!-- A link inside the dialog leaves the page, so the dialog closes with it. -->
  <div
    data-finale
    role="presentation"
    onclick={(e) => {
      if (e.target instanceof Element && e.target.closest('a')) onClose();
    }}
  >
    <p class="lead">{t('finale.lead', { name, rank: rankName(rank) })}</p>
    <p>{t('finale.body')}</p>

    <h3>{t('finale.done')}</h3>
    <ul data-finale-done>
      <li>{t('finale.chains', { n: done.chains.length })}</li>
      <li>{t('finale.bosses', { n: done.bosses.length })}</li>
      <li>{t('finale.missions', { n: formatInt(done.missions) })}</li>
      <li>{t('finale.time', { time: formatDuration(done.time) })}</li>
    </ul>
    {#if done.bosses.length > 0}
      <ul class="links" data-finale-bosses>
        {#each done.bosses as boss (boss.id)}
          <li><EntityLink kind="boss" id={boss.id} /></li>
        {/each}
      </ul>
    {/if}

    {#if perks.length > 0}
      <h3>{t('finale.perks')}</h3>
      <ul data-finale-perks>
        {#each perks as perk (perk.kind)}
          <li>{t(`rank.perk.${perk.kind}`, { n: perk.n })}</li>
        {/each}
      </ul>
    {/if}

    <h3>{t('finale.next')}</h3>
    <p>{t('finale.nextBody')}</p>
    <ul data-finale-next>
      <li>{t('finale.next.b')}</li>
      <li>{t('finale.next.border')}</li>
      <li>{t('finale.next.levels')}</li>
      <li>{t('finale.next.hunt')}</li>
    </ul>
    <p class="note">{t('finale.keepPlaying')}</p>
  </div>
  {#snippet actions()}
    <button type="button" onclick={toJournal}>{t('finale.journal')}</button>
    <button type="button" class="primary" onclick={onClose}>{t('finale.close')}</button>
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
    margin: 0 0 var(--space-2);
  }

  .lead {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin-top: var(--space-1);
    padding: 0;
    list-style: none;
  }

  .note {
    margin-top: var(--space-2);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  div :global(a) {
    color: var(--accent);
    font-weight: 600;
  }
</style>
