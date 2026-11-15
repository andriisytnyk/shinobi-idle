<script lang="ts">
  import { content } from '@shinobi/content';
  import { exploreIntervalMs, walkMs } from '@shinobi/core';
  import { actionRef } from '../lib/entities.ts';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { skillProgress } from '../lib/progress.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';

  /** The Scouting page: its currency, what it is doing now, the time of an exploration and a way to the map. */
  const data = $derived(
    game.read((gs) => {
      const action =
        gs.slots.find((s) => s.action?.kind === 'explore' || s.action?.kind === 'walk')?.action ??
        null;
      // A cell in the region the player stands in, and one in another region: the two lengths of a walk.
      const here = content.cells.find((c) => c.id === gs.world.location)?.region;
      const first = content.cells.find((c) => c.region === here) ?? content.cells[0];
      const other = content.cells.find((c) => c.region !== here);
      return {
        xp: gs.skills.scout.xp,
        fraction: skillProgress(gs, 'scout').fraction,
        intel: gs.currencies.intel,
        action,
        exploreMs: exploreIntervalMs(gs, content, game.rules),
        walkMs: first ? walkMs(gs, first, content, game.rules) : 0,
        walkBetweenMs: other ? walkMs(gs, other, content, game.rules) : 0,
      };
    }),
  );
  const current = $derived(data.action);
</script>

<section class="scout" data-scout-panel>
  <p class="intro">{t('scout.intro')}</p>
  <dl class="facts">
    <div>
      <dt><Icon entity={{ kind: 'currency', id: 'intel' }} size={16} /> {t('scout.intel')}</dt>
      <dd data-intel>{formatInt(data.intel)}</dd>
    </div>
    <div>
      <dt>{t('scout.xp')}</dt>
      <dd>{formatInt(Math.floor(data.xp))} · {Math.round(data.fraction * 100)}%</dd>
    </div>
    <div>
      <dt>{t('scout.time')}</dt>
      <dd><ModBreakdown keys={['interval.explore']} display={formatDuration(data.exploreMs)} /></dd>
    </div>
    <div>
      <dt>{t('scout.walk')}</dt>
      <dd><ModBreakdown keys={['interval.walk']} display={formatDuration(data.walkMs)} /></dd>
    </div>
    <div>
      <dt>{t('scout.walkBetween')}</dt>
      <dd>
        <ModBreakdown keys={['interval.walk']} display={formatDuration(data.walkBetweenMs)} />
      </dd>
    </div>
    <div>
      <dt>{t('scout.current')}</dt>
      <dd data-scout-current>
        {#if current}
          {@const ref = actionRef(current)}
          <span class="verb"
            >{t(current.kind === 'walk' ? 'world.walking' : 'world.exploring')}</span
          >
          <EntityLink kind={ref.kind} id={ref.id} />
        {:else}
          <span class="dim">{t('scout.idle')}</span>
        {/if}
      </dd>
    </div>
  </dl>
  <p class="small dim">{t('scout.intelHint')}</p>
  <a class="open" href="#/world" data-open-world
    ><Icon name="lucide:map" size={18} /> {t('scout.open')}</a
  >
</section>

<style>
  .scout {
    margin: var(--space-3) 0;
  }

  .intro {
    margin: 0 0 var(--space-3);
  }

  .facts {
    display: grid;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .facts div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-3);
  }

  dt {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--fg-dim);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .verb,
  .dim {
    color: var(--fg-dim);
  }

  .small {
    margin: 0 0 var(--space-3);
    font-size: 0.85rem;
  }

  .open {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
  }
</style>
