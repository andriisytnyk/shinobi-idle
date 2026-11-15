<script lang="ts">
  import { MISSION_KIND } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import MissionRankStamp from '../components/MissionRankStamp.svelte';
  import MissionRation from '../components/MissionRation.svelte';
  import MissionReward from '../components/MissionReward.svelte';
  import MissionStage from '../components/MissionStage.svelte';
  import ModParts from '../components/ModParts.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import Slot from '../lib/ext/Slot.svelte';
  import { entityDesc } from '../lib/entities.ts';
  import { formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { cardState, followCommands, stagesOf, viewOf } from '../lib/mission-feed.svelte.ts';
  import { cleanRunChance, missionNow, pinTarget, rewardsOf } from '../lib/missions.ts';
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import EntityPage from './EntityPage.svelte';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  $effect(() => followCommands());

  const mission = $derived(game.content.missions.find((m) => m.id === id));
  const view = $derived(mission ? viewOf(mission) : null);
  const forecast = $derived(view?.forecast ?? null);
  const stages = $derived(mission && forecast ? stagesOf(mission, forecast) : []);
  const state = $derived(mission && view ? cardState(mission, view.blocker) : null);
  /** The stage under way when this mission runs. */
  const current = $derived(
    game.read((gs) => {
      const slot = gs.slots.findIndex((s) => s.action?.kind === MISSION_KIND && s.action.id === id);
      return slot >= 0 ? (missionNow(gs, slot, game.content)?.stage ?? null) : null;
    }),
  );
  const rewards = $derived(mission && forecast ? rewardsOf(mission, forecast, game.content) : []);
  const chance = $derived(forecast ? cleanRunChance(forecast) : 0);
  const pin = $derived(pinTarget(view?.blocker?.result ?? null));
  const pinned = $derived(
    game.read((gs) => pin !== null && gs.goal?.kind === pin.kind && gs.goal.id === pin.id),
  );
  const desc = $derived(entityDesc({ kind: 'mission', id }));
  const clientKey = $derived(`mission.${id}.client`);
  const xpRows = $derived(
    Object.entries(forecast?.xpPerHour ?? {})
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]),
  );
  const hasTeam = $derived(game.read((gs) => gs.team !== null));

  function toggle(): void {
    if (!state || !mission) return;
    const result =
      state.kind === 'running'
        ? game.dispatch({ type: 'action.stop', slot: state.slot })
        : game.dispatch({
            type: 'action.start',
            slot: state.slot,
            kind: MISSION_KIND,
            id: mission.id,
          });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }

  function pinGoal(): void {
    if (!pin) return;
    const result = game.dispatch({ type: 'goal.set', ref: pin });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }
</script>

