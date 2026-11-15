<script lang="ts">
  import { content } from '@shinobi/content';
  import EntityLink from '../components/EntityLink.svelte';
  import Icon from '../components/Icon.svelte';
  import { entityDesc, entityName, isEntityKind } from '../lib/entities.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { itemRelations, type ItemRelation } from '../lib/item-links.ts';
  import { game } from '../lib/store.ts';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const item = $derived(content.items.find((i) => i.id === id));
  const ref = $derived({ kind: 'item', id } as const);
  const desc = $derived(entityDesc(ref));
  const relations = $derived(itemRelations(id, content));
  const owned = $derived(game.read((gs) => gs.bank[id] ?? 0));
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

{#if item}
  <article class="item-page" data-item={id}>
    <p class="kind">{t('entity.kind.item')} · {t(`item.kind.${item.kind}`)}</p>
    <h1><Icon entity={ref} size={32} /> {entityName(ref)}</h1>
    {#if desc}<p>{desc}</p>{/if}
    <p class="owned">{t('item.owned', { n: formatInt(owned) })}</p>

    <section>
      <h2>{t('item.sources')}</h2>
      {#if relations.sources.length > 0}
        <ul>
          {#each relations.sources as rel, i (i)}{@render line(rel)}{/each}
        </ul>
      {:else}
        <p class="none">{t('item.none')}</p>
      {/if}
    </section>

    <section>
      <h2>{t('item.usedIn')}</h2>
      {#if relations.usedIn.length > 0}
        <ul>
          {#each relations.usedIn as rel, i (i)}{@render line(rel)}{/each}
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
    font-size: 0.85rem;
  }

  h1 {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-1) 0 var(--space-3);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.6rem;
    font-weight: 400;
  }

  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.1rem;
    font-weight: 400;
  }

  ul {
    margin: 0;
    padding-left: var(--space-4);
  }

  li {
    padding: var(--space-1) 0;
  }

  .n,
  .none,
  .owned {
    color: var(--fg-dim);
  }
</style>
