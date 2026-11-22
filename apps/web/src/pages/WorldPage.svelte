<script lang="ts">
  import MapStage from '../components/MapStage.svelte';
  import { t } from '../lib/i18n.ts';
  import SimplePage from './SimplePage.svelte';

  interface Props {
    /** What the route asks the map to show: a cell with its panel, or a region. */
    focus?: { cell: string | null; region: string | null };
  }

  let { focus = { cell: null, region: null } }: Props = $props();
</script>

<SimplePage title={t('world.title')} compact>
  <MapStage {focus} hint="world" />
</SimplePage>
