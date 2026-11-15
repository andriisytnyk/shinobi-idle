<script lang="ts">
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  /** Active tonics with the charges they have left. */
  const buffs = $derived(
    game.read((gs) =>
      Object.entries(gs.buffs).map(([id, buff]) => ({ id, charges: buff.charges })),
    ),
  );
</script>

{#if buffs.length > 0}
  <ul class="buffs" aria-label={t('buff.title')} data-buffs>
    {#each buffs as buff (buff.id)}
      <li class="buff" data-buff={buff.id}>
        <Icon entity={{ kind: 'item', id: buff.id }} size={16} />
        <EntityLink kind="item" id={buff.id} />
        <span class="charges" aria-label={t('buff.charges', { n: buff.charges })}
          >&times;{formatInt(buff.charges)}</span
        >
      </li>
    {/each}
  </ul>
{/if}

<style>
  .buffs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .buff {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-size: var(--font-size-0-85);
    white-space: nowrap;
  }

  .buff :global(a:hover) {
    text-decoration: underline;
  }

  .charges {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
</style>
