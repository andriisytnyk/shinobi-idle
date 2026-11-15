<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  /** On a phone three toasts at most are shown; the older ones are counted in a chip. */
  let phone = $state(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  $effect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const update = () => (phone = query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
  const cap = $derived(phone ? 3 : 6);
  // Persistent toasts (an update waiting) are always shown; the newest ordinary ones fill the rest.
  const shown = $derived.by(() => {
    const ordinary = toasts.list.filter((toast) => !toast.persistent);
    const room = Math.max(0, cap - (toasts.list.length - ordinary.length));
    const keep = new Set(ordinary.slice(Math.max(0, ordinary.length - room)).map((x) => x.id));
    return toasts.list.filter((toast) => toast.persistent || keep.has(toast.id));
  });
  const hidden = $derived(toasts.list.length - shown.length);

  // The host is last in the page, far from the start of the tab order. A toast with an action
  // takes the focus when it appears, unless the player is typing in a field.
  let host: HTMLElement | undefined = $state();
  let focused = 0;
  $effect(() => {
    const toast = shown.find((x) => x.persistent && x.action);
    if (!toast || toast.id === focused || !host) return;
    focused = toast.id;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement &&
      (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
    if (typing) return;
    host.querySelector<HTMLElement>(`[data-toast-id="${toast.id}"] [data-toast-action]`)?.focus();
  });
</script>

<div class="toasts" role="status" aria-live="polite" bind:this={host}>
  {#if hidden > 0}<p class="more" data-toasts-more>{t('toast.more', { n: hidden })}</p>{/if}
  {#each shown as toast (toast.id)}
    <div
      class="toast"
      data-toast={toast.key}
      data-toast-id={toast.id}
      data-ui="toast"
      role={toast.persistent ? 'alert' : undefined}
    >
      <span>
        {#if toast.subject}<EntityLink kind={toast.subject.kind} id={toast.subject.id} />{/if}
        {t(toast.key, toast.params)}
        {#if toast.ref}<EntityLink kind={toast.ref.kind} id={toast.ref.id} />{/if}
        {#if toast.gains}
          <span class="gains" data-gains>
            {#if toast.gains.ryo > 0}<span>{t('toast.gainRyo', { n: toast.gains.ryo })}</span>{/if}
            {#each toast.gains.items as item (item.id)}
              <span><EntityLink kind="item" id={item.id} /> ×{item.n}</span>
            {/each}
            {#each toast.gains.missed ?? [] as item (item.id)}
              <span data-missed>
                {t('toast.mission.missed')}
                <EntityLink kind="item" id={item.id} /> ×{item.n}
              </span>
            {/each}
          </span>
        {/if}
      </span>
      {#if toast.action}
        {@const action = toast.action}
        <button
          type="button"
          class="action"
          data-toast-action
          onclick={async () => {
            // `false` means the action was refused: the toast stays for another try.
            if ((await action.run()) !== false) toasts.dismiss(toast.id);
          }}
        >
          {t(action.labelKey)}
        </button>
      {/if}
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
    font-size: var(--text-xs);
  }

  .more {
    align-self: flex-start;
    margin: 0;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    color: var(--fg-dim);
    font-size: var(--text-xs);
    pointer-events: auto;
  }

  /* On a wide screen the toasts sit at the left of the page, clear of the side panel and the goal panel. */
  .toasts {
    position: fixed;
    bottom: calc(var(--now-height) + var(--space-3));
    left: calc(var(--sidebar-width) + var(--space-4));
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(var(--toast-width), calc(100vw - 2 * var(--space-4)));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    pointer-events: auto;
  }

  .toast :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  button.action {
    flex: none;
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-md);
    color: var(--accent);
    font-weight: 600;
  }

  button.action:hover {
    background: var(--accent);
    color: var(--bg);
  }

  button:focus-visible {
    outline: var(--border-thick) solid var(--accent);
    outline-offset: var(--focus-offset);
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
    button.action {
      min-height: var(--control-md);
    }

    button {
      align-items: center;
      justify-content: center;
      min-width: var(--control-md);
      min-height: var(--control-md);
    }

    /* On a phone they stay at the top, clear of the bottom sheet and its action row. */
    .toasts {
      top: var(--space-2);
      right: var(--space-3);
      bottom: auto;
      left: var(--space-3);
      width: auto;
    }
  }
</style>
