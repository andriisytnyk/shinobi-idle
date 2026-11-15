<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.ts';

  interface Props {
    title: string;
    /** Paper style for the ANBU report. */
    paper?: boolean;
    onClose: () => void;
    children?: Snippet;
    actions?: Snippet;
  }

  let { title, paper = false, onClose, children, actions }: Props = $props();

  let dialog: HTMLElement | undefined = $state();

  // Focus moves into the dialog on open and back to where it was on close.
  $effect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.focus();
    return () => {
      before?.focus();
    };
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab' && dialog) {
      // Keep Tab inside the dialog.
      const items = [
        ...dialog.querySelectorAll<HTMLElement>('button, input, textarea, a[href]'),
      ].filter((el) => !el.hasAttribute('disabled'));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
</script>

<div class="backdrop">
  <div
    class="dialog"
    class:paper
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    bind:this={dialog}
    onkeydown={onKeydown}
  >
    <h2>{title}</h2>
    <div class="body">{@render children?.()}</div>
    <div class="actions">
      {#if actions}
        {@render actions()}
      {:else}
        <button type="button" class="primary" onclick={onClose}>{t('modal.close')}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--scrim);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: min(36rem, 100%);
    max-height: 100%;
    padding: var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--fg);
  }

  .dialog.paper {
    border-color: var(--paper-ink);
    border-top: 0.75rem solid var(--ink-600);
    border-bottom: 0.75rem solid var(--ink-600);
    background: var(--paper);
    color: var(--paper-ink);
  }

  h2 {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 1.3rem;
    font-weight: 400;
  }

  .body {
    overflow-y: auto;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .actions :global(button) {
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .actions :global(button:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  .actions :global(button.primary) {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--ink-900);
    font-weight: 600;
  }

  .actions :global(button.danger) {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--text);
  }
</style>
