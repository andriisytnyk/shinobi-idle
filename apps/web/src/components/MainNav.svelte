<script lang="ts">
  import { content } from '@shinobi/content';
  import { t } from '../lib/i18n.ts';
  import { activeNav, markerOf, NAV } from '../lib/nav.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { currentRoute } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';

  const items = NAV.filter((item) => item.side);

  const route = $derived(currentRoute());
  const active = $derived(activeNav(route));
  const marker = $derived(markerOf(nextStep(game.state, content)?.target ?? null).nav);
</script>

<nav class="main-nav" aria-label={t('nav.pages')}>
  <ul>
    {#each items as item (item.id)}
      <li>
        <a
          href={item.href}
          class:active={active === item.id}
          aria-current={active === item.id ? 'page' : undefined}
          data-nav={item.id}
        >
          <Icon name={item.icon} size={18} />
          <span class="label">{t(item.label)}</span>
          {#if marker === item.id}
            <span class="marker" data-marker role="img" aria-label={t('nav.next')}></span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  ul {
    margin: 0 0 var(--space-3);
    padding: 0 0 var(--space-3);
    border-bottom: 1px solid var(--line);
    list-style: none;
  }

  a {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.25rem;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--fg);
    text-decoration: none;
  }

  a:hover {
    background: var(--surface-raised);
  }

  a.active {
    background: var(--surface-raised);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .label {
    flex: 1;
  }

  .marker {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--accent);
  }
</style>
