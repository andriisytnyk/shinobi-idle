<script lang="ts">
  import type { IconKind } from '@shinobi/content';
  import { evalReq } from '@shinobi/core';
  import { entityName } from '../lib/entities.ts';
  import { findEntity, reqOf } from '../lib/entity-data.ts';
  import { t } from '../lib/i18n.ts';
  import { revealHintKey } from '../lib/reveal.ts';
  import type { EntityRef } from '../lib/route.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    entity: EntityRef;
    /** `hidden`: nothing is known (no name, no id in the page). `name`: only the name and icon may be shown. */
    level: 'hidden' | 'name';
  }

  let { entity, level }: Props = $props();

  const hint = $derived(revealHintKey(entity));
  /** What opens the entity is not a secret (the board and the lists show it): a name-only page still says it. */
  const gate = $derived(
    game.read((gs) => {
      const data = findEntity(game.content, entity);
      const req = data ? reqOf(data) : null;
      return req ? evalReq(gs, req, game.content) : null;
    }),
  );
  const hasIcon = $derived(Object.hasOwn(game.content.icons, entity.kind));
</script>

{#if level === 'hidden'}
  <article class="gate" data-ui="entity-page" data-not-revealed>
    <h1 data-ui="entity-header">{t('reveal.hidden.title')}</h1>
    <p>{t('reveal.hidden.body')}</p>
    {#if hint}<p class="hint" data-reveal-hint>{t('reveal.howTo')} {t(hint)}.</p>{/if}
  </article>
{:else}
  <article
    class="gate"
    data-ui="entity-page"
    data-entity="{entity.kind}:{entity.id}"
    data-name-only
  >
    <p class="kind">{t(`entity.kind.${entity.kind}`)}</p>
    <h1 data-ui="entity-header">
      {#if hasIcon}<Icon entity={{ kind: entity.kind as IconKind, id: entity.id }} size={32} />{/if}
      {entityName(entity)}
    </h1>
    <p>{t('reveal.name.body')}</p>
    {#if gate}
      <section data-entity-req data-ui="entity-section">
        <h2>{t('entity.requirements')}</h2>
        <ReqTree node={gate} />
      </section>
    {/if}
    {#if hint}<p class="hint" data-reveal-hint>{t('reveal.howTo')} {t(hint)}.</p>{/if}
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

  .hint {
    color: var(--fg-dim);
  }
</style>
