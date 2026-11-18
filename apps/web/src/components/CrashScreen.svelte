<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';

  const crash = $derived(game.crash);
  /** The last good save as text: null before it was asked for, '' when there is none. */
  let exported = $state<string | null>(null);
  let copied = $state(false);
  let heading = $state<HTMLElement>();

  // The screen replaces the whole app: focus lands on its title, so a keyboard or a screen reader starts there.
  $effect(() => heading?.focus());

  async function doExport(): Promise<void> {
    exported = (await game.exportStored()) ?? '';
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(exported ?? '');
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

<main class="gate" data-gate="crashed" role="alert">
  <h1 tabindex="-1" bind:this={heading}>{t('crash.title')}</h1>
  <p>{t('crash.body')}</p>
  {#if crash}
    <details>
      <summary>{t('crash.details')}</summary>
      <pre class="message">{crash.message}</pre>
    </details>
  {/if}

  <div class="row">
    <button type="button" onclick={() => void doExport()}>{t('crash.export')}</button>
    <button type="button" class="primary" onclick={() => location.reload()}>
      {t('crash.restart')}
    </button>
  </div>

  {#if exported === ''}
    <p data-crash-empty>{t('crash.exportEmpty')}</p>
  {:else if exported !== null}
    <p>{t('crash.exportHint')}</p>
    <textarea readonly rows="6" aria-label={t('crash.export')} value={exported}></textarea>
    <button type="button" onclick={() => void copy()}>
      {copied ? '✓ ' : ''}{t('crash.copy')}
    </button>
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
    font-size: var(--text-xl);
    font-weight: 400;
  }

  h1:focus {
    outline: none;
  }

  p {
    max-width: var(--modal-width);
    margin: 0;
    color: var(--fg-dim);
  }

  .message {
    max-width: 100%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--danger);
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
    min-height: var(--control-md);
    padding: var(--space-2) var(--space-4);
    border: var(--border-thin) solid var(--line);
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

  textarea {
    --_width: 40rem;
    width: min(var(--_width), 100%);
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
