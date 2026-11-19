<script lang="ts">
  import { useUi } from '../lib/ext/runtime.svelte.ts';
  import { t } from '../lib/i18n.ts';
  import { activeNav, markerOf, sideItems } from '../lib/nav.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { currentHash } from '../lib/router.svelte.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';

  const content = game.content;

  const ui = useUi();
  const items = $derived(sideItems(ui.registry).filter((item) => !ui.navHidden(item.key)));

  const active = $derived(activeNav(currentHash(), ui.registry));
  const marker = $derived(
    game.read((gs) => markerOf(nextStep(gs, content)?.target ?? null, ui.registry).nav),
  );
</script>

<nav class="main-nav" aria-label={t('nav.pages')}>
  <ul>
    {#each items as item (item.id)}
      <li>
        <a
          href={item.route}
          class:active={active === item.id}
          aria-current={active === item.id ? 'page' : undefined}
          data-nav={item.id}
          data-ui="nav-item"
        >
          <Icon name={item.icon} size={18} />
          <span class="label">{ui.t(item.title)}</span>
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
    border-bottom: var(--border-thin) solid var(--line);
    list-style: none;
  }

  a {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-sm);
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
    box-shadow: inset var(--border-heavy) 0 0 var(--accent);
  }

  .label {
    flex: 1;
  }

  .marker {
    width: var(--icon-xs);
    height: var(--icon-xs);
    border-radius: 50%;
    background: var(--accent);
  }
</style>
