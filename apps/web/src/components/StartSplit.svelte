<script lang="ts">
  import type { CommandResult } from '@shinobi/core';
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import {
    defaultPerformer,
    hasSquad,
    newCloneSlot,
    noteFor,
    performersOf,
    runningBy,
    startCommand,
    stopCommand,
    type Performer,
  } from '../lib/squad.ts';
  import { squadUi } from '../lib/squad-ui.svelte.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import Icon from './Icon.svelte';

  interface Props {
    /** What is started: the action's kind and id. The menu says by them who does it now. */
    kind: string;
    id: string;
    /** The action cannot be started at all (it is locked, or lacks an ingredient). */
    disabled?: boolean;
    /** Whether a given performer cannot start it (a mission's refusal for a clone, say). */
    disabledFor?: (p: Performer) => boolean;
    /** Starts the action with `p`; by default the command `action.start` in the performer's slot. */
    run?: (p: Performer) => CommandResult;
    /** The label of the button, a key; «Почати» by default. */
    label?: string;
    /** A `data-<mark>` attribute of the main button, for the places that find a start by it. */
    mark?: string;
    /** What follows the label (a time, a price). */
    suffix?: string;
    /** The id of the text that says why the button is off. */
    describedBy?: string | undefined;
    /** Extra classes of the main button (the sites style it as `action` or `ct-action`). */
    cls?: string;
    /** The label may wrap onto several lines instead of being cut with an ellipsis. */
    wrap?: boolean;
  }

  let {
    kind,
    id,
    disabled = false,
    disabledFor,
    run,
    label = 'tile.start',
    suffix = '',
    mark,
    describedBy,
    cls = 'ct-action',
    wrap = false,
  }: Props = $props();

  const content = game.content;
  const list = $derived(game.read((gs) => performersOf(gs, content, game.rules)));
  const squad = $derived(game.read((gs) => hasSquad(gs, content)));
  /** The performer is named on the button only when there is somebody to choose from: a clone exists besides the character. */
  const choice = $derived(list.length > 1);
  /** Whether a new clone could take this action now. */
  const canClone = $derived(game.read((gs) => newCloneSlot(gs, content) !== null));

  /** The runners come first, so that the button can stop what runs; else the first idle clone, else the character. */
  const performer = $derived.by(() => {
    const picked = squadUi.picked;
    if (picked !== null && list.some((p) => p.id === picked)) return defaultPerformer(list, picked);
    return runningBy(list, kind, id)[0] ?? defaultPerformer(list, null);
  });
  const stopping = $derived(noteFor(performer, kind, id) === 'same');
  const who = $derived(performer.clone ? t('squad.clone', { n: performer.n }) : t('squad.you'));
  /** «Почати · Клон 2 · 5 хв»: the action, who does it, then what the action adds (a time, a price). */
  const caption = $derived(
    [t(stopping ? 'tile.stop' : label), choice ? who : '', suffix && !stopping ? suffix : '']
      .filter((part) => part !== '')
      .join(' · '),
  );
  const off = $derived(!stopping && (disabled || (disabledFor?.(performer) ?? false)));

  let open = $state(false);
  let root = $state<HTMLElement>();

  const refuse = (result: CommandResult): boolean => {
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
    return result.ok;
  };

  function stop(p: Performer): void {
    if (p.clone) squadUi.askDispel(p.id);
    else refuse(game.dispatch(stopCommand(p)));
  }

  function startWith(p: Performer): void {
    open = false;
    if (noteFor(p, kind, id) === 'same') return stop(p);
    const result = run ? run(p) : game.dispatch(startCommand(p, kind, id));
    if (refuse(result)) squadUi.pick(null);
  }

  /** A new clone is made through the pouch picker, then does this action. */
  function startNewClone(): void {
    open = false;
    squadUi.askClone({ kind, id });
  }

  function press(): void {
    if (stopping) stop(performer);
    else startWith(performer);
  }

  function closeOutside(event: Event): void {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }

  function menuKeys(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      open = false;
      root?.querySelector<HTMLElement>('.chevron')?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [
      ...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
    event.preventDefault();
  }

  const whatOf = (p: Performer): string => (p.ref ? entityName(p.ref) : '');
  const nameOf = (p: Performer): string =>
    p.clone ? t('squad.clone', { n: p.n }) : t('squad.you');

  $effect(() => {
    if (!open) return;
    document.addEventListener('pointerdown', closeOutside);
    queueMicrotask(() => root?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => document.removeEventListener('pointerdown', closeOutside);
  });
</script>

<span class="split" class:plain={!squad} bind:this={root} data-ui="start-split" data-for={kind}>
  <button
    type="button"
    class="main {cls}"
    class:stop={stopping}
    class:wrap
    disabled={off}
    data-start
    {...mark ? { [`data-${mark}`]: '' } : {}}
    data-performer={performer.n}
    aria-describedby={off ? describedBy : undefined}
    onclick={press}
  >
    {caption}
  </button>
  {#if squad}
    <button
      type="button"
      class="chevron {cls}"
      class:stop={stopping}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t('squad.menu.label')}
      title={t('squad.menu.label')}
      onclick={() => (open = !open)}
    >
      <Icon name="lucide:chevron-down" size={16} />
    </button>
    {#if open}
      <ul
        class="menu"
        role="menu"
        aria-label={t('squad.menu.label')}
        data-ui="performer-menu"
        tabindex="-1"
        onkeydown={menuKeys}
      >
        {#each list as p (p.id)}
          {@const note = noteFor(p, kind, id)}
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="item"
              data-performer={p.n}
              data-note={note}
              disabled={note !== 'same' && (disabled || (disabledFor?.(p) ?? false))}
              onclick={() => startWith(p)}
            >
              <span class="item-name">{nameOf(p)}</span>
              <span class="item-note">
                {#if note === 'same'}{t('squad.menu.same')}{:else if note === 'replaces'}{t(
                    'squad.menu.replaces',
                    { what: whatOf(p) },
                  )}{:else}{t('squad.menu.free')}{/if}
              </span>
            </button>
          </li>
        {/each}
        <li role="none">
          <button
            type="button"
            role="menuitem"
            class="item new"
            data-ui="clone-start"
            data-new-clone
            disabled={disabled || !canClone}
            onclick={startNewClone}
          >
            <Icon name="lucide:copy-plus" size={16} />
            <span class="item-name">{t('squad.menu.newClone')}</span>
          </button>
        </li>
      </ul>
    {/if}
  {/if}
</span>

<style>
  .split {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
  }

  .main {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A label that must stay readable wraps; the row grows instead of cutting it. */
  .main.wrap {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .split:not(.plain) .main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .chevron {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--control-md);
    padding-inline: var(--space-2);
    border-left: var(--border-thin) solid var(--ink-900);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .menu {
    position: absolute;
    inset-inline: 0;
    bottom: 100%;
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    min-width: var(--panel-min);
    margin: 0 0 var(--space-1);
    padding: var(--space-1);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    list-style: none;
  }

  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-2);
    width: 100%;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .item:hover:not(:disabled),
  .item:focus-visible {
    background: var(--surface);
  }

  .item:disabled {
    color: var(--fg-dim);
    cursor: not-allowed;
  }

  .item-name {
    font-weight: 600;
  }

  .item-note {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .item.new {
    justify-content: flex-start;
    align-items: center;
    border-top: var(--border-thin) solid var(--line);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    color: var(--accent);
  }

  .item.new:disabled {
    color: var(--fg-dim);
  }
</style>
