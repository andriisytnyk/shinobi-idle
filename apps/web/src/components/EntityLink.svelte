<script lang="ts">
  import { entityName } from '../lib/entities.ts';
  import { hrefFor, type EntityKind } from '../lib/route.ts';

  interface Props {
    kind: EntityKind;
    id: string;
  }

  let { kind, id }: Props = $props();

  const ref = $derived({ kind, id });
</script>

<a class="entity-link" href={hrefFor(ref)}>{entityName(ref)}</a>

<style>
  .entity-link {
    color: inherit;
    text-decoration: none;
  }

  /* A whole-tap target on a phone: padding grows the hit area, the text stays the same size. */
  @media (max-width: 768px) {
    .entity-link {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-size);
    }
  }

  .entity-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
</style>
