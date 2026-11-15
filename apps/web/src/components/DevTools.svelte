<script lang="ts">
  import { serialize } from '@shinobi/core';
  import { DEV_STEPS, isDevMode } from '../lib/dev.ts';
  import { formatDuration } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';

  interface Props {
    /** The query string of the page address; the panel exists only when it has `dev=1`. */
    search?: string;
  }

  let { search }: Props = $props();

  let dump = $state('');
</script>

{#if isDevMode(search)}
  <details class="dev" data-dev-tools>
    <summary class="title">{t('dev.title')}</summary>
    <p class="now">{t('dev.now', { time: formatDuration(game.state.now) })}</p>
    <div class="row">
      {#each DEV_STEPS as step (step.ms)}
        <button type="button" data-advance={step.ms} onclick={() => game.devAdvance(step.ms)}>
          {t(step.key)}
        </button>
      {/each}
      <button type="button" data-dump onclick={() => (dump = serialize(game.state))}>
        {t('dev.dump')}
      </button>
    </div>
    {#if dump}
      <textarea readonly rows="6" aria-label={t('dev.dumpLabel')} value={dump}></textarea>
    {/if}
  </details>
{/if}

<style>
  .dev {
    position: fixed;
    left: var(--space-2);
    bottom: calc(var(--now-height) + var(--space-2));
    z-index: var(--z-toast);
    max-width: calc(100% - var(--space-4));
    max-height: 60dvh;
    overflow-y: auto;
    padding: var(--space-2) var(--space-3);
    border: 1px dashed var(--danger);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .dev[open] {
    width: min(var(--size-22), calc(100% - var(--space-4)));
  }

  @media (max-width: 768px) {
    .dev {
      right: var(--space-2);
      left: auto;
      bottom: calc(var(--now-height) + var(--tabbar-height) + var(--space-2));
    }
  }

  p {
    margin: 0;
  }

  .title {
    display: flex;
    align-items: center;
    min-height: var(--control-size);
    color: var(--danger);
    font-size: var(--font-size-0-8);
    font-weight: 600;
    cursor: pointer;
  }

  .now {
    color: var(--fg-dim);
    font-size: var(--font-size-0-8);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  button {
    min-height: var(--control-size);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  textarea {
    width: 100%;
    margin-top: var(--space-2);
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--font-size-0-7);
  }
</style>
