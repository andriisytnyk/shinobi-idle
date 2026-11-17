<script lang="ts">
  import { actionInfo } from '@shinobi/core';
  import ActionEmblem from '../components/ActionEmblem.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import IngredientRow from '../components/IngredientRow.svelte';
  import PinGoal from '../components/PinGoal.svelte';
  import { tierView } from '../lib/crafts.ts';
  import { entityDesc, entityName, isEntityKind } from '../lib/entities.ts';
  import { formatInt, formatSeconds } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { itemRelations, type ItemRelation } from '../lib/item-links.ts';
  import { idAttr } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';

  const content = game.content;

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
  const tier = $derived(game.read((gs) => tierView(gs, id, content, game.rules)));
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
    <header class="head" data-ui="entity-header">
      <ActionEmblem kind="recipe" {id} skill={info.skill} size="lg" />
      <div class="title">
        <p class="kind">
          {t('entity.kind.recipe')} · <EntityLink kind="skill" id={recipe.skill} />
        </p>
        <h1>{entityName(ref)}</h1>
      </div>
      <PinGoal kind="recipe" {id} variant="button" />
    </header>
    {#if desc}<p class="desc">{desc}</p>{/if}
    <p class="dim">{t('tile.interval')}: {formatSeconds(info.intervalMs)}</p>

    <section data-ui="entity-section">
      <h2>{t('craft.needs')}</h2>
      <ul class="list" data-inputs>
        {#each info.inputs as input (input.item)}
          <IngredientRow item={input.item} need={input.n} have={input.have} />
        {/each}
      </ul>
    </section>

    <section data-ui="entity-section">
      <h2>{t('craft.makes')}</h2>
      <ul class="list" data-outputs>
        {#each info.outputs as out (out.item)}
          <li class="output" data-output={idAttr('item', out.item)}>
            <Icon entity={{ kind: 'item', id: out.item }} size={18} />
            <span class="qty">&times;{formatInt(out.n)}</span>
            <EntityLink kind="item" id={out.item} offered />
            <span class="dim"
              >{t('craft.owned', { n: formatInt(game.read((gs) => gs.bank[out.item] ?? 0)) })}</span
            >
          </li>
        {/each}
      </ul>
      <p class="dim" data-tier>
        {t('craft.tier', {
          tier: tier.tier,
          tiers: tier.tiers,
          pct: Math.round(tier.bonusChance * 100),
        })}
        {#if tier.nextAt !== null}{t('craft.tierNext', { n: tier.nextAt })}{/if}
      </p>
    </section>

    <section data-ui="entity-section">
      <h2>{t('item.usedIn')}</h2>
      {#if usedIn.length > 0}
        <ul class="plain">
          {#each usedIn as rel, i (i)}{@render line(rel)}{/each}
        </ul>
      {:else}
        <p class="dim">{t('item.none')}</p>
      {/if}
    </section>
  </article>
{:else}
  <p>{t('route.notFound')}</p>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .title {
    flex: 1;
    min-width: 0;
  }

  .kind {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  h1 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: 400;
  }

  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .desc {
    margin: var(--space-3) 0 0;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .output {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    color: var(--steel);
  }

  .qty {
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }

  .plain {
    margin: 0;
    padding-left: var(--space-4);
  }

  li {
    padding: var(--space-1) 0;
  }

  .n,
  .dim {
    color: var(--fg-dim);
  }
</style>
