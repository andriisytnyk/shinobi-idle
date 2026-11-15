<script lang="ts">
  import { itemRelations } from '../lib/item-links.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** The item the pinned goal asks for. */
    item: string;
  }

  let { item }: Props = $props();

  /** The missions that pay this item: where to get it when it is a goal. */
  const missions = $derived(
    itemRelations(item, game.content).sources.flatMap((s) =>
      s.ref?.kind === 'mission' ? [s.ref.id] : [],
    ),
  );
</script>

{#if missions.length > 0}
  <p class="from" data-goal-missions>
    {t('mission.goalFrom')}
    {#each missions as id, i (id)}{#if i > 0},
      {/if}<EntityLink kind="mission" {id} />{/each}
  </p>
{/if}

<style>
  .from {
    margin: var(--space-2) 0 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }
</style>