{#if !mission || !forecast || !state}
  <EntityPage entity={{ kind: 'mission', id }} />
{:else}
  <article
    class="mission"
    data-ui="entity-page"
    data-entity="mission:{mission.id}"
    data-mission={mission.id}
  >
    <p class="kind">{t('entity.kind.mission')}</p>
    <h1 data-ui="entity-header">
      <MissionRankStamp rank={mission.rank} />
      {t(`mission.${mission.id}.name`)}
    </h1>
    <Hint id="missionPage" />
    <Slot name="mission.header" ctx={{ mission: mission.id }} />

    {#if hasKey(clientKey)}<p class="client" data-client>
        {t('mission.client')}: {t(clientKey)}
      </p>{/if}
    {#if desc}<p class="desc" data-desc>{desc}</p>{/if}
    <p class="team" data-team={mission.team}>
      <Icon name="lucide:users" size={16} />
      {t(mission.team ? 'mission.team.yes' : 'mission.team.no')}
      {#if mission.team && !hasTeam}
        <span class="dim" data-no-team>
          {t('mission.team.none')} <a href="#/nature">{t('req.natureLink')}</a>
        </span>
      {/if}
    </p>

    <section class="actions" data-ui="entity-section" data-mission-actions>
      <div class="buttons">
        <button
          type="button"
          class="ct-action"
          class:stop={state.kind === 'running'}
          disabled={state.kind === 'blocked'}
          data-start
          aria-describedby={state.kind === 'blocked' ? 'why-mission' : undefined}
          onclick={toggle}
        >
          {t(state.kind === 'running' ? 'tile.stop' : 'tile.start')}
        </button>
        {#if pin}
          <button type="button" class="ct-button" data-pin disabled={pinned} onclick={pinGoal}>
            {t(pinned ? 'mission.pinned' : 'mission.pin')}
          </button>
        {/if}
      </div>
      {#if state.kind === 'running'}
        <p class="ct-note" data-running>
          <Icon name="lucide:hourglass" size={14} />
          {t('mission.running', { n: state.slot + 1 })}
        </p>
      {:else if state.kind === 'blocked'}
        <div class="why" id="why-mission" data-why={state.reason}>
          {#if state.blocker}<ReqTree node={state.blocker} />{/if}
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
    </section>

    <section class="ct-section" data-ui="entity-section" data-mission-stages>
      <h2>{t('mission.stages')}</h2>
      <ol class="stages">
        {#each stages as stage (stage.index)}
          <MissionStage
            missionId={mission.id}
            view={stage}
            kind={mission.stages[stage.index]?.t ?? ''}
            ration={forecast.ration}
            floor={forecast.durationFloor}
            current={current === stage.index}
          />
        {/each}
      </ol>
    </section>

    <section class="ct-section" data-ui="entity-section" data-mission-ration>
      <MissionRation />
    </section>

    <section class="ct-section" data-ui="entity-section" data-mission-totals>
      <h2>{t('mission.totals')}</h2>
      <dl class="totals">
        <div data-total="time" data-ms={forecast.nominalMs}>
          <dt>{t('mission.duration')}</dt>
          <dd>
            {formatDuration(forecast.nominalMs)}
            <span class="dim" data-expected data-ms={forecast.expectedMs}>
              {t('mission.expected', { time: formatDuration(forecast.expectedMs) })}
            </span>
          </dd>
        </div>
        <div data-total="chance" data-value={chance}>
          <dt>{t('mission.chance.title')}</dt>
          <dd>{Math.round(chance * 100)}%</dd>
        </div>
        {#if forecast.ryo > 0}
          <div data-total="ryo" data-value={forecast.ryoPerHour}>
            <dt>{t('mission.ryoHour')}</dt>
            <dd>
              <ModParts
                display={formatInt(Math.round(forecast.ryoPerHour))}
                parts={forecast.mods.ryo}
                base={formatInt(mission.ryo)}
              />
            </dd>
          </div>
        {/if}
        {#if forecast.rep > 0}
          <div data-total="rep" data-value={forecast.repPerHour}>
            <dt>{t('mission.repHour')}</dt>
            <dd>
              <ModParts
                display={formatXp(forecast.repPerHour)}
                parts={forecast.mods.rep}
                base={formatInt(mission.rep)}
              />
            </dd>
          </div>
        {/if}
        {#if forecast.resource}
          <div data-total="resource">
            <dt>{t('mission.resource')}</dt>
            <dd>
              <ModParts
                display={t('mission.resourceValue', {
                  n: forecast.resource.units,
                  name: t(`resource.${forecast.resource.slug}.name`),
                })}
                parts={forecast.mods.resource}
              />
            </dd>
          </div>
        {/if}
        <div data-total="xp">
          <dt>{t('mission.xpHour')}</dt>
          <dd>
            {#each xpRows as [skill, value], i (skill)}
              {#if i > 0},
              {/if}
              <span data-xp-skill={skill} data-value={value}>
                {formatXp(value)}
                <EntityLink kind="skill" id={skill} />
              </span>
            {:else}
              <span class="dim">{t('mission.unknown')}</span>
            {/each}
          </dd>
        </div>
      </dl>
      <ul class="rewards" aria-label={t('mission.rewards')}>
        {#each rewards as reward (`${reward.t}:${reward.id}`)}
          <li><MissionReward {reward} /></li>
        {/each}
      </ul>
    </section>

    <Slot name="mission.footer" ctx={{ mission: mission.id }} />
  </article>
{/if}

<style>
  .mission {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .kind {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  h1 {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-1) 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: 400;
  }

  h2 {
    margin: 0 0 var(--space-2);
  }

  p {
    margin: 0;
  }

  .desc {
    max-width: var(--measure);
  }

  .team,
  .client {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    color: var(--fg-dim);
  }

  .team a,
  .ct-note :global(a),
  .why .ct-why :global(a) {
    color: var(--accent);
  }

  .dim {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .why {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .stages {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--card-min)), 1fr));
    gap: var(--space-3) var(--space-4);
    margin: 0 0 var(--space-3);
  }

  .totals dt {
    color: var(--fg-dim);
    font-size: var(--text-2xs);
  }

  .totals dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .rewards {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
