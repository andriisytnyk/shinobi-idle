<script lang="ts">
  import { game } from '../lib/store.ts';
  import { evalReq } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Icon from '../components/Icon.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import ZoneWhere from '../components/ZoneWhere.svelte';
  import { entityDesc, entityName } from '../lib/entities.ts';
  import { entityRefsIn, findEntity, reqOf } from '../lib/entity-data.ts';
  import { t } from '../lib/i18n.ts';
  import type { EntityRef } from '../lib/route.ts';

  const content = game.content;

  interface Props {
    entity: EntityRef;
  }

  let { entity }: Props = $props();

  const desc = $derived(entityDesc(entity));
  /** The fight zones where an enemy is met, each tied to a map cell. */
  const zones = $derived(
    entity.kind === 'enemy' ? content.zones.filter((z) => z.enemy === entity.id) : [],
  );
  /** Only kinds in the icon tables have an icon; the rest show the name alone. */
  const hasIcon = $derived(Object.hasOwn(content.icons, entity.kind));
  /** The entity as the content has it; an id that names nothing shows the «not found» state. */
  const data = $derived(findEntity(content, entity));
  const reqTree = $derived(
    game.read((gs) => {
      const req = data ? reqOf(data) : null;
      return req ? evalReq(gs, req, content) : null;
    }),
  );
  /** The entities the data names: its links to other pages. */
  const links = $derived(data ? entityRefsIn(data, content, entity) : []);
</script>

{#if !data}
  <article
    class="entity-page"
    data-ui="entity-page"
    data-entity="{entity.kind}:{entity.id}"
    data-not-found
  >
    <p class="kind">{t(`entity.kind.${entity.kind}`)}</p>
    <p>{t('entity.notFound')}</p>
  </article>
{:else}
  <article class="entity-page" data-ui="entity-page" data-entity="{entity.kind}:{entity.id}">
    <p class="kind">{t(`entity.kind.${entity.kind}`)}</p>
    <h1 data-ui="entity-header">
      {#if hasIcon}<Icon entity={{ kind: entity.kind, id: entity.id }} size={32} />{/if}
      {entityName(entity)}
    </h1>
    {#if desc}<p>{desc}</p>{:else}<p class="placeholder">{t('entity.placeholder')}</p>{/if}
    {#if zones.length > 0}
      <section class="where" data-enemy-zones data-ui="entity-section">
        <h2>{t('world.where.title')}</h2>
        {#each zones as zone (zone.id)}<ZoneWhere zone={zone.id} />{/each}
      </section>
    {/if}
    {#if reqTree}
      <section data-entity-req data-ui="entity-section">
        <h2>{t('entity.requirements')}</h2>
        <ReqTree node={reqTree} />
      </section>
    {/if}
    {#if links.length > 0}
      <section data-entity-links data-ui="entity-section">
        <h2>{t('entity.links')}</h2>
        <ul class="links">
          {#each links as link (link.kind + link.id)}
            <li><EntityLink kind={link.kind} id={link.id} /></li>
          {/each}
        </ul>
      </section>
    {/if}
  </article>
{/if}

<style>
  .kind {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  h1 {
    display: flex;
    align-items: center;
    gap: var(--space-3);
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

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .placeholder {
    color: var(--fg-dim);
  }
</style>
