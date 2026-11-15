<script lang="ts">
  import { useUi } from '../lib/ext/runtime.svelte.ts';
  import { t } from '../lib/i18n.ts';
  import { activeNav, markerOf, morePages, tabItems, tabOf } from '../lib/nav.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { currentHash } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';

  const content = game.content;

  const ui = useUi();
  const tabs = $derived(tabItems(ui.registry, (item) => !ui.navHidden(item.key)));
  /** Items without a tab of their own, those that did not fit in the bar among them: they keep «Ще» lit. */
  const more = $derived([
    ...morePages(ui.registry),
    ...ui.registry.navItems.filter((item) => !tabs.includes(item)).map((item) => item.id),
  ]);
  // Pages reached from the "More" tab keep it lit.
  const activeTab = $derived.by(() => {
    const id = tabOf(ui.registry, activeNav(currentHash(), ui.registry));
    return id !== null && more.includes(id) ? 'more' : id;
  });
  const marker = $derived(
    game.read((gs) => {
      const nav = tabOf(
        ui.registry,
        markerOf(nextStep(gs, content)?.target ?? null, ui.registry).nav,
      );
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
    --_top: 2px;
    --_right: 6px;
    position: absolute;
    top: calc(-1 * var(--_top));
    right: calc(-1 * var(--_right));
    width: var(--icon-xs);
    height: var(--icon-xs);
    border: var(--border-thick) solid var(--surface);
    border-radius: 50%;
    background: var(--accent);
  }

  @media (max-width: 768px) {
    .tabbar {
      display: flex;
      height: var(--tabbar-height);
      border-top: var(--border-thin) solid var(--line);
      background: var(--surface);
    }

    a {
      --_gap: 2px;
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--_gap);
      min-width: 0;
      border-top: var(--border-heavy) solid transparent;
      color: var(--fg-dim);
      font-size: var(--text-2xs);
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
