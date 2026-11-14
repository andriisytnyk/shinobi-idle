<script lang="ts">
  import { t } from '../lib/i18n.ts';
</script>

<footer class="now" aria-label={t('now.title')}>
  <span class="title">{t('now.title')}</span>
  <span class="slot">{t('now.slot.main')}: {t('now.idle')}</span>
  <button type="button" class="stop" disabled>{t('now.stop')}</button>
</footer>

<style>
  .now {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--line);
    background: var(--surface);
  }

  .title {
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 0.85rem;
  }

  .slot {
    flex: 1;
    overflow: hidden;
    color: var(--fg-dim);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stop {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
  }

  .stop:disabled {
    opacity: 0.5;
  }

  @media (max-width: 768px) {
    .now {
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      font-size: 0.85rem;
    }
  }
</style>
