<script lang="ts">
  import { listSkillActions } from '@shinobi/core';
  import ActionTile from '../components/ActionTile.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import JournalTabs from '../components/JournalTabs.svelte';
  import MissionCard from '../components/MissionCard.svelte';
  import MissionRankStamp from '../components/MissionRankStamp.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import Slot from '../lib/ext/Slot.svelte';
  import { t } from '../lib/i18n.ts';
  import { missionRankDesc, missionRankName, skillByActivity } from '../lib/vocab.ts';
  import { availableOf, followCommands, gatesOf, viewOf } from '../lib/mission-feed.svelte.ts';
  import {
    isMissionSort,
    MISSION_SORTS,
    rankGroups,
    sortMissions,
    type MissionSort,
  } from '../lib/missions.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  const ONLY_KEY = 'core:missions.onlyAvailable';
  const SORT_KEY = 'core:missions.sort';
  const TAB_KEY = 'core:missions.tab';

  type Tab = 'board' | 'fieldwork';
  const tab = $derived<Tab>(settings.ext(TAB_KEY) === 'fieldwork' ? 'fieldwork' : 'board');
  const TABS: readonly Tab[] = ['board', 'fieldwork'];

  const content = game.content;
  /** The work that found points open (a ruin search, a deposit): locked with what it asks for until the point is found. */
  const works = $derived(
    game.read((gs) => {
      const scout = skillByActivity(content, 'map');
      return scout
        ? listSkillActions(gs, scout, content, game.rules).filter((a) => a.kind === 'fieldwork')
        : [];
    }),
  );

  // What a command changed shows at once, not at the next coarse step.
  $effect(() => followCommands());

  const onlyAvailable = $derived(settings.ext(ONLY_KEY) === true);
  const sort = $derived.by((): MissionSort => {
    const stored = settings.ext(SORT_KEY);
    return isMissionSort(stored) ? stored : 'rank';
  });

  const groups = $derived(rankGroups(game.content));
  /** What each rank asks to open, evaluated at the coarse rate like the forecasts. */
  const gates = $derived(gatesOf());

  /** The missions of every rank as shown: filtered to the ones that can be started or are running, and sorted. */
  const shown = $derived(
    groups.map((g) => ({
      rank: g.rank,
      missions: sortMissions(onlyAvailable ? availableOf(g.missions) : g.missions, sort, (m) => {
        const f = viewOf(m).forecast;
        return { duration: f.expectedMs, ryoPerHour: f.ryoPerHour };
      }),
    })),
  );

  const gateOf = (rank: string) => gates.find((g) => g.rank === rank);
</script>

<SimplePage title={t('missions.title')}>
  <JournalTabs current="missions" />
  <Hint id="missions" />
  <Slot name="missions.header" />

  <div class="tabs" role="tablist" aria-label={t('missions.tabs')} data-missions-tabs>
    {#each TABS as which (which)}
      <button
        type="button"
        role="tab"
        class:active={tab === which}
        aria-selected={tab === which}
        data-tab={which}
        onclick={() => settings.setExt(TAB_KEY, which)}>{t(`missions.tab.${which}`)}</button
      >
    {/each}
  </div>

  {#if tab === 'fieldwork'}
    <section class="works" data-fieldwork-tab data-ui="entity-section">
      <p class="ct-note">{t('missions.fieldworkIntro')}</p>
      {#if works.length === 0}
        <p class="ct-note" data-empty>{t('missions.fieldworkEmpty')}</p>
      {:else}
        <ul class="tiles">
          {#each works as info (info.kind + info.id)}
            <ActionTile {info} />
          {/each}
        </ul>
      {/if}
    </section>
  {:else}
    <div class="bar" data-missions-bar>
      <label class="check">
        <input
          type="checkbox"
          data-only-available
          checked={onlyAvailable}
          onchange={(e) => settings.setExt(ONLY_KEY, e.currentTarget.checked)}
        />
        {t('missions.onlyAvailable')}
      </label>
      <label class="sort">
        <span>{t('missions.sort')}</span>
        <select
          data-sort
          value={sort}
          onchange={(e) => settings.setExt(SORT_KEY, e.currentTarget.value)}
        >
          {#each MISSION_SORTS as option (option)}
            <option value={option}>{t(`missions.sort.${option}`)}</option>
          {/each}
        </select>
      </label>
    </div>

    {#each shown as group (group.rank)}
      {@const gate = gateOf(group.rank)}
      {@const open = gate?.open ?? true}
      {@const rankDesc = missionRankDesc(group.rank)}
      <section class="group" data-rank={group.rank} data-open={open}>
        <header class="group-head">
          <MissionRankStamp rank={group.rank} />
          <div class="titles">
            <h2>
              {missionRankName(group.rank)}
            </h2>
            {#if rankDesc}<p class="ct-note">{rankDesc}</p>{/if}
          </div>
        </header>
        {#if !open && gate?.result}
          <div class="gate" data-rank-gate>
            <p class="ct-locked">
              <Icon name="lucide:lock" size={14} />
              {t('missions.rankClosed')}
            </p>
            <ReqTree node={gate.result} />
          </div>
        {/if}
        {#if group.missions.length === 0}
          <p class="ct-note" data-empty>{t('missions.groupEmpty')}</p>
        {:else}
          <ul class="ct-tiles">
            {#each group.missions as mission (mission.id)}
              <MissionCard {mission} />
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  {/if}
</SimplePage>

<style>
  .tabs {
    display: flex;
    gap: var(--space-2);
    margin: var(--space-2) 0 var(--space-3);
  }

  .tabs button {
    flex: 1;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .tabs button.active {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--tile-min)), 1fr));
    gap: var(--space-3);
    margin: var(--space-3) 0 0;
    padding: 0;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    margin: var(--space-2) 0 var(--space-3);
  }

  .check,
  .sort {
    display: inline-flex;
    flex-wrap: wrap;
    max-width: 100%;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-md);
  }

  select {
    max-width: 100%;
    min-height: var(--control-sm);
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-5);
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .titles {
    min-width: 0;
  }

  h2 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: 400;
  }

  .titles p {
    margin: 0;
  }

  .gate {
    padding: var(--space-3);
    border: var(--border-thin) dashed var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
</style>
