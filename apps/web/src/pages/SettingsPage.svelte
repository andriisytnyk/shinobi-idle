<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import { BUILTIN_PACKS } from '../lib/builtin-packs.ts';
  import { tryUi } from '../lib/ext/runtime.svelte.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { downloadText } from '../lib/download.ts';
  import { t } from '../lib/i18n.ts';
  import { telemetryFileName } from '../lib/telemetry.ts';
  import { ruleReasonText } from '../lib/vocab.ts';
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

  /** Whether the switched-on built-in packs differ from the ones this boot started with. */
  const pending = $derived(
    BUILTIN_PACKS.some(
      (p) => settings.builtinPacks.includes(p.id) !== (ui?.registry.packs.includes(p.id) ?? false),
    ),
  );

  let exported = $state('');
  let importText = $state('');
  let message = $state<{ ok: boolean; key: string } | null>(null);
  let confirmReset = $state(false);
  let confirmImport = $state(false);
  let typed = $state('');

  const readTel = () => ({
    sessions: game.telemetry.sessions(),
    kb: (game.telemetry.size() / 1024).toFixed(1),
  });
  let telInfo = $state(readTel());
  let telMessage = $state<{ ok: boolean; text: string } | null>(null);

  function exportTelemetry(): void {
    const file = game.telemetry.file();
    const name = telemetryFileName(file.exportedAt);
    const ok = downloadText(name, JSON.stringify(file, null, 1));
    telMessage = ok
      ? { ok, text: t('settings.telemetryExported', { name }) }
      : { ok, text: t('settings.telemetryExportFailed') };
    telInfo = readTel();
  }

  async function clearTelemetry(): Promise<void> {
    await game.telemetry.clear();
    telInfo = readTel();
    telMessage = { ok: true, text: t('settings.telemetryCleared') };
  }

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
    telInfo = readTel();
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

  <section data-builtin-packs>
    <h2>{t('settings.builtin')}</h2>
    <p class="dim">{t('settings.builtinNote')}</p>
    {#each BUILTIN_PACKS as pack (pack.id)}
      <label class="check" data-builtin={pack.id}>
        <input
          type="checkbox"
          checked={settings.builtinPacks.includes(pack.id)}
          onchange={(e) => settings.setBuiltinPack(pack.id, e.currentTarget.checked)}
        />
        <span>
          <strong>{t(pack.name)}</strong>
          <span class="dim desc">{t(pack.desc)}</span>
        </span>
      </label>
    {/each}
    {#if pending}
      <p class="dim" role="status">{t('settings.builtinPending')}</p>
      <button type="button" onclick={() => location.reload()}>{t('settings.builtinRestart')}</button
      >
    {/if}
  </section>

  <section data-ui="loaded-packs">
    <h2>{t('settings.loadedPacks')}</h2>
    <ul class="packs">
      {#each game.packs as pack (pack.id)}
        <li data-pack={pack.id}>{pack.id} <span class="version">{pack.version}</span></li>
      {/each}
    </ul>
  </section>

  {#if game.failed.length > 0}
    <section data-ui="failed-packs">
      <h2>{t('settings.failedPacks')}</h2>
      {#each game.failed as pack (pack.pack)}
        <div class="message bad" role="status" data-pack-failed={pack.pack}>
          <p>{t('settings.packFailed', { pack: pack.pack })}</p>
          <details>
            <summary>{t('settings.details')}</summary>
            <pre>{pack.error}</pre>
          </details>
        </div>
      {/each}
    </section>
  {/if}

  {#if game.ruleNotices.length > 0}
    <section data-ui="disabled-rules">
      <h2>{t('settings.rulesDisabled')}</h2>
      {#each game.ruleNotices as notice (notice.pack + notice.rule)}
        <div class="message bad" role="status" data-rule-disabled={notice.pack}>
          <p>
            {t('settings.ruleDisabled', { pack: notice.pack, why: ruleReasonText(notice.reason) })}
          </p>
          <details>
            <summary>{t('settings.details')}</summary>
            <pre>{notice.rule}: {notice.reason}</pre>
          </details>
        </div>
      {/each}
    </section>
  {/if}

  {#if disabledPacks.length > 0}
    <section data-ui="disabled-packs">
      <h2>{t('settings.disabledPacks')}</h2>
      {#each disabledPacks as pack (pack.packId)}
        <div class="message bad" role="status" data-pack-disabled={pack.packId}>
          <p>{t('settings.packDisabled', { pack: pack.packId })}</p>
          <details>
            <summary>{t('settings.details')}</summary>
            <pre>{pack.message}</pre>
          </details>
        </div>
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

  <section data-telemetry>
    <h2>{t('settings.telemetry')}</h2>
    <p class="dim">{t('settings.telemetryHelp')}</p>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.telemetry}
        onchange={(e) => (settings.telemetry = e.currentTarget.checked)}
      />
      <span>{t('settings.telemetryOn')}</span>
    </label>
    <p class="dim" role="status">
      {t('settings.telemetryInfo', {
        sessions: telInfo.sessions,
        size: telInfo.kb,
      })}
    </p>
    <div class="row">
      <button type="button" onclick={exportTelemetry}>{t('settings.telemetryExport')}</button>
      <button type="button" onclick={clearTelemetry}>{t('settings.telemetryClear')}</button>
    </div>
    {#if telMessage}
      <p class="message" class:bad={!telMessage.ok} role="status">{telMessage.text}</p>
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
  details pre {
    margin: var(--space-1) 0 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .packs {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .version {
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
  }

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

  .desc {
    display: block;
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
