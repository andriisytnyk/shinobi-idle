<script lang="ts">
  import { actionInfo } from '@shinobi/core';
  import ActionTile from '../components/ActionTile.svelte';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import EntityPage from './EntityPage.svelte';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const content = game.content;
  /** The work as the Scouting page lists it: the same tile, with the same lock and the same start button. */
  const info = $derived(
    game.read((gs) => actionInfo(gs, { kind: 'fieldwork', id }, content, game.rules)),
  );
</script>

<EntityPage entity={{ kind: 'fieldwork', id }} />
{#if info}
  <section class="work" data-fieldwork-start data-ui="entity-section">
    <h2>{t('scout.works')}</h2>
    <ul class="tiles">
      <ActionTile {info} />
    </ul>
  </section>
{/if}

<style>
  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-min), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
  }
</style>
