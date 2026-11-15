<script lang="ts">
  import NextStepCard from '../components/NextStepCard.svelte';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';
</script>

<SimplePage title={t('home.title')}>
  <p class="hello">{t('welcome.hello', { name: game.state.player.name })}</p>
  <NextStepCard />
  <p class="hint">{t('home.hint')}</p>
</SimplePage>

<style>
  .hello {
    margin: 0 0 var(--space-3);
    font-weight: 600;
  }

  .hint {
    color: var(--fg-dim);
  }
</style>
