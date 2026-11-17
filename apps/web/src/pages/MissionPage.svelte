<script lang="ts">
  import { MISSION_KIND, NEEDS_TEAM } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import MissionRankStamp from '../components/MissionRankStamp.svelte';
  import MissionRation from '../components/MissionRation.svelte';
  import MissionReward from '../components/MissionReward.svelte';
  import PinGoal from '../components/PinGoal.svelte';
  import MissionStage from '../components/MissionStage.svelte';
  import ModParts from '../components/ModParts.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import Slot from '../lib/ext/Slot.svelte';
  import { entityDesc, entityName } from '../lib/entities.ts';
  import { resourceName } from '../lib/vocab.ts';
  import { formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import {
    cardState,
    cloneCardState,
    followCommands,
    stagesOf,
    viewOf,
  } from '../lib/mission-feed.svelte.ts';
  import { holderRef, hourChain, missionNow, rewardRows } from '../lib/missions.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
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
  /** What `dispatch` would answer to starting the mission now, from core. */
  const status = $derived(mission && view ? cardState(mission, view) : null);
  const running = $derived(status !== null && status.runningAt >= 0);
  /** What a start in the clone's slot would answer; null before the player has a clone. */
  const clone = $derived(mission && view ? cloneCardState(mission, view) : null);
  const cloneRuns = $derived(running && clone !== null && status?.runningAt === clone.slot);
  const refusal = $derived(running ? null : (status?.refusal ?? null));
  const by = $derived(refusal?.by ? holderRef(refusal.by) : null);
  /** The stage under way when this mission runs. */
  const current = $derived(
    game.read((gs) => {
      const slot = gs.slots.findIndex((s) => s.action?.kind === MISSION_KIND && s.action.id === id);
      return slot >= 0 ? (missionNow(gs, slot, game.content)?.stage ?? null) : null;
    }),
  );
  const rewards = $derived(forecast ? rewardRows(forecast.rewards) : []);
  const desc = $derived(entityDesc({ kind: 'mission', id }));
  const clientKey = $derived(`mission.${id}.client`);
  /** XP per hour of the skills core is sure of, biggest first; the fights' whole XP is a line of its own (its style skill is not known beforehand). */
  const xpRows = $derived(
    Object.entries(forecast?.doable ? forecast.xpPerHour : {})
      .filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1]),
  );
  /** The skills every fight of the mission pays besides its style skill. */
  const fightSkills = $derived([
    ...new Set(stages.flatMap((s) => s.forecast.xp.fight?.skills ?? [])),
  ]);
  const ryoChain = $derived(
    mission && forecast
      ? hourChain(mission.ryo, forecast.mods.ryo, forecast.ryo, forecast.expectedMs)
      : null,
  );
  const repChain = $derived(
    mission && forecast
      ? hourChain(mission.rep, forecast.mods.rep, forecast.rep, forecast.expectedMs)
      : null,
  );
  const slowK = $derived(game.content.balance.K.mission.slowAlt);

  const runsFormat = new Intl.NumberFormat('uk', { maximumFractionDigits: 2 });

  /** The lines after the modifiers of a per-hour figure: what one mission pays, and how many runs fit in an hour. */
  function chainNotes(chain: ReturnType<typeof hourChain> | null) {
    if (!chain) return [];
    return [
      {
        id: 'perMission',
        label: t('mission.chain.perMission'),
        value: formatXp(chain.perMission),
        raw: chain.perMission,
      },
      {
        id: 'runs',
        label: t('mission.chain.runs'),
        value: `×${runsFormat.format(chain.runs)}`,
        raw: chain.runs,
      },
    ];
  }

  function startClone(): void {
    if (!clone || !mission) return;
    const result = game.dispatch({
      type: 'action.start',
      slot: clone.slot,
      kind: MISSION_KIND,
      id: mission.id,
    });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }

  function toggle(): void {
    if (!status || !mission) return;
    const result = running
      ? game.dispatch({ type: 'action.stop', slot: status.runningAt })
      : game.dispatch({
          type: 'action.start',
          slot: status.slot,
          kind: MISSION_KIND,
          id: mission.id,
        });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

{#if !mission || !forecast || !status}
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
      {entityName({ kind: 'mission', id: mission.id })}
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
    </p>

    <section class="actions" data-ui="entity-section" data-mission-actions>
      <div class="buttons">
        <button
          type="button"
          class="ct-action"
          class:stop={running}
          disabled={refusal !== null}
          data-start
          aria-describedby={refusal ? 'why-mission' : undefined}
          onclick={toggle}
        >
          {t(running ? 'tile.stop' : 'tile.start')}
        </button>
        {#if clone && !running}
          <button
            type="button"
            class="ct-action clone"
            data-ui="clone-start"
            disabled={!clone.startable}
            aria-describedby={clone.refusal?.reason === 'error.cloneNoFight'
              ? 'why-clone'
              : undefined}
            onclick={startClone}
          >
            {t('tile.clone')}
          </button>
        {/if}
        <PinGoal kind="mission" id={mission.id} variant="button" />
      </div>
      {#if running}
        <p class="ct-note" data-running>
          <Icon name="lucide:hourglass" size={14} />
          {cloneRuns
            ? t('mission.runningClone')
            : t('mission.running', { n: status.runningAt + 1 })}
        </p>
      {:else if refusal}
        <div class="why" id="why-mission" data-why={refusal.reason}>
          {#if refusal.blocker}<ReqTree
              node={refusal.blocker.first ?? refusal.blocker.result}
            />{/if}
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
      {#if clone && !running && clone.refusal?.reason === 'error.cloneNoFight'}
        <p class="ct-why" id="why-clone" data-clone-why>{t(clone.refusal.reason)}</p>
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
            current={current === stage.index}
            {slowK}
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
            {#if !forecast.doable}
              {t('mission.unknown')}
            {:else}
              {formatDuration(forecast.nominalMs)}
              <!-- The expectation with repeats is shown only where it reads differently. -->
              {#if formatDuration(forecast.expectedMs) !== formatDuration(forecast.nominalMs)}
                <span class="dim" data-expected data-ms={forecast.expectedMs}>
                  {t('mission.expected', { time: formatDuration(forecast.expectedMs) })}
                </span>
              {/if}
            {/if}
          </dd>
        </div>
        <div data-total="chance" data-value={forecast.cleanChance}>
          <dt>{t('mission.chance.title')}</dt>
          <dd>
            {forecast.doable ? `${Math.round(forecast.cleanChance * 100)}%` : t('mission.unknown')}
          </dd>
        </div>
        {#if forecast.ryo > 0}
          <div data-total="money" data-value={forecast.ryoPerHour}>
            <dt>{t('mission.ryoHour')}</dt>
            <dd>
              {#if !forecast.doable}{t('mission.unknown')}{:else}<ModParts
                  display={formatInt(Math.round(forecast.ryoPerHour))}
                  parts={forecast.mods.ryo}
                  base={formatInt(mission.ryo)}
                  baseRaw={mission.ryo}
                  notes={chainNotes(ryoChain)}
                />{/if}
            </dd>
          </div>
        {/if}
        {#if forecast.rep > 0}
          <div data-total="renown" data-value={forecast.repPerHour}>
            <dt>{t('mission.repHour')}</dt>
            <dd>
              {#if !forecast.doable}{t('mission.unknown')}{:else}<ModParts
                  display={formatXp(forecast.repPerHour)}
                  parts={forecast.mods.rep}
                  base={formatInt(mission.rep)}
                  baseRaw={mission.rep}
                  notes={chainNotes(repChain)}
                />{/if}
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
                  name: resourceName(forecast.resource.slug),
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
              {#if !forecast.doable || forecast.fightXpPerHour === 0}<span class="dim"
                  >{t('mission.unknown')}</span
                >{/if}
            {/each}
          </dd>
        </div>
        {#if forecast.doable && forecast.fightXpPerHour > 0}
          <div data-total="fight-xp" data-value={forecast.fightXpPerHour}>
            <dt>{t('mission.fightXpHour')}</dt>
            <dd>
              {t('mission.stage.fightXpValue', { n: formatXp(forecast.fightXpPerHour) })}
              <span class="dim">
                {t('mission.stage.fightXpWhere')}
                {#each fightSkills as skill, i (skill)}<EntityLink
                    kind="skill"
                    id={skill}
                  />{#if i < fightSkills.length - 1}<span>, </span>{/if}{/each}
              </span>
            </dd>
          </div>
        {/if}
      </dl>
      {#if !forecast.doable}
        <p class="ct-why" data-no-way>{t('mission.totals.noWay')}</p>
      {/if}
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
