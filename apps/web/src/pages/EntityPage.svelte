<script lang="ts">
  import { entityDesc, entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import type { EntityRef } from '../lib/route.ts';

  interface Props {
    entity: EntityRef;
  }

  let { entity }: Props = $props();

  const desc = $derived(entityDesc(entity));
</script>

<article class="entity-page">
  <p class="kind">{t(`entity.kind.${entity.kind}`)}</p>
  <h1>{entityName(entity)}</h1>
  {#if desc}<p>{desc}</p>{/if}
  <p class="placeholder">{t('entity.placeholder')}</p>
</article>

<style>
  .kind {
    margin: 0;
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  h1 {
    margin: var(--space-1) 0 var(--space-3);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.6rem;
    font-weight: 400;
  }

  .placeholder {
    color: var(--fg-dim);
  }
</style>
