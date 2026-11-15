<script lang="ts">
  import NextStepCard from '../components/NextStepCard.svelte';
  import SkillList from '../components/SkillList.svelte';
  import { t } from '../lib/i18n.ts';
  import SimplePage from './SimplePage.svelte';
</script>

<SimplePage title={t('nav.skills')}>
  <div class="mobile-skills"><NextStepCard /><SkillList /></div>
  <p class="hint desktop-only">{t('home.hint')}</p>
</SimplePage>

<style>
  .hint {
    color: var(--fg-dim);
  }

  .mobile-skills {
    display: none;
  }

  @media (max-width: 768px) {
    .mobile-skills {
      display: block;
    }

    .desktop-only {
      display: none;
    }
  }
</style>
