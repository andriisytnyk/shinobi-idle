<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { revealHintKey, revealLevel } from '../lib/reveal.ts';
  import { parseHash } from '../lib/route.ts';

  interface Props {
    /** Hash of the page where a quest step is done. */
    target: string;
  }

  let { target }: Props = $props();

  /** A place the player has not discovered gets no link: the hint says how to find it. */
  const hintKey = $derived.by(() => {
    const route = parseHash(target);
    if (route.page !== 'entity' || revealLevel(route.ref) !== 'hidden') return null;
    return revealHintKey(route.ref);
  });
</script>

{#if hintKey}
  <p class="where" data-where-hint>{t(hintKey)}</p>
{:else}
  <a class="go" href={target} data-go>{t('next.go')}</a>
{/if}

<style>
  .where {
    margin: 0;
    color: var(--fg-dim);
  }

  .go {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font-weight: 600;
    text-decoration: none;
  }
</style>
