<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import { tryUi } from '../lib/ext/runtime.svelte.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { t } from '../lib/i18n.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  const ui = tryUi();
  const themes = ui?.registry.themes ?? [];
  const packSettings = ui?.registry.settings ?? [];
  const disabledPacks = ui?.registry.disabled ?? [];
  /** The theme in use: an unknown stored id means the base theme, and the picker must say so. */
  const currentTheme = $derived(
    themes.some((theme) => theme.key === settings.theme)
      ? settings.theme
      : (themes.find((theme) => theme.key === 'core:base') ?? themes[0])?.key,
  );

  let exported = $state('');
  let importText = $state('');
  let message = $state<{ ok: boolean; key: string } | null>(null);
  let confirmReset = $state(false);
  let confirmImport = $state(false);
  let typed = $state('');

  function doExport(): void {
    exported = game.exportText();
    message = null;
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(exported);
      message = { ok: true, key: 'settings.copied' };
    } catch {
      message = { ok: false, key: 'settings.copyFailed' };
    }
  }

  /** Checks the pasted text first, so a bad one is rejected before anyone is asked to confirm. */
  function askImport(): void {
    try {
      game.previewImport(importText.trim());
      confirmImport = true;
    } catch {
      message = { ok: false, key: 'settings.importFailed' };
    }
  }

  async function doImport(): Promise<void> {
    confirmImport = false;
    try {
      await game.importText(importText.trim());
      importText = '';
      message = { ok: true, key: 'settings.imported' };
    } catch {
      message = { ok: false, key: 'settings.importFailed' };
    }
  }

  async function doRestore(): Promise<void> {
    const ok = await game.restoreBackup();
    message = { ok, key: ok ? 'settings.restored' : 'settings.restoreFailed' };
  }

  async function doReset(): Promise<void> {
    confirmReset = false;
    typed = '';
    await game.reset();
    exported = '';
    message = { ok: true, key: 'settings.resetDone' };
  }
</script>

<SimplePage title={t('settings.title')}>
  <section>
    <h2>{t('settings.interface')}</h2>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.hideLocked}
        onchange={(e) => (settings.hideLocked = e.currentTarget.checked)}
      />
      {t('settings.hideLocked')}
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.hints}
        onchange={(e) => (settings.hints = e.currentTarget.checked)}
      />
      {t('settings.hints')}
    </label>
    <button type="button" onclick={() => settings.resetHints()}>{t('settings.resetHints')}</button>
    {#if ui && themes.length > 1}
      <label class="select" data-ui="theme-select">
        {t('settings.theme')}
        <select value={currentTheme} onchange={(e) => (settings.theme = e.currentTarget.value)}>
          {#each themes as theme (theme.key)}
            <option value={theme.key}>{ui.t(theme.name)}</option>
          {/each}
        </select>
      </label>
    {/if}
  </section>

  {#if disabledPacks.length > 0}
    <section data-ui="disabled-packs">
      <h2>{t('settings.disabledPacks')}</h2>
      {#each disabledPacks as pack (pack.packId)}
        <p class="message bad" role="status">
          {t('settings.packDisabled', { pack: pack.packId, error: pack.message })}
        </p>
      {/each}
    </section>
  {/if}

  {#if ui && packSettings.length > 0}
    <section data-ui="pack-settings">
      <h2>{t('settings.packs')}</h2>
      {#each packSettings as setting (setting.key)}
        {#if setting.kind === 'toggle'}
          <label class="check">
            <input
              type="checkbox"
              checked={ui.settingValue(setting.key) === true}
              onchange={(e) => ui.setSetting(setting.key, e.currentTarget.checked)}
            />
            {ui.t(setting.title)}
          </label>
        {:else}
          <label class="select">
            {ui.t(setting.title)}
            <select
              value={ui.settingValue(setting.key)}
              onchange={(e) => ui.setSetting(setting.key, e.currentTarget.value)}
            >
              {#each setting.options ?? [] as option (option.value)}
                <option value={option.value}>{ui.t(option.label)}</option>
              {/each}
            </select>
          </label>
        {/if}
      {/each}
    </section>
  {/if}

  <section>
    <h2>{t('settings.save')}</h2>
    <p class="dim">{t('settings.saveHelp')}</p>
    <div class="row">
      <button type="button" onclick={doExport}>{t('settings.export')}</button>
      {#if exported}<button type="button" onclick={copy}>{t('settings.copy')}</button>{/if}
    </div>
    {#if exported}
      <textarea readonly rows="4" aria-label={t('settings.export')} value={exported}></textarea>
    {/if}

    <textarea
      rows="4"
      aria-label={t('settings.import')}
      placeholder={t('settings.importPlaceholder')}
      bind:value={importText}></textarea>
    <div class="row">
      <button type="button" disabled={importText.trim() === ''} onclick={askImport}>
        {t('settings.import')}
      </button>
    </div>
    {#if message}
      <p class="message" class:bad={!message.ok} role="status">{t(message.key)}</p>
    {/if}
  </section>

  <section>
    <h2>{t('settings.danger')}</h2>
    <button type="button" class="danger" onclick={() => (confirmReset = true)}>
      {t('settings.reset')}
    </button>
    {#if game.hasBackup}
      <button type="button" onclick={doRestore}>{t('settings.restore')}</button>
    {/if}
  </section>

  <section>
    <a class="link" href="#/credits">
      <Icon name="lucide:info" size={18} />
      <span>{t('more.credits')}</span>
      <Icon name="lucide:chevron-right" size={16} />
    </a>
  </section>
  <Slot name="settings" />
</SimplePage>

{#if confirmReset}
  <Modal title={t('settings.resetConfirmTitle')} onClose={() => (confirmReset = false)}>
    <p>{t('settings.resetConfirm')}</p>
    <label class="typed">
      {t('settings.resetType', { word: t('settings.resetWord') })}
      <input type="text" bind:value={typed} autocomplete="off" />
    </label>
    {#snippet actions()}
      <button type="button" onclick={() => (confirmReset = false)}>{t('settings.cancel')}</button>
      <button
        type="button"
        class="danger"
        disabled={typed.trim().toLowerCase() !== t('settings.resetWord').toLowerCase()}
        onclick={doReset}>{t('settings.reset')}</button
      >
    {/snippet}
  </Modal>
{/if}

{#if confirmImport}
  <Modal title={t('settings.importConfirmTitle')} onClose={() => (confirmImport = false)}>
    <p>{t('settings.importConfirm')}</p>
    {#snippet actions()}
      <button type="button" onclick={() => (confirmImport = false)}>{t('settings.cancel')}</button>
      <button type="button" class="danger" onclick={doImport}>{t('settings.import')}</button>
    {/snippet}
  </Modal>
{/if}

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

  .select {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .select select {
    min-height: var(--control-md);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--control-md);
  }

  .check input {
    width: var(--icon-md);
    height: var(--icon-md);
    accent-color: var(--accent);
  }

  .dim {
    margin: 0 0 var(--space-3);
    color: var(--fg-dim);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }

  button {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.danger {
    border-color: var(--danger);
  }

  textarea {
    display: block;
    width: 100%;
    margin-top: var(--space-2);
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    word-break: break-all;
  }

  .typed {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .typed input {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
  }

  .message {
    margin: var(--space-2) 0 0;
    color: var(--success);
  }

  .message.bad {
    color: var(--danger);
  }

  .link {
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

  .link span {
    flex: 1;
  }
</style>
