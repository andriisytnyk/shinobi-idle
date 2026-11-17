<script lang="ts">
  import { entityAttr } from '../lib/reveal.ts';
  import type { Mission } from '@shinobi/content';
  import { MISSION_KIND, NEEDS_TEAM } from '@shinobi/core';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { cardState, cloneCardState, viewOf } from '../lib/mission-feed.svelte.ts';
  import { holderRef, rewardRows } from '../lib/missions.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import MissionRankStamp from './MissionRankStamp.svelte';
  import MissionReward from './MissionReward.svelte';
  import PinGoal from './PinGoal.svelte';
  import ReqTree from './ReqTree.svelte';

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
  /** Why the clone cannot take the mission (when the mission itself is startable). */
  const cloneRefusal = $derived(clone?.refusal?.reason ?? null);
  const refusal = $derived(running ? null : status.refusal);
  const shown = $derived(running ? 'running' : status.startable ? 'startable' : 'blocked');
  const by = $derived(refusal?.by ? holderRef(refusal.by) : null);
  const rewards = $derived(rewardRows(forecast.rewards));
  const clientKey = $derived(`mission.${mission.id}.client`);

  function startClone(): void {
    if (!clone) return;
    const result = game.dispatch({
      type: 'action.start',
      slot: clone.slot,
      kind: MISSION_KIND,
      id: mission.id,
    });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }

  function start(): void {
    if (running) {
      const result = game.dispatch({ type: 'action.stop', slot: status.runningAt });
      if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
      return;
    }
    const result = game.dispatch({
      type: 'action.start',
      slot: status.slot,
      kind: MISSION_KIND,
      id: mission.id,
    });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
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
    <span class="team" data-team={mission.team}>
      <Icon name="lucide:users" size={14} />
      {t(mission.team ? 'mission.team.yes' : 'mission.team.no')}
    </span>
    <PinGoal kind="mission" id={mission.id} always />
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

  {#if running}
    <p class="ct-note" data-running>
      <Icon name="lucide:hourglass" size={14} />
      {cloneRuns ? t('mission.runningClone') : t('mission.running', { n: status.runningAt + 1 })}
    </p>
  {:else if refusal}
    <div class="why" id="why-{mission.id}" data-why={refusal.reason}>
      {#if refusal.blocker}
        <ReqTree node={refusal.blocker.first ?? refusal.blocker.result} />
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

  <button
    type="button"
    class="ct-action"
    class:stop={running}
    disabled={shown === 'blocked'}
    data-start
    aria-describedby={shown === 'blocked' ? `why-${mission.id}` : undefined}
    onclick={start}
  >
    {t(running ? 'tile.stop' : 'tile.start')}
  </button>
  {#if clone && !running}
    <button
      type="button"
      class="ct-action clone"
      data-ui="clone-start"
      disabled={!clone.startable}
      aria-describedby={cloneRefusal === 'error.cloneNoFight'
        ? `why-clone-${mission.id}`
        : undefined}
      onclick={startClone}
    >
      {t('tile.clone')}
    </button>
    {#if cloneRefusal === 'error.cloneNoFight'}
      <p class="ct-why" id="why-clone-{mission.id}" data-clone-why>{t(cloneRefusal)}</p>
    {/if}
  {/if}
</li>

<style>
  .card.closed {
    border-style: dashed;
  }

  .team {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .client {
    margin: 0;
  }

  .ct-name {
    flex-wrap: nowrap;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .rewards {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
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

    .team {
      font-size: var(--text-2xs);
    }
  }
</style>
