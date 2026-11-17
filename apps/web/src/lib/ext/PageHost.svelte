<script lang="ts">
  import Breadcrumb from '../../components/Breadcrumb.svelte';
  import EntitySheet from '../../components/EntitySheet.svelte';
  import RevealGate from '../../components/RevealGate.svelte';
  import EntityPage from '../../pages/EntityPage.svelte';
  import SimplePage from '../../pages/SimplePage.svelte';
  import { entityName } from '../entities.ts';
  import { t } from '../i18n.ts';
  import { entityAttr, MASK, revealLevel } from '../reveal.ts';
  import { closeTo } from '../router.svelte.ts';
  import { game } from '../store.ts';
  import { parseHash } from '../route.ts';
  import type { EntityRef } from '../route.ts';
  import EntityExtras from './EntityExtras.svelte';
  import { drawPage, isComposed } from './page-compose.ts';
  import { highlightTile } from './highlight.ts';
  import type { PageEntry } from './registry.ts';
  import { useUi } from './runtime.svelte.ts';
  import { levelOf as levelFor, sheetRoute } from './sheet-route.ts';
  import type { PageContext } from './types.ts';
  import WidgetHost from './WidgetHost.svelte';

  interface Props {
    hash: string;
  }

  let { hash }: Props = $props();

  const ui = useUi();
  const route = $derived(parseHash(hash));

  const levelOf = (ref: EntityRef) => levelFor(game.content, ref);

  /**
   * The details of an entity of a kind that has a sheet open over their parent page: the page of the
   * parent is drawn, with the sheet over it.
   */
  const sheet = $derived(
    sheetRoute(ui.registry, game.content, hash, (spec, fn) =>
      ui.guard.call(spec.key, 'its parent', fn, null),
    ),
  );

  /** The page that is drawn: the parent while a sheet is open. */
  const shown = $derived(sheet ? sheet.parent : hash);
  const match = $derived(ui.registry.matchPage(shown));
  const ctx = $derived<PageContext | null>(match ? { hash: shown, params: match.params } : null);
  const mount = $derived(match?.page.mount);
  /** The page of an entity the player has not discovered is not drawn: the reveal rule decides before any page (or pack wrapper) sees it. */
  const shownRoute = $derived(parseHash(shown));
  const gate = $derived.by((): { entity: EntityRef; level: 'hidden' | 'name' } | null => {
    if (shownRoute.page !== 'entity') return null;
    const level = levelOf(shownRoute.ref);
    if (level === 'hidden' || (level === 'name' && match?.page.reveal !== 'self')) {
      return { entity: shownRoute.ref, level };
    }
    return null;
  });

  /** The path above a page that stays a page: its section (from the nav item it keeps lit), then the entity. */
  const crumbs = $derived.by(() => {
    if (sheet || route.page !== 'entity' || !match?.page.crumbs) return null;
    const ref = route.ref;
    const items: { label: string; href?: string }[] = [];
    const nav = match.page.nav
      ? ui.registry.navItems.find((n) => n.id === match.page.nav)
      : undefined;
    if (nav) items.push({ label: ui.t(nav.title), href: nav.route });
    else
      items.push(
        { label: ui.t('crumbs.home'), href: '#/' },
        { label: ui.t(`entity.kind.${ref.kind}`) },
      );
    items.push({ label: levelOf(ref) === 'hidden' ? MASK : entityName(ref) });
    return items;
  });

  let pageEl = $state<HTMLElement>();
  // The tile that the open sheet is about is marked on the parent page and scrolled into view.
  $effect(() => {
    const open = sheet && sheet.level !== 'hidden' ? entityAttr(sheet.ref) : undefined;
    const el = pageEl;
    if (!open || !el) return;
    return highlightTile(el, open);
  });

  const close = (): void => {
    if (sheet) closeTo(sheet.parent);
  };
</script>

{#snippet sheetBody(open: NonNullable<typeof sheet>)}
  {#if open.level !== 'full'}
    <RevealGate entity={open.ref} level={open.level} />
  {:else}
    {@const m = open.spec.mount}
    {@const sheetCtx = {
      hash,
      params: { kind: open.ref.kind, id: open.ref.id },
    }}
    {#if m === undefined}
      <EntityPage entity={open.ref} />
    {:else if typeof m === 'function'}
      <WidgetHost
        entry={{
          key: open.spec.key,
          packId: open.spec.packId,
          widget: (el, api, c) => m(el, api, c as PageContext),
        }}
        ctx={sheetCtx}
      />
    {:else}
      {@const Body = m.svelte}
      <Body {...m.props?.(sheetCtx) ?? { entity: open.ref }} />
    {/if}
    <EntityExtras entity={open.ref} />
  {/if}
{/snippet}

{#snippet pageBody(entry: PageEntry, pageCtx: PageContext, key: string)}
  {#if isComposed(entry)}
    {#key key}
      <WidgetHost
        entry={{
          key: entry.key,
          packId: entry.packId,
          widget: (el, api, c) => drawPage(ui, entry, el, api, c as PageContext),
        }}
        ctx={pageCtx}
      />
    {/key}
  {:else if typeof entry.mount !== 'function'}
    {@const Page = entry.mount.svelte}
    <Page {...entry.mount.props?.(pageCtx) ?? {}} />
  {/if}
{/snippet}

{#if sheet}
  <EntitySheet
    label={sheet.level === 'hidden' ? t('sheet.label') : entityName(sheet.ref)}
    entity={sheet.level === 'hidden' ? undefined : entityAttr(sheet.ref)}
    onClose={close}
  >
    {@render sheetBody(sheet)}
  </EntitySheet>
{/if}

{#if crumbs}<Breadcrumb items={crumbs} />{/if}

{#if gate}
  <div class="ui-page" data-ui="page" data-page="reveal-gate">
    <RevealGate entity={gate.entity} level={gate.level} />
  </div>
{:else if match && ctx && mount}
  <div class="ui-page" data-ui="page" data-page={match.page.key} bind:this={pageEl}>
    {@render pageBody(match.page, ctx, shown)}
  </div>
{:else}
  <SimplePage title={t('route.notFound')} />
{/if}

{#if !sheet && route.page === 'entity' && revealLevel(route.ref) === 'full'}
  <EntityExtras entity={route.ref} />
{/if}
