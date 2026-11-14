<script lang="ts">
  import MetaPanel from './components/MetaPanel.svelte';
  import NowBar from './components/NowBar.svelte';
  import SkillList from './components/SkillList.svelte';
  import TabBar from './components/TabBar.svelte';
  import TopBar from './components/TopBar.svelte';
  import { t } from './lib/i18n.ts';
  import { currentRoute } from './lib/router.svelte.ts';
  import EntityPage from './pages/EntityPage.svelte';
  import SimplePage from './pages/SimplePage.svelte';
  import SkillPage from './pages/SkillPage.svelte';

  // The meta panel starts open beside the page on wide screens and closed on phones, where it is an overlay.
  let metaOpen = $state(window.matchMedia('(min-width: 769px)').matches);
  const route = $derived(currentRoute());
</script>

<div class="app" class:meta-open={metaOpen}>
  <div class="top">
    <TopBar {metaOpen} onToggleMeta={() => (metaOpen = !metaOpen)} />
  </div>

  <nav class="side" aria-label={t('nav.skills')}>
    <SkillList />
  </nav>

  <main class="main">
    {#if route.page === 'home'}
      <SimplePage title={t('home.title')}>
        <p class="hint">{t('home.hint')}</p>
      </SimplePage>
    {:else if route.page === 'skills'}
      <SimplePage title={t('nav.skills')}>
        <div class="mobile-skills"><SkillList /></div>
        <p class="hint desktop-only">{t('home.hint')}</p>
      </SimplePage>
    {:else if route.page === 'tab'}
      <SimplePage title={t(`nav.${route.tab}`)}>
        <p class="hint">{t('entity.placeholder')}</p>
      </SimplePage>
    {:else if route.page === 'entity' && route.ref.kind === 'skill'}
      <SkillPage id={route.ref.id} />
    {:else if route.page === 'entity'}
      <EntityPage entity={route.ref} />
    {:else}
      <SimplePage title={t('route.notFound')} />
    {/if}
  </main>

  {#if metaOpen}
    <div class="meta"><MetaPanel onClose={() => (metaOpen = false)} /></div>
  {/if}

  <div class="now"><NowBar /></div>
  <div class="tabs"><TabBar /></div>
</div>

<style>
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
