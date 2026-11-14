<script lang="ts">
  import { t } from '../lib/i18n.ts';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
</script>

<aside id="meta-panel" class="meta" aria-label={t('meta.title')}>
  <div class="head">
    <h2>{t('meta.title')}</h2>
    <button type="button" class="close" onclick={onClose}>{t('meta.close')}</button>
  </div>
  <p class="empty">{t('meta.empty')}</p>
</aside>

<style>
  .meta {
    padding: var(--space-4);
    background: var(--surface);
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  .close {
    display: none;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
  }

  @media (max-width: 768px) {
    .close {
      display: inline-block;
    }
  }

  h2 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1rem;
    font-weight: 400;
  }

  .empty {
    margin: 0;
    color: var(--fg-dim);
  }
</style>
