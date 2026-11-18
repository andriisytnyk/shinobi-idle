<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.ts';
  import BoundaryReset from './BoundaryReset.svelte';

  interface Props {
    /** What part of the game this guards (`page`, `side`, `now`…): goes into the error report. */
    area: string;
    /** When this changes after a failure, the part is drawn again (a page boundary passes the route). */
    resetKey?: string;
    children: Snippet;
  }

  let { area, resetKey, children }: Props = $props();

  /** The short report «Повідомити» copies: where, what and the top of the stack; nothing leaves the device. */
  function reportOf(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const stack =
      error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 8).join('\n') : '';
    return [
      `Shinobi Idle ${__APP_VERSION__} (${__BUILD_DATE__})`,
      `area: ${area}`,
      `route: ${location.hash || '#/'}`,
      `error: ${message}`,
      stack,
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  let status = $state<'' | 'copied' | 'failed'>('');
  let text = $state('');

  async function report(error: unknown): Promise<void> {
    text = reportOf(error);
    try {
      await navigator.clipboard.writeText(text);
      status = 'copied';
    } catch {
      status = 'failed';
    }
  }

  function log(error: unknown): void {
    console.error(`[ui] The "${area}" part of the game failed to draw`, error);
  }
</script>

<svelte:boundary onerror={log}>
  {@render children()}
  {#snippet failed(error, reset)}
    <section class="boundary" role="alert" data-error-boundary={area}>
      {#if resetKey !== undefined}<BoundaryReset {resetKey} {reset} />{/if}
      <h2>{t('boundary.title')}</h2>
      <p>{t('boundary.body')}</p>
      <div class="row">
        <button
          type="button"
          class="primary"
          onclick={() => {
            status = '';
            reset();
          }}>{t('boundary.retry')}</button
        >
        <button type="button" onclick={() => void report(error)}>{t('boundary.report')}</button>
      </div>
      {#if status === 'copied'}
        <p class="note" role="status">{t('boundary.reported')}</p>
      {:else if status === 'failed'}
        <p class="note" role="status">{t('boundary.reportFailed')}</p>
        <textarea readonly rows="5" aria-label={t('boundary.report')} value={text}></textarea>
      {/if}
    </section>
  {/snippet}
</svelte:boundary>

<style>
  .boundary {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: var(--border-thin) solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  h2 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: 400;
  }

  p {
    margin: 0;
    color: var(--fg-dim);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
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
    width: 100%;
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
