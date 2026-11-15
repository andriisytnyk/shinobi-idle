<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts.list as toast (toast.id)}
    <div class="toast" data-toast={toast.key}>
      <span>
        {t(toast.key, toast.params)}
        {#if toast.ref}<EntityLink kind={toast.ref.kind} id={toast.ref.id} />{/if}
        {#if toast.gains}
          <span class="gains" data-gains>
            {#if toast.gains.ryo > 0}<span>{t('toast.gainRyo', { n: toast.gains.ryo })}</span>{/if}
            {#each toast.gains.items as item (item.id)}
              <span><EntityLink kind="item" id={item.id} /> ×{item.n}</span>
            {/each}
          </span>
        {/if}
      </span>
      <button type="button" aria-label={t('modal.close')} onclick={() => toasts.dismiss(toast.id)}>
        <Icon name="lucide:x" size={14} />
      </button>
    </div>
  {/each}
</div>

<style>
  .gains {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  .toasts {
    position: fixed;
    right: var(--space-4);
    bottom: calc(var(--now-height) + var(--space-3));
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(22rem, calc(100vw - 2 * var(--space-4)));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--surface-raised);
    pointer-events: auto;
  }

  .toast :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  button {
    display: inline-flex;
    padding: var(--space-1);
    border: 0;
    background: none;
    color: var(--fg-dim);
    cursor: pointer;
  }

  @media (max-width: 768px) {
    button {
      align-items: center;
      justify-content: center;
      min-width: 2.75rem;
      min-height: 2.75rem;
    }

    .toasts {
      right: var(--space-3);
      bottom: calc(var(--now-height) + var(--tabbar-height) + var(--space-2));
    }
  }
</style>
