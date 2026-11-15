<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { pwa, type Pwa } from '../lib/pwa.svelte.ts';

  /** The PWA state to show; the app's own by default, a prepared one in tests. */
  let { source = pwa }: { source?: Pwa } = $props();
</script>

<section class="pwa" data-pwa-panel>
  <h3>{t('pwa.title')}</h3>

  {#if source.installed}
    <p data-pwa-installed>{t('pwa.installed')}</p>
  {:else if source.canInstall}
    <p>{t('pwa.installHint')}</p>
    <button type="button" data-pwa-install onclick={() => void source.promptInstall()}>
      {t('pwa.install')}
    </button>
  {:else if source.isIos}
    <p data-pwa-ios>{t('pwa.iosHint')}</p>
  {/if}

  {#if source.offlineReady}
    <p data-pwa-offline>{t('pwa.offlineReady')}</p>
  {/if}

  {#if source.updateAvailable}
    <p data-pwa-update>{t('pwa.updateReady')}</p>
    <button type="button" data-pwa-apply onclick={() => void source.applyUpdate()}>
      {t('pwa.update')}
    </button>
  {/if}

  <p class="version" data-pwa-version>
    {t('pwa.version', { version: __APP_VERSION__, date: __BUILD_DATE__ })}
  </p>
</section>

<style>
  .pwa {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }

  h3,
  p {
    margin: 0;
  }

  .version {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  button {
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-md);
    background: none;
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
  }

  button:hover {
    background: var(--accent);
    color: var(--bg);
  }

  button:focus-visible {
    outline: var(--border-thick) solid var(--accent);
    outline-offset: var(--focus-offset);
  }

  @media (max-width: 768px) {
    button {
      min-height: var(--control-md);
    }
  }
</style>
