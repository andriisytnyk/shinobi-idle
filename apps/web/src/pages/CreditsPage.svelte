<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import {
    APP_ICON_CREDIT,
    GAME_ICONS_AUTHORS,
    GAME_ICONS_LICENSE_URL,
    GAME_ICONS_URL,
    LUCIDE_URL,
  } from '../lib/credits.ts';
  import { t } from '../lib/i18n.ts';
  import SimplePage from './SimplePage.svelte';
</script>

<SimplePage title={t('credits.title')}>
  <section>
    <h2>{t('credits.icons.heading')}</h2>
    <p>{t('credits.icons.body')}</p>
    <p class="links">
      <a href={GAME_ICONS_URL} target="_blank" rel="noopener noreferrer">
        {t('credits.icons.site')}
        <Icon name="lucide:external-link" size={14} />
      </a>
      <a href={GAME_ICONS_LICENSE_URL} target="_blank" rel="noopener noreferrer">
        {t('credits.icons.license')}
        <Icon name="lucide:external-link" size={14} />
      </a>
    </p>
  </section>

  <section data-app-icon-credit>
    <h2>{t('credits.appIcon.heading')}</h2>
    <p>
      {t('credits.appIcon.body', { icon: APP_ICON_CREDIT.icon, author: APP_ICON_CREDIT.author })}
    </p>
    <p class="links">
      <a href={APP_ICON_CREDIT.url} target="_blank" rel="noopener noreferrer">
        {t('credits.appIcon.link')}
        <Icon name="lucide:external-link" size={14} />
      </a>
    </p>
  </section>

  <section>
    <h2>{t('credits.authors.heading')}</h2>
    <p>{t('credits.authors.body')}</p>
    <ul class="authors">
      {#each GAME_ICONS_AUTHORS as author (author)}
        <li>{author}</li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>{t('credits.lucide.heading')}</h2>
    <p>{t('credits.lucide.body')}</p>
    <p class="links">
      <a href={LUCIDE_URL} target="_blank" rel="noopener noreferrer">
        {t('credits.lucide.site')}
        <Icon name="lucide:external-link" size={14} />
      </a>
    </p>
  </section>
</SimplePage>

<style>
  section {
    margin-bottom: var(--space-6);
  }

  h2 {
    margin: 0 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  p {
    margin: 0 0 var(--space-2);
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--accent);
  }

  .authors {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .authors li {
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }
</style>
