<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { currentRoute } from '../lib/router.svelte.ts';
  import Icon from './Icon.svelte';

  const tabs = [
    { id: 'skills', icon: 'fist', label: 'nav.skills', href: '#/skills' },
    { id: 'missions', icon: 'scroll', label: 'nav.missions', href: '#/missions' },
    { id: 'combat', icon: 'swords', label: 'nav.combat', href: '#/combat' },
    { id: 'village', icon: 'home', label: 'nav.village', href: '#/village' },
    { id: 'more', icon: 'dots', label: 'nav.more', href: '#/more' },
  ] as const;

  const route = $derived(currentRoute());
  const activeTab = $derived.by(() => {
    if (route.page === 'skills') return 'skills';
    if (route.page === 'tab') return route.tab;
    if (route.page === 'entity' && route.ref.kind === 'skill') return 'skills';
    return null;
  });
</script>

<nav class="tabbar" aria-label={t('nav.main')}>
  {#each tabs as tab (tab.id)}
    <a
      href={tab.href}
      class:active={activeTab === tab.id}
      aria-current={activeTab === tab.id ? 'page' : undefined}
    >
      <Icon name={tab.icon} size={22} />
      <span>{t(tab.label)}</span>
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    display: none;
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
      border-top: 3px solid transparent;
      color: var(--fg-dim);
      font-size: 0.7rem;
      text-decoration: none;
    }

    a.active {
      border-top-color: var(--accent);
      color: var(--fg);
    }
  }
</style>
