<script lang="ts">
  import BlockedScreen from './components/BlockedScreen.svelte';
  import LoadErrorScreen from './components/LoadErrorScreen.svelte';
  import DevTools from './components/DevTools.svelte';
  import GoalPanel from './components/GoalPanel.svelte';
  import GraduationModal from './components/GraduationModal.svelte';
  import HintHost from './components/HintHost.svelte';
  import MainNav from './components/MainNav.svelte';
  import NextStepCard from './components/NextStepCard.svelte';
  import NowBar from './components/NowBar.svelte';
  import ReportModal from './components/ReportModal.svelte';
  import SkillList from './components/SkillList.svelte';
  import TabBar from './components/TabBar.svelte';
  import ToastHost from './components/ToastHost.svelte';
  import TopBar from './components/TopBar.svelte';
  import WelcomeModal from './components/WelcomeModal.svelte';
  import { isDevMode } from './lib/dev.ts';
  import { game } from './lib/store.ts';
  import { t } from './lib/i18n.ts';
  import { currentRoute } from './lib/router.svelte.ts';
  import BankPage from './pages/BankPage.svelte';
  import CombatPage from './pages/CombatPage.svelte';
  import CreditsPage from './pages/CreditsPage.svelte';
  import EntityPage from './pages/EntityPage.svelte';
  import HelpPage from './pages/HelpPage.svelte';
  import MorePage from './pages/MorePage.svelte';
  import QuestsPage from './pages/QuestsPage.svelte';
  import RankPage from './pages/RankPage.svelte';
  import SimplePage from './pages/SimplePage.svelte';
  import ItemPage from './pages/ItemPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import SkillPage from './pages/SkillPage.svelte';
  import TechniquePage from './pages/TechniquePage.svelte';

  // The meta panel starts open beside the page on wide screens and closed on phones, where it is an overlay.
  let metaOpen = $state(window.matchMedia('(min-width: 769px)').matches);
  const route = $derived(currentRoute());
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
  <div class="app" class:meta-open={metaOpen}>
    <div class="top">
      <TopBar {metaOpen} onToggleMeta={() => (metaOpen = !metaOpen)} />
    </div>

    <div class="side">
      <MainNav />
      <nav aria-label={t('nav.skills')}><SkillList /></nav>
    </div>

    <main class="main" class:dev>
      <HintHost />
      {#if route.page === 'home'}
        <SimplePage title={t('home.title')}>
          <p class="hello">{t('welcome.hello', { name: game.state.player.name })}</p>
          <NextStepCard />
          <p class="hint">{t('home.hint')}</p>
        </SimplePage>
      {:else if route.page === 'skills'}
        <SimplePage title={t('nav.skills')}>
          <div class="mobile-skills"><NextStepCard /><SkillList /></div>
          <p class="hint desktop-only">{t('home.hint')}</p>
        </SimplePage>
      {:else if route.page === 'settings'}
        <SettingsPage />
      {:else if route.page === 'quests'}
        <QuestsPage />
      {:else if route.page === 'rank'}
        <RankPage />
      {:else if route.page === 'combat'}
        <CombatPage />
      {:else if route.page === 'bank'}
        <BankPage />
      {:else if route.page === 'help'}
        <HelpPage />
      {:else if route.page === 'credits'}
        <CreditsPage />
      {:else if route.page === 'tab' && route.tab === 'more'}
        <MorePage />
      {:else if route.page === 'tab'}
        <SimplePage title={t(`nav.${route.tab}`)}>
          <p class="hint">{t('entity.placeholder')}</p>
        </SimplePage>
      {:else if route.page === 'entity' && route.ref.kind === 'quest'}
        <QuestsPage />
      {:else if route.page === 'entity' && route.ref.kind === 'exam'}
        <RankPage />
      {:else if route.page === 'entity' && route.ref.kind === 'skill'}
        <SkillPage id={route.ref.id} />
      {:else if route.page === 'entity' && route.ref.kind === 'technique'}
        <TechniquePage id={route.ref.id} />
      {:else if route.page === 'entity' && route.ref.kind === 'item'}
        <ItemPage id={route.ref.id} />
      {:else if route.page === 'entity'}
        <EntityPage entity={route.ref} />
      {:else}
        <SimplePage title={t('route.notFound')} />
      {/if}
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
    border-right: 1px solid var(--line);
    background: var(--surface);
    overflow-y: auto;
  }

  .main {
    grid-area: main;
    padding: var(--space-6);
    overflow-y: auto;
  }

  .main.dev {
    padding-bottom: 5rem;
  }

  .meta {
    grid-area: meta;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--line);
    overflow: hidden;
  }

  .now {
    grid-area: now;
  }

  .tabs {
    grid-area: tabs;
  }

  .hello {
    margin: 0 0 var(--space-3);
    font-weight: 600;
  }

  .hint {
    color: var(--fg-dim);
  }

  .mobile-skills {
    display: none;
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

    .mobile-skills {
      display: block;
    }

    .desktop-only {
      display: none;
    }

    /* On a phone the meta panel is an overlay opened from the top bar. */
    .meta {
      position: fixed;
      inset: 0 0 var(--tabbar-height) 0;
      z-index: 10;
      border-left: 0;
      background: var(--surface);
    }
  }
</style>
