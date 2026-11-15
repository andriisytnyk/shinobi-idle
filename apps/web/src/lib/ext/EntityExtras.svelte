<script lang="ts">
  import { useUi } from './runtime.svelte.ts';
  import Slot from './Slot.svelte';
  import WidgetHost from './WidgetHost.svelte';

  interface Props {
    entity: { kind: string; id: string };
  }

  let { entity }: Props = $props();

  const ui = useUi();
  const links = $derived(ui.registry.entityLinks(entity.kind));
</script>

{#if links.length > 0}
  <ul class="ui-links" data-ui-links>
    {#each links as link (link.key)}
      <li>
        {#if link.href}
          {@const target = ui.guard.call(
            link.key,
            'its href builder',
            () => link.href?.(entity, ui.createApi(link.packId)) ?? null,
            null,
          )}
          {#if target !== null}<a href={target}>{ui.t(link.title)}</a>{/if}
        {:else if link.mount}
          <WidgetHost
            entry={{ key: link.key, packId: link.packId, widget: link.mount }}
            ctx={{ ref: entity }}
          />
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<Slot name="entity.sections" ctx={{ ref: entity }} />

<style>
  .ui-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-4) 0 0;
    padding: 0;
    list-style: none;
  }
</style>
