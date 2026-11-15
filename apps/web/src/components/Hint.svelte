<script lang="ts">
  import { untrack } from 'svelte';
  import { hintTextKey, hintTitleKey } from '../lib/hints.ts';
  import { hintSlot } from '../lib/hint-slot.svelte.ts';
  import { t } from '../lib/i18n.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import Icon from './Icon.svelte';

  interface Props {
    /** Stable id from the hint registry; once dismissed the hint never comes back (unless reset). */
    id: string;
    /** Localization key of the text; by default `hint.<id>`. */
    text?: string;
  }

  let { id, text = hintTextKey(id) }: Props = $props();

  const visible = $derived(settings.hintVisible(id));
  /** On a phone a hint is one line until the player asks for the rest. */
  let expanded = $state(
    typeof window === 'undefined' || !window.matchMedia('(max-width: 768px)').matches,
  );

  // Only one hint shows at a time; a second one waits for the slot.
  $effect(() => {
    if (!visible) return;
    untrack(() => hintSlot.claim(id));
    return () => untrack(() => hintSlot.release(id));
  });
  // A hint that waited takes the slot as soon as it is free.
  $effect(() => {
    if (visible && hintSlot.current === null) untrack(() => hintSlot.claim(id));
  });

  const shown = $derived(visible && (hintSlot.current === null || hintSlot.current === id));
</script>

{#if shown}
  <aside class="hint" class:collapsed={!expanded} data-hint={id}>
    <span class="mark"><Icon name="lucide:info" size={18} /></span>
    <div class="body">
      <p class="title">{t(hintTitleKey(id))}</p>
      <p class="text" hidden={!expanded}>{t(text)}</p>
    </div>
    <div class="buttons">
      <button
        type="button"
        class="more"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        {expanded ? t('hint.less') : t('hint.more')}
      </button>
      <button type="button" onclick={() => settings.dismissHint(id)}>{t('hint.dismiss')}</button>
    </div>
  </aside>
{/if}

<style>
  .hint {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--chakra);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .hint.collapsed {
    align-items: center;
    flex-wrap: nowrap;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
  }

  .mark {
    display: inline-flex;
    padding-top: 2px;
    color: var(--chakra);
  }

  .body {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .collapsed .body {
    flex: 1 1 0;
    overflow: hidden;
  }

  .collapsed .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    margin: 0;
  }

  .title {
    color: var(--heading);
    font-weight: 600;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .collapsed .buttons {
    flex: none;
    flex-wrap: nowrap;
  }

  button {
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  /* On a phone the collapsed line keeps only a short "more" and the dismiss mark. */
  @media (max-width: 768px) {
    .collapsed button {
      padding-inline: var(--space-2);
      font-size: 0.8rem;
    }
  }
</style>
