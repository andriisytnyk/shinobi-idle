<script lang="ts">
  import { hintTextKey, hintTitleKey } from '../lib/hints.ts';
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
</script>

{#if settings.hintVisible(id)}
  <aside class="hint" data-hint={id}>
    <span class="mark"><Icon name="lucide:info" size={18} /></span>
    <div class="body">
      <p class="title">{t(hintTitleKey(id))}</p>
      <p>{t(text)}</p>
    </div>
    <button type="button" onclick={() => settings.dismissHint(id)}>{t('hint.dismiss')}</button>
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

  .mark {
    display: inline-flex;
    padding-top: 2px;
    color: var(--chakra);
  }

  .body {
    flex: 1 1 12rem;
    min-width: 0;
  }

  p {
    margin: 0;
  }

  .title {
    color: var(--heading);
    font-weight: 600;
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
