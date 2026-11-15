<script lang="ts">
  import type { IconKind } from '@shinobi/content';
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { revealHintKey } from '../lib/reveal.ts';
  import type { EntityRef } from '../lib/route.ts';
  import { game } from '../lib/store.ts';
  import Icon from './Icon.svelte';

  interface Props {
    entity: EntityRef;
    /** `hidden`: nothing is known (no name, no id in the page). `name`: only the name and icon may be shown. */
    level: 'hidden' | 'name';
  }

  let { entity, level }: Props = $props();

  const hint = $derived(revealHintKey(entity));
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
