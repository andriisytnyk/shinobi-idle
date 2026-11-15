<script lang="ts">
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { markShown, MASK, revealHintKey, revealLevel } from '../lib/reveal.ts';
  import { hrefFor, type EntityKind } from '../lib/route.ts';

  interface Props {
    kind: EntityKind;
    id: string;
    /** The place that prints this link offers the entity to the player (a shop row, a recipe, a reward): the core may then record it as seen. */
    offered?: boolean;
  }

  let { kind, id, offered = false }: Props = $props();

  const ref = $derived({ kind, id });
  const level = $derived(revealLevel(ref));
  const hint = $derived(level === 'hidden' ? revealHintKey(ref) : null);

  $effect(() => {
    if (offered && level !== 'full') markShown([ref]);
  });
</script>

{#if level === 'hidden'}
  <span class="entity-link masked" data-masked title={hint ? t(hint) : undefined}>{MASK}</span>
{:else}
  <a class="entity-link" href={hrefFor(ref)}>{entityName(ref)}</a>
{/if}

<style>
  .entity-link {
    color: inherit;
    text-decoration: none;
  }

  .masked {
    color: var(--fg-dim);
    cursor: help;
  }

  /* A whole-tap target on a phone: padding grows the hit area, the text stays the same size. */
  @media (max-width: 768px) {
    .entity-link {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-md);
    }
  }

  a.entity-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
</style>
