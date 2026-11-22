<script lang="ts">
  import MapStage from '../components/MapStage.svelte';
  import { t } from '../lib/i18n.ts';
  import SimplePage from './SimplePage.svelte';

  interface Props {
    /** What the route asks the map to show: a cell with its panel, or a region. */
    focus?: { cell: string | null; region: string | null };
    /** «Where to look» (`#/world/look/<kind>/<id>`): the thing whose search area the map highlights. */
    look?: { kind: string; id: string } | null;
  }

  let { focus = { cell: null, region: null }, look = null }: Props = $props();
</script>

<SimplePage title={t('world.title')} compact>
  <MapStage {focus} {look} hint="world" />
</SimplePage>
