<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/i18n.ts';
  import SimplePage from './SimplePage.svelte';
</script>

<SimplePage title={t('nav.more')}>
  <ul class="menu">
    <li>
      <a href="#/bank" data-more-bank>
        <Icon name="lucide:package" size={18} />
        <span>{t('nav.bank')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    <li>
      <a href="#/shop" data-more-shop>
        <Icon name="lucide:store" size={18} />
        <span>{t('nav.shop')}</span>
        <Icon name="lucide:chevron-right" size={16} />
      </a>
    </li>
    <li>
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
  </ul>
</SimplePage>

<style>
  .menu {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li + li {
    margin-top: var(--space-2);
  }

  a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-raised);
    color: var(--fg);
    text-decoration: none;
  }

  a span {
    flex: 1;
  }
</style>
