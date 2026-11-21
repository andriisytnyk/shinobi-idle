<script lang="ts">
  import { entityAttr } from '../lib/reveal.ts';
  import type { Mission } from '@shinobi/content';
  import { MISSION_KIND, NEEDS_TEAM } from '@shinobi/core';
  import { formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { cardState, cloneCardState, viewOf } from '../lib/mission-feed.svelte.ts';
  import { holderRef, missionNow, rewardRows, trainedSkills } from '../lib/missions.ts';
  import { slotTiming } from '../lib/timing.ts';
  import PerformerMarks from './PerformerMarks.svelte';
  import TimeBar from './TimeBar.svelte';
  import { game } from '../lib/store.ts';
  import BusyBy from './BusyBy.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import StartSplit from './StartSplit.svelte';
  import MissionRankStamp from './MissionRankStamp.svelte';
  import MissionReward from './MissionReward.svelte';
  import PinGoal from './PinGoal.svelte';
  import MissionTeamMark from './MissionTeamMark.svelte';
  import ReqSummary from './ReqSummary.svelte';

  interface Props {
    mission: Mission;
  }

  let { mission }: Props = $props();

  const view = $derived(viewOf(mission));
  const forecast = $derived(view.forecast);
  /** What `dispatch` would answer to starting it now, from core. */
  const status = $derived(cardState(mission, view));
  const running = $derived(status.runningAt >= 0);
  /** What a start in the clone's slot would answer; null before the player has a clone. */
  const clone = $derived(cloneCardState(mission, view));
  const cloneRuns = $derived(running && clone !== null && status.runningAt === clone.slot);
  const refusal = $derived(running ? null : status.refusal);
  const shown = $derived(running ? 'running' : status.startable ? 'startable' : 'blocked');
  const by = $derived(refusal?.by ? holderRef(refusal.by) : null);
  const rewards = $derived(rewardRows(forecast.rewards));
  /** The run in its slot: the stage and the timing of its cycle, from the same core state and action kind the «Зараз» bar reads. */
  const progress = $derived(
    running
      ? game.read((gs) => {
          const slot = status.runningAt;
          const ms = game.rules.actionKinds[MISSION_KIND]?.intervalMs(
            gs,
            mission.id,
            game.content,
            game.rules,
            slot,
          );
          const timing = slotTiming(gs, slot, ms ?? 0);
          return {
            now: missionNow(gs, slot, game.content),
            timing,
            leftMs: Math.round((1 - timing.fraction) * timing.cycleMs),
          };
        })
      : null,
  );
  const trained = $derived(trainedSkills(forecast));
  const clientKey = $derived(`mission.${mission.id}.client`);

  /** Starts the mission with the performer: the character in the slot core names, a clone in its own. */
  const startWith = (p: { slot: number; clone: boolean }) =>
    game.dispatch({
      type: 'action.start',
      slot: p.clone ? p.slot : status.slot,
      kind: MISSION_KIND,
      id: mission.id,
    });
</script>

<li
  class="ct-tile card"
  class:running
  class:closed={!view.open}
  data-ui="mission-card"
  data-entity={entityAttr({ kind: 'mission', id: mission.id })}
  data-mission={mission.id}
  data-state={shown}
>
  <div class="ct-head">
    <h3 class="ct-name">
      <MissionRankStamp rank={mission.rank} />
      <EntityLink kind="mission" id={mission.id} />
    </h3>
    <div class="ct-corner corner">
      <MissionTeamMark team={mission.team} />
      <PinGoal kind="mission" id={mission.id} always />
    </div>
  </div>
  {#if hasKey(clientKey)}<p class="ct-note client">{t(clientKey)}</p>{/if}

  <dl class="ct-facts">
    <div>
      <dt>{t('mission.duration')}</dt>
      <dd data-duration data-ms={forecast.expectedMs}>
        {forecast.doable ? formatDuration(forecast.expectedMs) : t('mission.unknown')}
      </dd>
    </div>
    <div>
      <dt>{t('mission.chance.title')}</dt>
      <dd data-chance data-value={forecast.cleanChance}>
        {forecast.doable ? `${Math.round(forecast.cleanChance * 100)}%` : t('mission.unknown')}
      </dd>
    </div>
    <div>
      <dt>{t('mission.ryoHour')}</dt>
      <dd data-ryo-hour data-value={forecast.ryoPerHour}>
        {forecast.doable && forecast.ryo > 0
          ? formatInt(Math.round(forecast.ryoPerHour))
          : t('mission.unknown')}
      </dd>
    </div>
  </dl>

  <ul class="ct-list rewards" aria-label={t('mission.rewards')}>
    {#each rewards as reward (`${reward.t}:${reward.id}`)}
      <li><MissionReward {reward} /></li>
    {/each}
  </ul>

  {#if trained.length > 0}
    <p class="ct-note trains" data-trains>
      <span>{t('mission.trains')}:</span>
      {#each trained as x (x.skill)}
        <span data-trains-skill={x.skill} data-value={x.perHour}>
          <EntityLink kind="skill" id={x.skill} />
          {t('mission.trainsHour', { n: formatXp(x.perHour) })}</span
        >
      {/each}
    </p>
  {/if}

  {#if running}
    <p class="ct-note" data-running>
      <Icon name="lucide:hourglass" size={14} />
      {cloneRuns ? t('mission.runningClone') : t('mission.running', { n: status.runningAt + 1 })}
    </p>
    {#if progress}
      <div class="progress" data-ui="mission-progress">
        <p class="ct-note line">
          {#if progress.now}
            <span data-stage
              >{t('mission.now.stage', {
                n: progress.now.stage + 1,
                total: progress.now.stages,
              })}</span
            >
          {/if}
          <PerformerMarks kind={MISSION_KIND} id={mission.id} />
          {#if progress.leftMs > 0}
            <span data-left data-ms={progress.leftMs}>{formatDuration(progress.leftMs)}</span>
          {/if}
        </p>
        <TimeBar timing={progress.timing} part="mission-bar" size="md" label={t('now.progress')} />
      </div>
    {/if}
  {:else if refusal}
    <div class="why" id="why-{mission.id}" data-why={refusal.reason}>
      {#if refusal.blocker}
        <ReqSummary node={refusal.blocker.result} />
      {/if}
      {#if by}
        <p class="ct-why" data-by>
          {t(refusal.reason)}
          {t('mission.busyBy')}
          {#if by.ref}
            <EntityLink kind={by.ref.kind} id={by.ref.id} />
          {:else}
            <a href="#/combat">{t('mission.busyCombat')}</a>
          {/if}
        </p>
      {:else if refusal.reason === NEEDS_TEAM}
        <p class="ct-why" data-needs-team>
          {t(refusal.reason)} <a href="#/nature">{t('req.natureLink')}</a>
        </p>
      {:else}
        <p class="ct-why">{t(refusal.reason)}</p>
      {/if}
    </div>
  {/if}

  {#if clone && !running}
    {#if clone.refusal?.reason === 'error.fightBusy'}
      <p class="ct-why" id="why-clone-{mission.id}" data-clone-why>
        <BusyBy reason={clone.refusal.reason} by={clone.refusal.by} />
      </p>
    {/if}
  {/if}
  <!-- Pinned to the bottom of the card at the height of the button; the free height of a taller neighbour goes above it. -->
  <div class="ct-actions" data-ui="card-actions">
    <StartSplit
      kind={MISSION_KIND}
      id={mission.id}
      disabledFor={(p) => (p.clone ? !(clone?.startable ?? false) : shown === 'blocked')}
      describedBy={shown === 'blocked' ? `why-${mission.id}` : undefined}
      run={startWith}
    />
  </div>
</li>

<style>
  .card.closed {
    border-style: dashed;
  }

  .client {
    margin: 0;
  }

  /* The title takes the free width and wraps only when it does not fit; the kind icon and the pin stay in the top-right corner. */
  .card :global(.ct-head) {
    align-items: flex-start;
  }

  .ct-name {
    flex: 1;
    flex-wrap: nowrap;
    min-width: 0;
    overflow-wrap: break-word;
  }

  .corner {
    margin-left: auto;
  }

  .rewards {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
  }

  .trains {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
  }

  .trains :global(a) {
    color: var(--accent);
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .progress .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-2);
  }

  .why {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .why .ct-why :global(a),
  .ct-note :global(a) {
    color: var(--accent);
  }
  /* On a phone the card is tighter: spacing one step down, the rewards on one wrapping line. */
  @media (max-width: 768px) {
    .card {
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
    }

    .rewards {
      align-items: center;
      gap: var(--space-1) var(--space-2);
    }
  }
</style>
