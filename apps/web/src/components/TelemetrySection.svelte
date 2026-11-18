<script lang="ts">
  import { downloadText } from '../lib/download.ts';
  import { t } from '../lib/i18n.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { game } from '../lib/store.ts';
  import { telemetryFileName } from '../lib/telemetry.ts';

  // Reads the game's version, so a reset, an import or a restore refreshes the figures.
  const info = $derived.by(() => {
    void game.version;
    return {
      sessions: game.telemetry.sessions(),
      kb: (game.telemetry.size() / 1024).toFixed(1),
    };
  });
  let message = $state<{ ok: boolean; text: string } | null>(null);

  function exportTelemetry(): void {
    const file = game.telemetry.file();
    const name = telemetryFileName(file.exportedAt);
    const ok = downloadText(name, JSON.stringify(file, null, 1));
    message = ok
      ? { ok, text: t('settings.telemetryExported', { name }) }
      : { ok, text: t('settings.telemetryExportFailed') };
  }

  async function clearTelemetry(): Promise<void> {
    await game.telemetry.clear();
    message = { ok: true, text: t('settings.telemetryCleared') };
  }
</script>

<!-- Registered in the settings slot by the built-in UI pack, like any pack's section would be. -->
<section data-telemetry data-ui="telemetry-section">
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
    {t('settings.telemetryInfo', { sessions: info.sessions, size: info.kb })}
  </p>
  <div class="row">
    <button type="button" onclick={exportTelemetry}>{t('settings.telemetryExport')}</button>
    <button type="button" onclick={clearTelemetry}>{t('settings.telemetryClear')}</button>
  </div>
  {#if message}
    <p class="message" class:bad={!message.ok} role="status">{message.text}</p>
  {/if}
</section>

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

  .message {
    margin: var(--space-2) 0 0;
    color: var(--success);
  }

  .message.bad {
    color: var(--danger);
  }
</style>
