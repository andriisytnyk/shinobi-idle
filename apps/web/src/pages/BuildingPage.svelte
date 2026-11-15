<script lang="ts">
  import { content } from '@shinobi/content';
  import {
    buildingEffectsAt,
    villageBuildCost,
    villageBuildings,
    type BuildingInfo,
  } from '@shinobi/core';
  import BuildingCard from '../components/BuildingCard.svelte';
  import { entityDesc } from '../lib/entities.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { effectLines, resourceName } from '../lib/village.ts';
  import SimplePage from './SimplePage.svelte';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const building = $derived(content.buildings.find((b) => b.id === id) ?? null);
  const info = $derived<BuildingInfo | null>(
    game.read((gs) => villageBuildings(gs, content).find((b) => b.id === id) ?? null),
  );
  const desc = $derived(entityDesc({ kind: 'building', id }));
  const levels = $derived(
    building && info
      ? Array.from({ length: info.maxLevel }, (_, i) => i + 1).map((level) => {
          const cost = villageBuildCost(building, level, content);
          return {
            level,
            lines: effectLines(buildingEffectsAt(building, level)),
            cost: [
              ...Object.entries(cost.res).map(([res, n]) => `${resourceName(res)} ${formatInt(n)}`),
              `${t('village.cost.treasury')} ${formatInt(cost.ryo)}`,
              ...Object.entries(cost.shinobi).map(
                ([res, n]) => `${resourceName(res)} ${formatInt(n)}`,
              ),
            ].join(', '),
          };
        })
      : [],
  );
</script>

<SimplePage title={t(`building.${id}.name`)}>
  <div class="building-page" data-building-page={id}>
    <p class="kind">{t('entity.kind.building')}</p>
    {#if desc}<p>{desc}</p>{/if}
    {#if info}
      <BuildingCard {info} page />
      <section class="ct-section" data-levels>
        <h2>{t('village.levels')}</h2>
        <ol>
          {#each levels as row (row.level)}
            <li data-level-row={row.level} class:reached={info.level >= row.level}>
              <strong>{t('village.levels.row', { n: row.level })}</strong>
              {#each row.lines as line (line)}<span>{line}</span>{/each}
              <span class="ct-muted">{row.cost}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  </div>
</SimplePage>

<style>
  .kind {
    margin: 0;
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) 0;
    border-top: 1px solid var(--line);
    color: var(--fg-dim);
  }

  li.reached {
    color: var(--fg);
  }
</style>
