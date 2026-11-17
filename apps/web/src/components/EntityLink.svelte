<script lang="ts">
  import { entityName } from '../lib/entities.ts';
  import { hexLabel } from '../lib/hex-map.ts';
  import { t } from '../lib/i18n.ts';
  import { markShown, MASK, revealHintKey, revealLevel } from '../lib/reveal.ts';
  import { hrefFor, type EntityKind } from '../lib/route.ts';
  import { game } from '../lib/store.ts';

  interface Props {
    kind: EntityKind;
    id: string;
    /** The place that prints this link offers the entity to the player (a shop row, a recipe, a reward): the core may then record it as seen. */
    offered?: boolean;
  }

  let { kind, id, offered = false }: Props = $props();

  const level = $derived(revealLevel({ kind, id }));
  /** A hex that is no cell is named by what the player knows of it. */
  const hexName = $derived(kind === 'hex' ? game.read((gs) => hexLabel(gs, game.content, id)) : '');

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
  >{:else if kind === 'hex'}<a class="entity-link" href={hrefFor({ kind, id })}>{hexName}</a
  >{:else}<a class="entity-link" href={hrefFor({ kind, id })} {@attach offer}
    >{entityName({ kind, id })}</a
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
