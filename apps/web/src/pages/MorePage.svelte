<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { tryUi } from '../lib/ext/runtime.svelte.ts';
  import { tabItems } from '../lib/nav.ts';
  import { t } from '../lib/i18n.ts';
  import SimplePage from './SimplePage.svelte';

  /** Pages that packs added to the menu; the built-in ones are listed below by hand. */
  const ui = tryUi();
  const extra = $derived.by(() => {
    if (!ui) return [];
    const inBar = new Set(tabItems(ui.registry, (item) => !ui.navHidden(item.key)));
    return ui.registry.navItems.filter(
      (n) => n.packId !== 'core' && !inBar.has(n) && !ui.navHidden(n.key),
    );
  });
</script>

<SimplePage title={t('nav.more')}>
  <ul class="menu">
    <li class="phone-only">
      <a href="#/bank" data-more-bank>
        <Icon name="lucide:package" size={18} />
        <span>{t('nav.bank')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    <li class="phone-only">
      <a href="#/shop" data-more-shop>
        <Icon name="lucide:store" size={18} />
        <span>{t('nav.shop')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    <li class="phone-only">
      <a href="#/village" data-more-village>
        <Icon name="lucide:landmark" size={18} />
        <span>{t('nav.village')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    <li>
      <a href="#/rank">
        <Icon name="rank-3" size={18} />
        <span>{t('more.rank')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    <li>
      <a href="#/help">
        <Icon name="lucide:circle-help" size={18} />
        <span>{t('more.help')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    <li>
      <a href="#/settings">
        <Icon name="lucide:settings" size={18} />
        <span>{t('settings.title')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    <li>
      <a href="#/credits">
        <Icon name="lucide:info" size={18} />
        <span>{t('more.credits')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    {#each extra as item (item.key)}
      <li>
        <a href={item.route} data-more-item={item.id}>
          <Icon name={item.icon} size={18} />
          <span>{ui?.t(item.title)}</span>
          <Icon name="lucide:chevron-right" size={16} />
        </a>
      </li>
    {/each}
  </ul>
</SimplePage>

<style>
  .menu {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* On a wide screen the side menu has these; on a phone only this page does. */
  @media (min-width: 769px) {
    .phone-only {
      display: none;
    }
  }

  a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    color: var(--fg);
    text-decoration: none;
  }

  a span {
    flex: 1;
  }
</style>
