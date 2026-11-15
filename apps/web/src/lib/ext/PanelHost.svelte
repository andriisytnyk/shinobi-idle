<script lang="ts" generics="C extends Record<string, unknown>">
  import { tryUi } from './runtime.svelte.ts';
  import type { PanelMount } from './types.ts';
  import WidgetHost from './WidgetHost.svelte';

  interface Props {
    /** `<packId>:<id>` of the registration, for the warning. */
    owner: string;
    packId: string;
    mount: PanelMount<C>;
    ctx: C;
  }

  let { owner, packId, mount, ctx }: Props = $props();

  const ui = tryUi();
</script>

<!-- A panel of a pack that fails while it draws is left out with one warning; the page goes on. -->
<svelte:boundary onerror={(error) => ui?.guard.warn(owner, 'its render', error)}>
  {#if typeof mount === 'function'}
    <WidgetHost entry={{ key: owner, packId, widget: mount }} {ctx} />
  {:else}
    {@const Panel = mount.svelte}
    <Panel {...ctx} {...mount.props?.(ctx) ?? {}} />
  {/if}
  {#snippet failed()}{/snippet}
</svelte:boundary>
