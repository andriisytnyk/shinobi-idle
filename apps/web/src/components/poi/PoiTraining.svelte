<script lang="ts">
  import type { Poi } from '@shinobi/content';
  import { cellInfo } from '@shinobi/core';
  import { t } from '../../lib/i18n.ts';
  import { game } from '../../lib/store.ts';
  import EntityLink from '../EntityLink.svelte';

  const content = game.content;

  interface Props {
    poi: Extract<Poi, { kind: 'training' }>;
    cell: string;
  }

  let { poi, cell }: Props = $props();

  const located = $derived(
    game.read((gs) => cellInfo(gs, cell, content, game.rules)?.located ?? false),
  );
</script>

<p class="small">
  {t('world.poi.trainingBonus', { pct: Math.round(poi.bonus * 100) })}
  <EntityLink kind="skill" id={poi.skill} />
</p>
<p class="small" data-training-active={located}>
  {located ? t('world.poi.trainingOn') : t('world.poi.trainingOff')}
</p>
