<script lang="ts">
  import { content, ICON_KINDS, type IconKind } from '@shinobi/content';
  import Icon from '../components/Icon.svelte';
  import ZoneWhere from '../components/ZoneWhere.svelte';
  import { entityDesc, entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import type { EntityRef } from '../lib/route.ts';

  interface Props {
    entity: EntityRef;
  }

  let { entity }: Props = $props();

  const desc = $derived(entityDesc(entity));
  /** The fight zones where an enemy is met, each tied to a map cell. */
  const zones = $derived(
    entity.kind === 'enemy' ? content.zones.filter((z) => z.enemy === entity.id) : [],
  );
  /** Only kinds in the icon registry have an icon; the rest show the name alone. */
  const iconKind = $derived(
    (ICON_KINDS as readonly string[]).includes(entity.kind) ? (entity.kind as IconKind) : null,
  );
</script>

<article class="entity-page" data-entity={entity.id}>
  <p class="kind">{t(`entity.kind.${entity.kind}`)}</p>
  <h1>
    {#if iconKind}<Icon entity={{ kind: iconKind, id: entity.id }} size={32} />{/if}
    {entityName(entity)}
  </h1>
  {#if desc}<p>{desc}</p>{:else}<p class="placeholder">{t('entity.placeholder')}</p>{/if}
  {#if zones.length > 0}
    <section class="where" data-enemy-zones>
      <h2>{t('world.where.title')}</h2>
      {#each zones as zone (zone.id)}<ZoneWhere zone={zone.id} />{/each}
    </section>
  {/if}
</article>

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

  .placeholder {
    color: var(--fg-dim);
  }
</style>
