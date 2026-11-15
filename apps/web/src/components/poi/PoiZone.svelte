<script lang="ts">
  import type { Poi } from '@shinobi/content';
  import { zoneAvailable } from '@shinobi/core';
  import { t } from '../../lib/i18n.ts';
  import { game } from '../../lib/store.ts';
  import { zoneOf } from '../../lib/world.ts';
  import EntityLink from '../EntityLink.svelte';

  const content = game.content;

  interface Props {
    poi: Extract<Poi, { kind: 'zone' }>;
    cell?: string;
  }

  let { poi }: Props = $props();

  const zone = $derived(zoneOf(poi));
  const available = $derived(
    game.read((gs) => (zone ? zoneAvailable(gs, zone.zone, content) : false)),
  );
</script>

{#if zone}
  <p class="small">
    {t('world.poi.zoneEnemy')}
    <EntityLink kind="enemy" id={zone.enemy} />
  </p>
  <p class="small" data-zone-available={available === true}>
    {available ? t('world.where.open') : t('world.where.closed')}
    <a class="go" href="#/combat">{t('nav.combat')}</a>
  </p>
{/if}
