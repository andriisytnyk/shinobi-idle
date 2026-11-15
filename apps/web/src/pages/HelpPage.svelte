<script lang="ts">
  import { hintTextKey, hintTitleKey, HINTS } from '../lib/hints.ts';
  import { t } from '../lib/i18n.ts';
  import SimplePage from './SimplePage.svelte';
</script>

<SimplePage title={t('help.title')}>
  <p class="intro">{t('help.intro')}</p>
  <a class="settings-link" href="#/settings">{t('help.settings')}</a>
  <ul class="hints">
    {#each HINTS as hint (hint.id)}
      <li class="entry" data-help={hint.id}>
        <h2>{t(hintTitleKey(hint.id))}</h2>
        <p>{t(hintTextKey(hint.id))}</p>
      </li>
    {/each}
  </ul>
</SimplePage>

<style>
  .intro {
    color: var(--fg-dim);
  }

  .settings-link {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
  }

  .hints {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .entry {
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  h2 {
    margin: 0 0 var(--space-1);
    color: var(--heading);
    font-size: 1rem;
  }

  p {
    margin: 0;
  }
</style>
