<script lang="ts">
  import { locationHint, type HintTarget } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { lookHref } from '../lib/world.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** What the requirement or the step asks to find. */
    target: HintTarget;
  }

  let { target }: Props = $props();

  /** The region and the search area of the target; null for a target that has no place on the map. */
  const hint = $derived(game.read((gs) => locationHint(gs, game.content, target)));
</script>

{#if hint}
  <p class="look" data-where-look={target.kind} data-exact={hint.exact}>
    <span class="dim">{t(hint.exact ? 'look.found' : 'look.search')}</span>
    {#if hint.exact && hint.cells[0]}
      <EntityLink kind="cell" id={hint.cells[0]} />
      <span class="dim">(</span>
    {/if}
    <!-- The region is named even while its page is hidden: the name is the hint itself. -->
    <strong class="region" data-look-region
      >{hint.regions.map((r) => t(`region.${r}.name`)).join(', ')}</strong
    >
    {#if hint.exact && hint.cells[0]}<span class="dim">)</span>{/if}
    <a class="show" href={lookHref(target)} data-look-link>{t('look.show')}</a>
  </p>
{/if}

<style>
  .look {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-1);
    margin: 0;
    font-size: var(--text-xs);
  }

  .dim {
    color: var(--fg-dim);
  }

  .look :global(a.entity-link),
  .region {
    color: var(--fg);
    font-weight: 600;
  }

  .show {
    margin-inline-start: var(--space-2);
    color: var(--accent);
  }

  @media (max-width: 768px) {
    .show {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-md);
    }
  }
</style>
