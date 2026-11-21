<script lang="ts">
  import { GOAL_CAP, isStoryGoal } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { nameShown } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import Icon from './Icon.svelte';

  interface Props {
    /** The entity that becomes the goal: a core entity kind and id. */
    kind: string;
    id: string;
    /** `icon`: the pin in a tile's corner. `link`: a one-line caption under a requirement tree. `button`: a text button of an entity page. */
    variant?: 'icon' | 'link' | 'button';
    /** The icon is always shown (a locked tile); otherwise it shows when the tile is hovered or focused. */
    always?: boolean;
  }

  let { kind, id, variant = 'icon', always = false }: Props = $props();

  const content = game.content;
  const pinned = $derived(game.read((gs) => gs.goals.some((g) => g.kind === kind && g.id === id)));
  /** The chain of the main story is always a goal: it has no pin to press. */
  const story = $derived(isStoryGoal({ kind, id }, content));
  /** With the cap reached the pin explains why it does nothing, until a goal is let go. */
  const full = $derived(game.read((gs) => !pinned && gs.goals.length >= GOAL_CAP));
  /** A goal is never offered for an entity the player has not discovered. */
  const offered = $derived(nameShown({ kind, id }));
  const label = $derived(
    pinned ? t('meta.unpin') : full ? t('meta.pinFull', { n: GOAL_CAP }) : t('meta.pin'),
  );

  /** Pinning adds a goal to the list; pressing the pin of a pinned one lets it go. */
  function toggle(): void {
    if (full) return;
    const result = pinned
      ? game.dispatch({ type: 'goal.unpin', ref: { kind, id } })
      : game.dispatch({ type: 'goal.pin', ref: { kind, id } });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

{#if !offered || story}
  <!-- hidden: nothing to pin yet -->
{:else if variant === 'button'}
  <button
    type="button"
    class="text"
    data-ui="pin-goal"
    data-entity="{kind}:{id}"
    data-pinned={pinned}
    disabled={full}
    onclick={toggle}
  >
    <Icon name="lucide:pin" size={16} />
    {label}
  </button>
{:else if variant === 'link'}
  <button
    type="button"
    class="link"
    data-ui="pin-goal"
    data-entity="{kind}:{id}"
    data-pinned={pinned}
    disabled={full}
    onclick={toggle}
  >
    {label}
  </button>
{:else}
  <button
    type="button"
    class="pin"
    class:always={always || pinned || full}
    data-ui="pin-goal"
    data-entity="{kind}:{id}"
    data-pinned={pinned}
    aria-label={label}
    title={label}
    disabled={full}
    onclick={toggle}
  >
    <Icon name="lucide:pin" size={16} />
  </button>
{/if}

<style>
  .pin {
    --_opacity: 0;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: var(--control-xs);
    min-height: var(--control-xs);
    padding: 0;
    border: var(--border-thin) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg-dim);
    opacity: var(--_opacity);
    cursor: pointer;
  }

  /* A locked tile always shows its pin; an unlocked one shows it on hover and on focus. */
  .pin.always,
  .pin:focus-visible,
  :global([data-ui='action-tile']:hover) .pin,
  :global([data-ui='mission-card']:hover) .pin,
  :global([data-obstacle]:hover) .pin,
  :global([data-practice]:hover) .pin {
    --_opacity: 1;
  }

  /* On a touch screen there is no hover: the pin is always there, but quiet. */
  @media (hover: none) {
    .pin {
      --_opacity: 0.6;
    }

    .pin.always,
    .pin:focus-visible {
      --_opacity: 1;
    }
  }

  .pin:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .pin[data-pinned='true'] {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--ink-900);
  }

  .text {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-md);
    padding: var(--space-2) var(--space-4);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .text[data-pinned='true'] {
    background: var(--accent);
    color: var(--ink-900);
  }

  .pin:disabled,
  .text:disabled,
  .link:disabled {
    cursor: not-allowed;
  }

  .link {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--text-xs);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
