<script lang="ts">
  import type { Poi } from '@shinobi/content';
  import { t } from '../../lib/i18n.ts';
  import EntityLink from '../EntityLink.svelte';

  interface Props {
    poi: Poi;
    cell?: string;
  }

  let { poi }: Props = $props();

  /** The entity a point of interest of the kind leads to, if the kind has one. */
  const target = $derived(
    poi.kind === 'deposit'
      ? { kind: 'building', id: poi.building }
      : poi.kind === 'mission'
        ? { kind: 'mission', id: poi.mission }
        : null,
  );
</script>

<!-- Story, outpost, deposit and mission points: one line of text, and the entity the point leads to. -->
<p class="small">
  {t(`world.poi.${poi.kind}`)}
  {#if target}<EntityLink kind={target.kind} id={target.id} />{/if}
</p>
