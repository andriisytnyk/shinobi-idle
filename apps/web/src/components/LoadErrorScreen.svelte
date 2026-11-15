<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';

  const error = $derived(game.loadError);
  let showRaw = $state(false);
  let confirming = $state(false);
</script>

<main class="gate" data-gate="error">
  <h1>{t('gate.error.title')}</h1>
  <p>{t('gate.error.body')}</p>
  {#if error}<pre class="message">{error.message}</pre>{/if}

  <div class="row">
    <button type="button" class="primary" onclick={() => void game.retry()}>
      {t('gate.error.retry')}
    </button>
    {#if error?.raw}
      <button type="button" onclick={() => (showRaw = !showRaw)}>{t('gate.error.export')}</button>
    {/if}
    <button type="button" onclick={() => (confirming = true)}>{t('gate.error.newGame')}</button>
  </div>

  {#if showRaw && error?.raw}
    <textarea readonly rows="6" aria-label={t('gate.error.export')} value={error.raw}></textarea>
  {/if}

  {#if confirming}
    <div class="confirm" role="alert">
      <p>{t('gate.error.newGameConfirm')}</p>
      <div class="row">
        <button type="button" onclick={() => (confirming = false)}>{t('settings.cancel')}</button>
        <button type="button" class="danger" onclick={() => void game.startNewAfterError()}>
          {t('gate.error.newGameYes')}
        </button>
      </div>
    </div>
  {/if}
</main>

<style>
  .gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-height: 100dvh;
    padding: var(--space-4);
    text-align: center;
  }

  h1 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.5rem;
    font-weight: 400;
  }

  p {
    max-width: 36rem;
    margin: 0;
    color: var(--fg-dim);
  }

  .message {
    max-width: 100%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--danger);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
  }

  button {
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--ink-900);
    font-weight: 600;
  }

  button.danger {
    border-color: var(--danger);
    background: var(--danger);
  }

  textarea {
    width: min(40rem, 100%);
    padding: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font-family: monospace;
    font-size: 0.8rem;
  }

  .confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--danger);
    border-radius: var(--radius);
  }
</style>
