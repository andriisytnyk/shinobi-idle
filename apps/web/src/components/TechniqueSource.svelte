<script lang="ts">
  import { game } from '../lib/store.ts';
  import { t } from '../lib/i18n.ts';
  import { formatInt } from '../lib/format.ts';
  import { techniqueRelations } from '../lib/technique-links.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** A technique learned from a scroll, a carrier or a quest (not a mentor technique). */
    id: string;
  }

  let { id }: Props = $props();

  const content = game.content;
  const tech = $derived(content.techniques.find((x) => x.id === id));
  const relations = $derived(techniqueRelations(id, content));
</script>

{#if tech && tech.src !== 'N'}
  <div class="source" data-technique-source={tech.src}>
    <p class="lack">{t('technique.notKnown')}</p>
    <p class="how">{t(`technique.src.${tech.src}`)}</p>
    <ul class="links">
      {#if relations.library}
        <li>
          <EntityLink kind="building" id={relations.library.building} />
          {t('technique.libraryLevel', { n: formatInt(relations.library.level) })}
        </li>
      {/if}
      {#each relations.carriers as carrier (carrier.id)}
        <li><EntityLink kind={carrier.kind} id={carrier.id} /></li>
      {/each}
      {#if tech.src === 'Q'}
        {#each relations.missions as mission (mission)}
          <li><EntityLink kind="mission" id={mission} /></li>
        {/each}
      {/if}
    </ul>
  </div>
{/if}

<style>
  .source p {
    margin: 0 0 var(--space-1);
    font-size: var(--text-xs);
  }

  .lack {
    font-weight: 600;
  }

  .how {
    color: var(--fg-dim);
  }

  .links {
    margin: 0;
    padding-left: var(--space-4);
    font-size: var(--text-xs);
  }
</style>
