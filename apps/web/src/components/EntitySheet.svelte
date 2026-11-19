<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.ts';
  import Icon from './Icon.svelte';

  interface Props {
    /** The accessible name of the sheet: the entity's name, or a neutral text while it is not shown. */
    label: string;
    /** `kind:id` of the entity, or undefined while it is not shown (nothing derived from it may reach the page). */
    entity?: string;
    /** Closes the sheet: back to the parent page. */
    onClose: () => void;
    children?: Snippet;
  }

  let { label, entity, onClose, children }: Props = $props();

  let sheet: HTMLElement | undefined = $state();

  const FOCUSABLE =
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  // Focus moves into the sheet when it opens and back to what opened it when it closes. When that
  // element is gone (the sheet was reached by an address, or the link was inside the sheet), it goes
  // to the highlighted tile of the parent page.
  $effect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet?.focus({ preventScroll: true });
    return () => {
      if (before && before.isConnected && before !== document.body) before.focus();
      else
        document
          .querySelector<HTMLElement>('[data-highlighted] a[href], [data-highlighted]')
          ?.focus();
    };
  });

  // Closing goes through the history and lands a tick later: a second Escape or click before that
  // must not step back past the parent page.
  let closing = false;
  function close(): void {
    if (closing) return;
    closing = true;
    onClose();
  }

  /** A dialog drawn above the sheet (a modal) owns the keyboard while focus is inside it. */
  function insideAnotherDialog(node: EventTarget | null): boolean {
    if (!(node instanceof Element)) return false;
    const dialog = node.closest('[aria-modal="true"]');
    return dialog !== null && dialog !== sheet;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (insideAnotherDialog(event.target) || insideAnotherDialog(document.activeElement)) return;
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !sheet) return;
    // Keep Tab inside the sheet.
    const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const at = document.activeElement;
    if (event.shiftKey && (at === first || at === sheet || !sheet.contains(at))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (at === last || !sheet.contains(at))) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<!-- Escape closes the sheet wherever focus is, unless something inside (a popover, a modal) took the key first. -->
<svelte:window onkeydown={onKeydown} />

<div class="layer">
  <button type="button" class="backdrop" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div
    class="sheet"
    data-ui="sheet"
    data-entity={entity}
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabindex="-1"
    bind:this={sheet}
  >
    <div class="bar">
      <button type="button" class="close" data-sheet-close onclick={close}>
        <span class="phone"><Icon name="lucide:arrow-left" size={18} /> {t('sheet.back')}</span>
        <span class="desk"><Icon name="lucide:x" size={18} /> {t('sheet.close')}</span>
      </button>
    </div>
    <div class="body">{@render children?.()}</div>
  </div>
</div>

<style>
  .layer {
    position: fixed;
    inset: var(--topbar-height) 0 0 0;
    z-index: var(--z-popover-top);
    display: flex;
    justify-content: flex-end;
  }

  /* Clicking beside the sheet closes it; the page stays visible, only dimmed. */
  .backdrop {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    background: var(--scrim);
    opacity: 0.35;
    cursor: default;
  }

  .sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(var(--modal-width), 100%);
    border-left: var(--border-thin) solid var(--line);
    background: var(--surface);
    color: var(--fg);
  }

  .bar {
    display: flex;
    flex: none;
    justify-content: flex-end;
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-thin) solid var(--line);
  }

  .close {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .close span {
    align-items: center;
    gap: var(--space-2);
  }

  .close .phone {
    display: none;
  }

  .close .desk {
    display: inline-flex;
  }

  .body {
    flex: 1;
    min-height: 0;
    padding: var(--space-4);
    overflow-y: auto;
  }

  /* On a phone the sheet is the whole screen and its control is «Назад». */
  @media (max-width: 768px) {
    .layer {
      inset: 0;
    }

    .backdrop {
      display: none;
    }

    .sheet {
      width: 100%;
      border-left: 0;
    }

    .bar {
      justify-content: flex-start;
    }

    .close .phone {
      display: inline-flex;
    }

    .close .desk {
      display: none;
    }
  }
</style>
