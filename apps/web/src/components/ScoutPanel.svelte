<script lang="ts">
  import type { SkillId } from '@shinobi/content';
  import {
    exploreIntervalMs,
    listSkillActions,
    mapMastery,
    rangeNow,
    stepTimeHere,
  } from '@shinobi/core';
  import { actionRef } from '../lib/entities.ts';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { skillProgress } from '../lib/progress.ts';
  import { currencyOf, held } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import ActionTile from './ActionTile.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import ModLine from './ModLine.svelte';

  const content = game.content;

  interface Props {
    /** The skill whose page shows the panel. */
    skill: string;
  }

  let { skill }: Props = $props();
  /** The currency exploring pays: the one with the role study. */
  const study = currencyOf(content, 'study') ?? '';

  /** The Scouting page: its currency, what it is doing now, the time of an exploration and a way to the map. */
  const data = $derived(
    game.read((gs) => {
      const action =
        gs.slots.find(
          (s) =>
            s.action?.kind === 'explore' ||
            s.action?.kind === 'walk' ||
            s.action?.kind === 'autosurvey',
        )?.action ?? null;
      return {
        xp: gs.skills[skill as SkillId]?.xp ?? 0,
        fraction: skillProgress(gs, skill as SkillId).fraction,
        intel: held(gs, study),
        action,
        exploreMs: exploreIntervalMs(gs, content, game.rules),
        range: rangeNow(gs, content),
        stepMs: stepTimeHere(gs, content, game.rules),
        mastery: mapMastery(gs, content),
      };
    }),
  );
  const current = $derived(data.action);
  /** The work that found points open (a ruin search, a deposit): locked with what it asks for until the point is found. */
  const works = $derived(game.read((gs) => listSkillActions(gs, skill, content, game.rules)));
</script>

<section class="explore-panel" data-scout-panel>
  <p class="intro">{t('scout.intro')}</p>
  <dl class="facts">
    <div>
      <dt><Icon entity={{ kind: 'currency', id: study }} size={16} /> {t('scout.intel')}</dt>
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
      <dd><ModBreakdown keys={['interval.walk']} display={formatDuration(data.stepMs)} /></dd>
    </div>
    <div>
      <dt>{t('scout.range')}</dt>
      <dd data-scout-range>{t('scout.rangeValue', { n: data.range })}</dd>
    </div>
    <div>
      <dt>{t('scout.current')}</dt>
      <dd data-scout-current>
        {#if current}
          {@const ref = actionRef(current, game.state)}
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
  <section class="mastery" data-ui="map-mastery" data-map-mastery>
    <h3>{t('map.mastery.title')}</h3>
    <p class="small">
      {t('map.mastery.progress', { n: data.mastery.count, total: data.mastery.total })}
    </p>
    <ul class="tiers">
      {#each data.mastery.tiers as tier, i (i)}
        <li class="tier" class:reached={tier.reached} data-tier-reached={tier.reached}>
          <Icon name={tier.reached ? 'lucide:check' : 'lucide:minus'} size={14} />
          <span
            >{tier.need === data.mastery.total
              ? t('map.mastery.tierAll')
              : t('map.mastery.tier', { n: tier.need })}
            {#each tier.mods as m, j (j)}{j > 0 ? ', ' : ''}<ModLine mod={m} />{/each}</span
          >
        </li>
      {/each}
    </ul>
  </section>
  {#if works.length > 0}
    <section class="works" data-scout-works data-ui="entity-section">
      <h3>{t('scout.works')}</h3>
      <p class="small dim">{t('scout.worksIntro')}</p>
      <ul class="tiles">
        {#each works as info (info.kind + info.id)}
          <ActionTile {info} />
        {/each}
      </ul>
    </section>
  {/if}
  <p class="small dim">{t('scout.intelHint')}</p>
  <a class="open" href="#/world" data-open-world
    ><Icon name="lucide:map" size={18} /> {t('scout.open')}</a
  >
</section>

<style>
  .explore-panel {
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
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
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
    font-size: var(--text-xs);
  }

  .mastery {
    margin: 0 0 var(--space-3);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .mastery h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .tiers {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tier {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .tier.reached {
    color: var(--fg);
  }

  .works h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--tile-min)), 1fr));
    gap: var(--space-3);
    margin: 0 0 var(--space-3);
    padding: 0;
  }

  .open {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
  }
</style>
