<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
</script>

<main class="gate" data-gate="blocked">
  <h1>{t('gate.blocked.title')}</h1>
  <p>{t('gate.blocked.body')}</p>
  <button type="button" onclick={() => void game.takeOver()}>{t('gate.blocked.takeOver')}</button>
</main>

<style>
  .gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: 100dvh;
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

  p {
    --_max-width: 32rem;
    max-width: var(--_max-width);
    margin: 0;
    color: var(--fg-dim);
  }

  button {
    min-height: var(--control-md);
    padding: var(--space-2) var(--space-4);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
</style>
