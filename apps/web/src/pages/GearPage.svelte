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
  <article class="gear-page" data-gear-page={id} data-ui="entity-page" data-entity="gear:{id}">
    <p class="kind" data-ui="entity-header">
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
    font-size: var(--font-size-0-85);
  }

  .line {
    max-width: var(--size-26);
  }
</style>
