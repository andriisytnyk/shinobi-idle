<script lang="ts">
  import { untrack } from 'svelte';
  import BlockedScreen from './components/BlockedScreen.svelte';
  import LoadErrorScreen from './components/LoadErrorScreen.svelte';
  import DevTools from './components/DevTools.svelte';
  import GoalPanel from './components/GoalPanel.svelte';
  import GraduationModal from './components/GraduationModal.svelte';
  import HintHost from './components/HintHost.svelte';
  import MainNav from './components/MainNav.svelte';
  import NowBar from './components/NowBar.svelte';
  import ReportModal from './components/ReportModal.svelte';
  import SkillList from './components/SkillList.svelte';
  import TabBar from './components/TabBar.svelte';
  import ToastHost from './components/ToastHost.svelte';
  import TopBar from './components/TopBar.svelte';
  import WelcomeModal from './components/WelcomeModal.svelte';
  import { isDevMode } from './lib/dev.ts';
  import { coreUi } from './lib/ext/core-ui.ts';
  import EntityExtras from './lib/ext/EntityExtras.svelte';
  import PageHost from './lib/ext/PageHost.svelte';
  import { createUi, provideUi, type Ui } from './lib/ext/runtime.svelte.ts';
  import Slot from './lib/ext/Slot.svelte';
  import { createStyleInjector, createThemeApplier } from './lib/ext/theme.ts';
  import type { UiPack } from './lib/ext/types.ts';
  import { t } from './lib/i18n.ts';
  import { currentHash, currentRoute, setBeforeRoute } from './lib/router.svelte.ts';
  import { revealLevel } from './lib/reveal.ts';
  import { settings } from './lib/settings.svelte.ts';
  import { game } from './lib/store.ts';

  interface Props {
    /** The UI packs of this boot, the built-in game first. Tests pass more. */
    uiPacks?: readonly UiPack[];
    /** Gives tests the registries of this boot. */
    onUi?: (ui: Ui) => void;
  }

  let { uiPacks = [coreUi], onUi }: Props = $props();

  // The registries belong to this boot of the app; nothing outlives it.
  const ui = createUi(
    untrack(() => uiPacks),
    { game, settings },
  );
  provideUi(ui);
  untrack(() => onUi?.(ui));

  // The chosen theme sits on the root element; switching or closing the app removes it completely.
  const themes = createThemeApplier(document.documentElement);
  $effect(() => themes.apply(ui.activeTheme()));
  $effect(() => () => themes.dispose());
  // Stylesheets that packs ship are in the page for as long as the app is.
  $effect(() => {
    const styles = createStyleInjector(document);
    styles.apply(ui.registry.stylesheets);
    return () => styles.apply([]);
  });

  // The observers watch the app root; the packs themselves were started when the registries were made.
  let appEl = $state<HTMLElement>();
  $effect(() => {
    if (appEl) return ui.hub.attach(appEl);
  });
  $effect(() => () => ui.dispose());

  // The meta panel starts open beside the page on wide screens and closed on phones, where it is an overlay.
  let metaOpen = $state(window.matchMedia('(min-width: 769px)').matches);
  const hash = $derived(currentHash());
  const route = $derived(currentRoute());

  // Hooks for the packs: the route (the hash changed / the page is drawn) and the state (after every update).
  let lastHash = untrack(() => hash);
  $effect(() => {
    const to = hash;
    untrack(() => {
      const from = lastHash;
      lastHash = to;
      if (from !== to) ui.emit('route', { phase: 'after', from, to });
    });
  });
  // «before» is asked by the router itself, synchronously, while the old page is still on screen.
  $effect(() => {
    setBeforeRoute((from, to) => {
      const verdicts = ui.emit('route', { phase: 'before', from, to });
      if (verdicts.includes(false)) return false;
      return verdicts.findLast((v) => typeof v === 'string') as string | undefined;
    });
    return () => setBeforeRoute(null);
  });
  $effect(() => {
    void game.version;
    untrack(() => ui.emit('state'));
  });
  /** Room at the foot of the page for the developer panel, so it never hides the last controls. */
  const dev = isDevMode();
</script>

{#if game.phase === 'blocked'}
  <BlockedScreen />
{:else if game.phase === 'error'}
  <LoadErrorScreen />
{:else if !game.ready}
  <div class="boot" role="status">{t('app.loading')}</div>
{:else}
  <div class="app" class:meta-open={metaOpen} bind:this={appEl}>
    <div class="top">
      <TopBar {metaOpen} onToggleMeta={() => (metaOpen = !metaOpen)} />
    </div>

    <div class="side">
      <MainNav />
      <nav aria-label={t('nav.skills')}><SkillList /></nav>
    </div>

    <main class="main" class:dev>
      <HintHost />
      <PageHost {hash} />
      {#if route.page === 'entity' && revealLevel(route.ref) === 'full'}
        <EntityExtras entity={route.ref} />
      {/if}
      <Slot name="page.footer" ctx={{ route: hash }} />
    </main>

    {#if metaOpen}
      <div class="meta"><GoalPanel onClose={() => (metaOpen = false)} /></div>
    {/if}

    <div class="now"><NowBar /></div>
    <ToastHost />
    <DevTools />
    {#if game.state.player.name === ''}
      <WelcomeModal />
    {:else if game.graduation}
      <GraduationModal onClose={() => game.dismissGraduation()} />
    {/if}
    {#if game.report}
      <ReportModal report={game.report} onClose={() => game.dismissReport()} />
    {/if}
    <div class="tabs"><TabBar /></div>
  </div>
{/if}

<style>
  .boot {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100dvh;
    color: var(--fg-dim);
  }

  .app {
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'top top'
      'side main'
      'now now';
    height: 100dvh;
  }

  .app.meta-open {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--meta-width);
    grid-template-areas:
      'top top top'
      'side main meta'
      'now now now';
  }

  .top {
    grid-area: top;
  }

  .side {
    grid-area: side;
    padding: var(--space-3);
    border-right: var(--border-thin) solid var(--line);
    background: var(--surface);
    overflow-y: auto;
  }

  .main {
    grid-area: main;
    padding: var(--space-6);
    overflow-y: auto;
  }

  .main.dev {
    --_padding-bottom: 5rem;
    padding-bottom: var(--_padding-bottom);
  }

  .meta {
    grid-area: meta;
    display: flex;
    flex-direction: column;
    border-left: var(--border-thin) solid var(--line);
    overflow: hidden;
  }

  .now {
    grid-area: now;
  }

  .tabs {
    grid-area: tabs;
  }

  @media (max-width: 768px) {
    .app,
    .app.meta-open {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto auto;
      grid-template-areas:
        'top'
        'main'
        'now'
        'tabs';
    }

    .side {
      display: none;
    }

    .main {
      padding: var(--space-4);
    }

    /* On a phone the meta panel is an overlay opened from the top bar. */
    .meta {
      position: fixed;
      inset: 0 0 var(--tabbar-height) 0;
      z-index: var(--z-overlay);
      border-left: 0;
      background: var(--surface);
    }
  }
</style>
