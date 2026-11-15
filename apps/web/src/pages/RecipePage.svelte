<script lang="ts">
  import { content } from '@shinobi/content';
  import { actionInfo } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import RecipeTile from '../components/RecipeTile.svelte';
  import { entityDesc, entityName, isEntityKind } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { itemRelations, type ItemRelation } from '../lib/item-links.ts';
  import { game } from '../lib/store.ts';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const recipe = $derived(content.recipes.find((r) => r.id === id));
  const ref = $derived({ kind: 'recipe', id } as const);
  const desc = $derived(entityDesc(ref));
  const info = $derived(
    game.read((gs) => (recipe ? actionInfo(gs, { kind: 'craft', id }, content, game.rules) : null)),
  );
  const usedIn = $derived(recipe ? itemRelations(recipe.output.item, content).usedIn : []);
</script>

{#snippet line(rel: ItemRelation)}
  <li>
    {#if rel.ref && isEntityKind(rel.ref.kind)}
      <EntityLink kind={rel.ref.kind} id={rel.ref.id} />
    {:else if rel.textKey}
      {t(rel.textKey)}
    {/if}
    {#if rel.n && rel.n > 1}<span class="n">&times;{rel.n}</span>{/if}
  </li>
{/snippet}

{#if recipe && info}
  <article
    class="recipe-page"
    data-recipe-page={id}
    data-ui="entity-page"
    data-entity="recipe:{id}"
  >
    <Hint id="crafting" />
    <p class="kind">
      {t('entity.kind.recipe')} · <EntityLink kind="skill" id={recipe.skill} />
    </p>
    <h1 data-ui="entity-header">{entityName(ref)}</h1>
    {#if desc}<p>{desc}</p>{/if}

    <ul class="ct-tiles single"><RecipeTile {info} /></ul>

    <section data-ui="entity-section">
      <h2>{t('item.usedIn')}</h2>
      {#if usedIn.length > 0}
        <ul>
          {#each usedIn as rel, i (i)}{@render line(rel)}{/each}
        </ul>
      {:else}
        <p class="none">{t('item.none')}</p>
      {/if}
    </section>
  </article>
{:else}
  <p>{t('route.notFound')}</p>
{/if}

<style>
  .kind {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  h1 {
    margin: var(--space-1) 0 var(--space-3);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: 400;
  }

  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .single {
    max-width: var(--measure);
  }

  ul {
    margin: 0;
    padding-left: var(--space-4);
  }

  .ct-tiles {
    padding: 0;
  }

  li {
    padding: var(--space-1) 0;
  }

  .n,
  .none {
    color: var(--fg-dim);
  }
</style>
