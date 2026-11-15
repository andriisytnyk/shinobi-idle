<script lang="ts">
  import { content } from '@shinobi/content';
  import EntityLink from '../components/EntityLink.svelte';
  import GearLine from '../components/GearLine.svelte';
  import { t } from '../lib/i18n.ts';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const line = $derived(content.gear.find((g) => g.id === id));
</script>

{#if line}
  <article class="gear-page" data-gear-page={id}>
    <p class="kind">
      {t('entity.kind.gear')} · <EntityLink kind="skill" id={line.skill} />
    </p>
    <div class="line"><GearLine {line} /></div>
  </article>
{:else}
  <p>{t('route.notFound')}</p>
{/if}

<style>
  .kind {
    margin: 0 0 var(--space-3);
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  .line {
    max-width: 26rem;
  }
</style>
