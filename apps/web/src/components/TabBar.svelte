<script lang="ts">
  import { content } from '@shinobi/content';
  import { useUi } from '../lib/ext/runtime.svelte.ts';
  import { t } from '../lib/i18n.ts';
  import { activeNav, markerOf, morePages, tabItems } from '../lib/nav.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { currentHash } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';

  const ui = useUi();
  const tabs = $derived(tabItems(ui.registry).filter((item) => !ui.navHidden(item.key)));
  const more = $derived(morePages(ui.registry));
  // Pages reached from the "More" tab keep it lit.
  const activeTab = $derived.by(() => {
    const id = activeNav(currentHash(), ui.registry);
    return id !== null && more.includes(id) ? 'more' : id;
  });
  const marker = $derived(
    game.read((gs) => {
      const nav = markerOf(nextStep(gs, content)?.target ?? null, ui.registry).nav;
      return nav !== null && more.includes(nav) ? 'more' : nav;
    }),
  );
</script>

<nav class="tabbar" aria-label={t('nav.main')}>
  {#each tabs as tab (tab.id)}
    <a
      href={tab.route}
      class:active={activeTab === tab.id}
      aria-current={activeTab === tab.id ? 'page' : undefined}
      data-tab={tab.id}
      data-ui="nav-item"
    >
      <span class="icon">
        <Icon name={tab.icon} size={22} />
        {#if marker === tab.id}
          <span class="marker" data-marker role="img" aria-label={t('nav.next')}></span>
        {/if}
      </span>
      <span class="label">{ui.t(tab.title)}</span>
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
    top: calc(-1 * var(--offset-2));
    right: calc(-1 * var(--offset-6));
    width: var(--size-0-6);
    height: var(--size-0-6);
    border: var(--border-2) solid var(--surface);
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
      gap: var(--offset-2);
      min-width: 0;
      border-top: var(--border-3) solid transparent;
      color: var(--fg-dim);
      font-size: var(--font-size-0-65);
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
