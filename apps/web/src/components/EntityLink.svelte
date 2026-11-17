<script lang="ts">
  import { tryActiveContent } from '../lib/active.ts';
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { markShown, MASK, revealHintKey, revealLevel } from '../lib/reveal.ts';
  import { hrefFor, isEntityKind, type EntityKind } from '../lib/route.ts';

  interface Props {
    kind: EntityKind;
    id: string;
    /** The place that prints this link offers the entity to the player (a shop row, a recipe, a reward): the core may then record it as seen. */
    offered?: boolean;
  }

  let { kind, id, offered = false }: Props = $props();

  const level = $derived(revealLevel({ kind, id }));
  /** A name with no page of its own (a pack action kind such as an operation) is plain text; with no game running every link stays a link. */
  const linkable = $derived(tryActiveContent() === null || isEntityKind(kind));

  /** Runs again when the level changes: a link the place offers tells the core while it is not yet shown in full. */
  const offer = (): void => {
    if (offered && level !== 'full') markShown([{ kind, id }]);
  };
</script>

{#if level === 'hidden'}{@const hint = revealHintKey({ kind, id })}<span
    class="entity-link masked"
    data-masked
    title={hint ? t(hint) : undefined}
    {@attach offer}>{MASK}</span
  >{:else if !linkable}<span class="entity-link">{entityName({ kind, id })}</span>{:else}<a
    class="entity-link"
    href={hrefFor({ kind, id })}
    {@attach offer}>{entityName({ kind, id })}</a
  >{/if}

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
