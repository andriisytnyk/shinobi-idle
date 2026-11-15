<script lang="ts" generics="N extends SlotName">
  import { tryUi } from './runtime.svelte.ts';
  import type { SlotContexts, SlotName } from './slots.ts';
  import WidgetHost from './WidgetHost.svelte';

  interface Props {
    name: N;
    ctx?: SlotContexts[N];
  }

  let { name, ctx = {} as SlotContexts[N] }: Props = $props();

  // Outside the app (a page mounted on its own) there is no registry and so nothing to show.
  const ui = tryUi();
  const entries = $derived(ui ? ui.registry.widgets(name) : []);
</script>

{#each entries as entry (entry.key)}
  <WidgetHost {entry} {ctx} />
{/each}
