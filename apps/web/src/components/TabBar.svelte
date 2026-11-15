<script lang="ts">
  import { content } from '@shinobi/content';
  import { t } from '../lib/i18n.ts';
  import { activeNav, markerOf, MORE_PAGES, NAV, TAB_ORDER } from '../lib/nav.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { currentRoute } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';

  const tabs = NAV.filter((item) => item.tab).sort(
    (a, b) => TAB_ORDER.indexOf(a.id) - TAB_ORDER.indexOf(b.id),
  );

  const route = $derived(currentRoute());
  // Pages reached from the "More" tab keep it lit.
  const activeTab = $derived.by(() => {
    const id = activeNav(route);
    return id !== null && MORE_PAGES.includes(id) ? 'more' : id;
  });
  const marker = $derived(
    game.read((gs) => {
      const nav = markerOf(nextStep(gs, content)?.target ?? null).nav;
      return nav !== null && MORE_PAGES.includes(nav) ? 'more' : nav;
    }),
  );
</script>

<nav class="tabbar" aria-label={t('nav.main')}>
  {#each tabs as tab (tab.id)}
    <a
      href={tab.href}
      class:active={activeTab === tab.id}
      aria-current={activeTab === tab.id ? 'page' : undefined}
      data-tab={tab.id}
    >
      <span class="icon">
        <Icon name={tab.icon} size={22} />
        {#if marker === tab.id}
          <span class="marker" data-marker role="img" aria-label={t('nav.next')}></span>
        {/if}
      </span>
      <span class="label">{t(tab.label)}</span>
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    display: none;
  }

  .icon {
    position: relative;
    display: inline-flex;
  }

  .marker {
    position: absolute;
    top: -2px;
    right: -6px;
    width: 0.6rem;
    height: 0.6rem;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--accent);
  }

  @media (max-width: 768px) {
    .tabbar {
      display: flex;
      height: var(--tabbar-height);
      border-top: 1px solid var(--line);
      background: var(--surface);
    }

    a {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-width: 0;
      border-top: 3px solid transparent;
      color: var(--fg-dim);
      font-size: 0.65rem;
      text-decoration: none;
    }

    .label {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    a.active {
      border-top-color: var(--accent);
      color: var(--fg);
    }
  }
</style>
