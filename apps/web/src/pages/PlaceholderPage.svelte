<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import SimplePage from './SimplePage.svelte';

  interface Props {
    /** Localization key of the page title. */
    title: string;
  }

  let { title }: Props = $props();
</script>

<SimplePage title={t(title)}>
  <p class="hint">{t('entity.placeholder')}</p>
</SimplePage>

<style>
  .hint {
    color: var(--fg-dim);
  }
</style>
