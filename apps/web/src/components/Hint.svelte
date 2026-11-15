<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import Icon from './Icon.svelte';

  interface Props {
    /** Stable id; once dismissed the hint never comes back (unless the player resets hints). */
    id: string;
    /** Localization key of the hint text. */
    text: string;
  }

  let { id, text }: Props = $props();
</script>

{#if settings.hintVisible(id)}
  <aside class="hint" data-hint={id}>
    <span class="mark"><Icon name="lucide:info" size={18} /></span>
    <p>{t(text)}</p>
    <button type="button" onclick={() => settings.dismissHint(id)}>{t('hint.dismiss')}</button>
  </aside>
{/if}

<style>
  .hint {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--chakra);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .mark {
    display: inline-flex;
    padding-top: 2px;
    color: var(--chakra);
  }

  p {
    flex: 1;
    margin: 0;
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
</style>
