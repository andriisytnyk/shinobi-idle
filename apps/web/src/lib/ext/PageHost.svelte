<script lang="ts">
  import RevealGate from '../../components/RevealGate.svelte';
  import SimplePage from '../../pages/SimplePage.svelte';
  import { t } from '../i18n.ts';
  import { findEntity } from '../entity-data.ts';
  import { revealLevel } from '../reveal.ts';
  import { game } from '../store.ts';
  import { parseHash } from '../route.ts';
  import type { EntityRef } from '../route.ts';
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
  /** The page of an entity the player has not discovered is not drawn: the reveal rule decides before any page (or pack wrapper) sees it. */
  const route = $derived(parseHash(hash));
  const gate = $derived.by((): { entity: EntityRef; level: 'hidden' | 'name' } | null => {
    if (route.page !== 'entity') return null;
    // An id the content does not have reads like one that is not discovered: typing addresses tells nothing.
    const level = findEntity(game.content, route.ref) === null ? 'hidden' : revealLevel(route.ref);
    if (level === 'hidden' || (level === 'name' && match?.page.reveal !== 'self')) {
      return { entity: route.ref, level };
    }
    return null;
  });
</script>

{#if gate}
  <div class="ui-page" data-ui="page" data-page="reveal-gate">
    <RevealGate entity={gate.entity} level={gate.level} />
  </div>
{:else if match && ctx && mount}
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
