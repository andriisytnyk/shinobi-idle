<script lang="ts">
  import SimplePage from '../../pages/SimplePage.svelte';
  import { t } from '../i18n.ts';
  import { drawPage, isComposed } from './page-compose.ts';
  import { useUi } from './runtime.svelte.ts';
  import type { PageContext } from './types.ts';
  import WidgetHost from './WidgetHost.svelte';

  interface Props {
    hash: string;
  }

  let { hash }: Props = $props();

  const ui = useUi();
  const match = $derived(ui.registry.matchPage(hash));
  const ctx = $derived<PageContext | null>(match ? { hash, params: match.params } : null);
  const mount = $derived(match?.page.mount);
</script>

{#if match && ctx && mount}
  <div class="ui-page" data-ui="page" data-page={match.page.key}>
    {#if isComposed(match.page)}
      {#key hash}
        <WidgetHost
          entry={{
            key: match.page.key,
            packId: match.page.packId,
            widget: (el, api, c) => drawPage(ui, match.page, el, api, c as PageContext),
          }}
          {ctx}
        />
      {/key}
    {:else if typeof mount !== 'function'}
      {@const Page = mount.svelte}
      <Page {...mount.props?.(ctx) ?? {}} />
    {/if}
  </div>
{:else}
  <SimplePage title={t('route.notFound')} />
{/if}
