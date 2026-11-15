<script lang="ts">
  import type { Mission } from '@shinobi/content';
  import { MISSION_KIND } from '@shinobi/core';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { cardState, viewOf } from '../lib/mission-feed.svelte.ts';
  import { cleanRunChance, pinTarget, rewardsOf } from '../lib/missions.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import MissionRankStamp from './MissionRankStamp.svelte';
  import PinGoal from './PinGoal.svelte';
  import MissionReward from './MissionReward.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    mission: Mission;
  }

  let { mission }: Props = $props();

  const view = $derived(viewOf(mission));
  const forecast = $derived(view.forecast);
  /** Whether a team goes with the player, for a mission that asks for one. */
  const hasTeam = $derived(game.read((gs) => gs.team !== null));
  const state = $derived(cardState(mission, view.blocker));
  const rewards = $derived(rewardsOf(forecast, game.content));
  const chance = $derived(cleanRunChance(forecast));
  /** A blocked mission pins the first unmet entity of its blocker, the same target as the mission page. */
  const pin = $derived(state.kind === 'blocked' ? pinTarget(state.blocker) : null);
  const clientKey = $derived(`mission.${mission.id}.client`);

  function start(): void {
    if (state.kind === 'running') {
      const result = game.dispatch({ type: 'action.stop', slot: state.slot });
      if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
      return;
    }
    const result = game.dispatch({
      type: 'action.start',
      slot: state.slot,
      kind: MISSION_KIND,
      id: mission.id,
    });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

<li
  class="ct-tile card"
  class:running={state.kind === 'running'}
  class:closed={!view.open}
  data-ui="mission-card"
  data-entity="mission:{mission.id}"
  data-mission={mission.id}
  data-state={state.kind}
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
    {#if pin}<PinGoal kind={pin.kind} id={pin.id} always />{/if}
  </div>
  {#if hasKey(clientKey)}<p class="ct-note client">{t(clientKey)}</p>{/if}
  {#if mission.team && !hasTeam}
    <p class="ct-note" data-no-team>
      {t('mission.team.none')} <a href="#/nature">{t('req.natureLink')}</a>
    </p>
  {/if}

  <dl class="ct-facts">
    <div>
      <dt>{t('mission.duration')}</dt>
      <dd data-duration data-ms={forecast.expectedMs}>
        {forecast.doable ? formatDuration(forecast.expectedMs) : t('mission.unknown')}
      </dd>
    </div>
    <div>
      <dt>{t('mission.chance.title')}</dt>
      <dd data-chance data-value={chance}>
        {forecast.doable ? `${Math.round(chance * 100)}%` : t('mission.unknown')}
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

  {#if state.kind === 'running'}
    <p class="ct-note" data-running>
      <Icon name="lucide:hourglass" size={14} />
      {t('mission.running', { n: state.slot + 1 })}
    </p>
  {:else if state.kind === 'blocked'}
    <div class="why" id="why-{mission.id}" data-why={state.reason}>
      {#if state.blocker}
        <ReqTree node={state.blocker} />
        {#if pin}
          <p class="ct-pin-caption"><PinGoal kind={pin.kind} id={pin.id} variant="link" /></p>
        {/if}
      {/if}
      {#if state.by}
        <p class="ct-why" data-by>
          {t(state.reason)}
          {t('mission.busyBy')}
          {#if state.by.ref}
            <EntityLink kind={state.by.ref.kind} id={state.by.ref.id} />
          {:else}
            <a href="#/combat">{t('mission.busyCombat')}</a>
          {/if}
        </p>
      {:else}
        <p class="ct-why">{t(state.reason)}</p>
      {/if}
    </div>
  {/if}

  <button
    type="button"
    class="ct-action"
    class:stop={state.kind === 'running'}
    disabled={state.kind === 'blocked'}
    data-start
    aria-describedby={state.kind === 'blocked' ? `why-${mission.id}` : undefined}
    onclick={start}
  >
    {t(state.kind === 'running' ? 'tile.stop' : 'tile.start')}
  </button>
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
