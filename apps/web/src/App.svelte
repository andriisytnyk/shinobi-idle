<script lang="ts">
  import { untrack } from 'svelte';
  import BlockedScreen from './components/BlockedScreen.svelte';
  import CrashScreen from './components/CrashScreen.svelte';
  import ErrorBoundary from './components/ErrorBoundary.svelte';
  import LoadErrorScreen from './components/LoadErrorScreen.svelte';
  import CloneCreate from './components/CloneCreate.svelte';
  import DispelDialog from './components/DispelDialog.svelte';
  import { sidePanel } from './lib/side-panel.svelte.ts';
  import GoalPanel from './components/GoalPanel.svelte';
  import FinaleModal from './components/FinaleModal.svelte';
  import GraduationModal from './components/GraduationModal.svelte';
  import HintHost from './components/HintHost.svelte';
  import MainNav from './components/MainNav.svelte';
  import NowBar from './components/NowBar.svelte';
  import PointModal from './components/PointModal.svelte';
  import ReportModal from './components/ReportModal.svelte';
  import SquadPanel from './components/SquadPanel.svelte';
  import SquadWatch from './components/SquadWatch.svelte';
  import SkillList from './components/SkillList.svelte';
  import TabBar from './components/TabBar.svelte';
  import ToastHost from './components/ToastHost.svelte';
  import TopBar from './components/TopBar.svelte';
  import WelcomeModal from './components/WelcomeModal.svelte';
  import { isDevMode } from './lib/dev.ts';
  import { coreUi } from './lib/ext/core-ui.ts';
  import PageHost from './lib/ext/PageHost.svelte';
  import { createUi, provideUi, type Ui } from './lib/ext/runtime.svelte.ts';
  import Slot from './lib/ext/Slot.svelte';
  import { createStyleInjector, createThemeApplier } from './lib/ext/theme.ts';
  import type { UiPack } from './lib/ext/types.ts';
  import { t } from './lib/i18n.ts';
  import { currentHash, setBeforeRoute } from './lib/router.svelte.ts';
  import { settings } from './lib/settings.svelte.ts';
  import { hasSquad } from './lib/squad.ts';
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

  // The top bar and the «Зараз» bar change height (a clone, a mission, a long title): what floats against them
  // (the toasts, the developer panel) follows their real height, as `--top-live` and `--now-live`.
  let topEl = $state<HTMLElement>();
  let nowEl = $state<HTMLElement>();
  function trackHeight(el: HTMLElement | undefined, name: string): (() => void) | undefined {
    if (!el || typeof ResizeObserver === 'undefined') return;
    // The variables live on the app element (the root element keeps only the theme's).
    const root = el.closest<HTMLElement>('.app') ?? el;
    const measure = () => root.style.setProperty(name, `${el.offsetHeight}px`);
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => {
      watcher.disconnect();
      root.style.removeProperty(name);
    };
  }
  $effect(() => trackHeight(topEl, '--top-live'));
  $effect(() => trackHeight(nowEl, '--now-live'));

  // The meta panel starts open beside the page on wide screens and closed on phones, where it is an overlay.
  let metaOpen = $state(window.matchMedia('(min-width: 769px)').matches);
  // One side panel at a time: the developer panel (test builds) replaces «Мета» while it is open.
  const metaShown = $derived(metaOpen && !sidePanel.dev);
  function toggleMeta(): void {
    if (sidePanel.dev) {
      sidePanel.dev = false;
      metaOpen = true;
    } else {
      metaOpen = !metaOpen;
    }
  }
  // The squad is a side column on a wide screen and a strip of chips above the tab bar on a phone.
  let narrow = $state(window.matchMedia('(max-width: 768px)').matches);
  $effect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const update = () => (narrow = query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
  /** The squad shows once the player knows the clone technique. */
  const squadOn = $derived(game.ready && game.read((gs) => hasSquad(gs, game.content)));
  const hash = $derived(currentHash());

  // Hooks for the packs: the route (the hash changed / the page is drawn) and the state (after every update).
  let lastHash = untrack(() => hash);
  $effect(() => {
    const to = hash;
    untrack(() => {
      const from = lastHash;
      lastHash = to;
      if (from === to) return;
      // On a phone the goal panel is an overlay: a link inside it leads to a page or a sheet under it, so it steps aside.
      if (window.matchMedia('(max-width: 768px)').matches) metaOpen = false;
      ui.emit('route', { phase: 'after', from, to });
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
  /** The developer panel loads on its own, and only where the build has it: the production bundle holds no trace of it. */
  const loadDevPanel = __DEV_PANEL__ ? () => import('./dev/DevPanel.svelte') : null;
</script>

{#if game.phase === 'blocked'}
  <BlockedScreen />
{:else if game.phase === 'error'}
  <LoadErrorScreen />
{:else if game.phase === 'crashed'}
  <CrashScreen />
{:else if !game.ready}
  <div class="boot" role="status">{t('app.loading')}</div>
{:else}
  <div
    class="app"
    class:meta-open={metaShown}
    class:squad-on={squadOn && !narrow}
    bind:this={appEl}
  >
    <div class="top" bind:this={topEl}>
      <ErrorBoundary area="top"
        ><TopBar metaOpen={metaShown} onToggleMeta={toggleMeta} /></ErrorBoundary
      >
    </div>

    <div class="side">
      <ErrorBoundary area="side">
        <MainNav />
        <nav aria-label={t('nav.skills')}><SkillList /></nav>
      </ErrorBoundary>
    </div>

    <main class="main" class:dev>
      <ErrorBoundary area="page" resetKey={hash}>
        <HintHost />
        <PageHost {hash} />
        <Slot name="page.footer" ctx={{ route: hash }} />
      </ErrorBoundary>
    </main>

    {#if squadOn && !narrow}
      <div class="squad"><ErrorBoundary area="squad"><SquadPanel /></ErrorBoundary></div>
    {/if}

    {#if metaShown}
      <div class="meta">
        <ErrorBoundary area="goal"><GoalPanel onClose={() => (metaOpen = false)} /></ErrorBoundary>
      </div>
    {/if}

    <div class="now" bind:this={nowEl}>
      <ErrorBoundary area="now"
        ><NowBar squad={squadOn && !narrow} sheet={squadOn && narrow} /></ErrorBoundary
      >
    </div>
    {#if squadOn && narrow}
      <div class="chips"><ErrorBoundary area="squad"><SquadPanel compact /></ErrorBoundary></div>
    {/if}
    <SquadWatch />
    <DispelDialog />
    <CloneCreate />
    <ToastHost />
    {#if loadDevPanel && isDevMode()}
      {#await loadDevPanel() then panel}<panel.default />{/await}
    {/if}
    {#if game.state.player.name === ''}
      <WelcomeModal />
    {:else if game.finale}
      <FinaleModal onClose={() => game.dismissFinale()} />
    {:else if game.graduation}
      <GraduationModal onClose={() => game.dismissGraduation()} />
    {/if}
    {#if game.foundPoint}
      {@const found = game.foundPoint}
      <PointModal
        place={found.place}
        reward={found.reward}
        title={t('map.point.discovered')}
        discovered
        onClose={() => game.dismissFoundPoint()}
      />
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

  /* The developer panel (test builds) stands at the right edge with the width of the goal panel; the frame leaves room. */
  @media (min-width: 769px) {
    .app:global(.dev-open) {
      padding-inline-end: var(--meta-width);
    }
  }

  .app.meta-open {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--meta-width);
    grid-template-areas:
      'top top top'
      'side main meta'
      'now now now';
  }

  .app.squad-on {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--squad-width);
    grid-template-areas:
      'top top top'
      'side main squad'
      'now now now';
  }

  .app.squad-on.meta-open {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--squad-width) var(--meta-width);
    grid-template-areas:
      'top top top top'
      'side main squad meta'
      'now now now now';
  }

  .squad {
    grid-area: squad;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
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

  /* An open sheet docks to the right edge: the page makes room, so the tile it is about stays in view. */
  @media (min-width: 1200px) {
    .main:has(:global([data-ui='sheet'])) {
      padding-inline-end: calc(var(--space-6) + var(--modal-width));
    }

    .app.meta-open .main:has(:global([data-ui='sheet'])) {
      padding-inline-end: calc(var(--space-6) + var(--modal-width) - var(--meta-width));
    }
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

  .chips {
    grid-area: chips;
  }

  @media (max-width: 768px) {
    .app,
    .app.meta-open {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto auto auto;
      grid-template-areas:
        'top'
        'main'
        'now'
        'chips'
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
