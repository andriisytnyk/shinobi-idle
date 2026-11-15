<script lang="ts">
  import { formatBonus, formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { currencyOf } from '../lib/vocab.ts';
  import type { StageView } from '../lib/missions.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModParts from './ModParts.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    missionId: string;
    view: StageView;
    kind: string;
    /** The share (negative) the armed ration takes off, and the share of its base time a stage cannot go below. */
    ration: number;
    floor: number;
    /** The stage under way in a running mission. */
    current?: boolean;
    /** How many times longer a slow fallback takes, and the skills every fight pays besides its style skill. */
    slowK: number;
    fightSkills: string[];
  }

  let {
    missionId,
    view,
    kind,
    ration,
    floor,
    current = false,
    slowK,
    fightSkills,
  }: Props = $props();

  /** The currency that alternative stages pay: the one with the role study. */
  const study = currencyOf(game.content, 'study') ?? '';

  const stage = $derived(view.forecast);
  const path = $derived(stage.path);
  const self = $derived(path?.who === 'self');
  /** Why a teammate does the stage: the player has no normal way of their own. */
  const notes = $derived.by(() => {
    const out: { label: string; value: string }[] = [];
    if (Math.abs(view.residual - 1) > 0.005) {
      out.push({
        label: t('mission.stage.levelFactor'),
        value: `×${Math.round(view.residual * 100) / 100}`,
      });
    }
    if (ration !== 0)
      out.push({ label: t('mission.ration.label'), value: formatBonus(1 + ration) });
    out.push({ label: t('mission.stage.floor'), value: `${Math.round(floor * 100)}%` });
    return out;
  });
</script>

<li
  class="stage"
  class:current
  aria-current={current ? 'step' : undefined}
  data-ui="mission-stage"
  data-entity="mission:{missionId}"
  data-stage={stage.index}
  data-kind={kind}
  data-doable={path !== null}
>
  <header class="head">
    <span class="num" aria-hidden="true">{stage.index + 1}</span>
    <h3 class="name">
      {#if view.head.labelKey}<span data-stage-label>{t(view.head.labelKey)}</span>{:else}{t(
          `mission.stage.kind.${kind}`,
        )}{/if}
      {#each view.head.refs as ref (`${ref.kind}:${ref.id}`)}
        <span class="chip" data-stage-chip><EntityLink kind={ref.kind} id={ref.id} /></span>
      {/each}
    </h3>
    {#if view.head.combat}
      <a class="to-combat" href="#/combat">{t('mission.stage.toCombat')}</a>
    {/if}
  </header>

  {#if view.alts.length > 0}
    <ul class="alts" aria-label={t('mission.stage.ways')} data-alts>
      {#each view.alts as way, i (i)}
        <li
          class="alt"
          class:used={way.used}
          data-alt={i}
          data-used={way.used}
          data-slow={way.alt.slow}
          data-intel={way.alt.intel > 0}
          data-met={way.met}
        >
          <div class="what">
            {#if way.result}
              <ReqTree node={way.result} />
              {#if way.alt.techNeeded}
                <div class="need" class:met={way.techMet} data-need-tech data-met={way.techMet}>
                  <Icon name={way.techMet ? 'lucide:check' : 'lucide:minus'} size={14} />
                  <EntityLink kind="skill" id={way.alt.techNeeded.skill} />
                  <span class="dim"
                    >{t('mission.stage.needTech', { min: way.alt.techNeeded.min })}</span
                  >
                </div>
              {/if}
            {:else}
              <span class="intel">
                <Icon entity={{ kind: 'currency', id: study }} size={16} />
                {t('mission.stage.intel', { n: way.alt.intel })}
                <span class="dim"
                  >{t('mission.stage.intelHave', { have: formatInt(way.have) })}</span
                >
              </span>
            {/if}
          </div>
          <span class="tags">
            {#if way.used}<span class="tag used-tag" data-tag="used">{t('mission.stage.used')}</span
              >{/if}
            {#if way.alt.slow}<span class="tag" data-tag="slow"
                >{t('mission.stage.slow', { k: slowK })}</span
              >{/if}
            {#if !way.met && way.alt.intel === 0}<span class="tag" data-tag="unmet"
                >{t('mission.stage.altUnmet')}</span
              >{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if view.takes}
    <p class="takes" data-takes>
      {t('mission.stage.takes')}
      <EntityLink kind="item" id={view.takes.item} />
      <span class:short={view.takes.have < view.takes.need}>
        {t('mission.stage.haveNeed', {
          have: formatInt(view.takes.have),
          need: formatInt(view.takes.need),
        })}
      </span>
    </p>
  {/if}

  {#if path === null}
    <p class="ct-why" data-no-path>{t('mission.stage.blocked')}</p>
  {:else}
    <dl class="facts">
      <div data-who={path.who}>
        <dt>{t('mission.stage.who')}</dt>
        <dd>
          {#if self}
            {t('mission.who.self')}
          {:else}
            <span data-entity="teammate:{path.who}">
              {t('mission.who.mate', { name: t(`teammate.${path.who}.name`) })}
            </span>
            <span class="dim" data-who-reason>{t('mission.who.reason')}</span>
          {/if}
        </dd>
      </div>
      <div data-stage-time data-ms={stage.ms}>
        <dt>{t('mission.stage.time')}</dt>
        <dd>
          <ModParts
            display={formatDuration(stage.ms)}
            parts={view.parts}
            base={formatDuration(view.base)}
            {notes}
          />
        </dd>
      </div>
      {#if stage.chance < 1}
        <div data-stage-chance data-value={stage.chance}>
          <dt>{t('mission.stage.chance')}</dt>
          <dd>{Math.round(stage.chance * 100)}%</dd>
        </div>
      {/if}
      {#if view.reward.fight !== null}
        <div data-stage-fight-xp data-value={view.reward.fight}>
          <dt>{t('mission.stage.fightXp')}</dt>
          <dd>
            {t('mission.stage.fightXpValue', { n: formatXp(view.reward.fight) })}
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
      {#if view.reward.skills.length > 0}
        <div data-stage-xp>
          <dt>{t('mission.stage.xp')}</dt>
          <dd>
            {#each view.reward.skills as xp, i (xp.skill)}
              {#if i > 0},
              {/if}
              {t('mission.stage.xpValue', { n: formatXp(xp.amount) })}
              <EntityLink kind="skill" id={xp.skill} />
            {/each}
          </dd>
        </div>
      {/if}
      {#if view.reward.mastery}
        <div data-stage-mastery>
          <dt>{t('mission.stage.mastery')}</dt>
          <dd><EntityLink kind="technique" id={view.reward.mastery} /></dd>
        </div>
      {/if}
    </dl>
    {#if stage.next}
      <p class="dim next" data-stage-next>
        {t('mission.stage.next', {
          time: formatDuration(stage.next.ms),
          chance: Math.round(stage.next.chance * 100),
        })}
      </p>
    {/if}
    {#if stage.chance < 1}
      <p class="dim" data-stage-expected>
        {t('mission.stage.expected', { time: formatDuration(stage.expectedMs) })}
      </p>
    {/if}
  {/if}
</li>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    list-style: none;
  }

  .stage.current {
    border-color: var(--accent);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .num {
    --_size: 1.75rem;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--_size);
    height: var(--_size);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-pill);
    color: var(--accent);
    font-weight: 600;
  }

  .name {
    flex: 1 1 var(--panel-min);
    margin: 0;
    color: var(--heading);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .name :global(a) {
    color: var(--heading);
  }

  .chip {
    font-weight: 400;
  }

  .need {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    color: var(--fg-dim);
  }

  .need.met {
    color: var(--fg);
  }

  .to-combat {
    color: var(--accent);
  }

  .alts {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .alt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
  }

  .alt.used {
    border-color: var(--accent);
    background: var(--surface);
  }

  .what {
    flex: 1 1 var(--panel-min);
    min-width: 0;
  }

  .tags {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .tag {
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-pill);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .used-tag {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .intel {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
  }

  .takes {
    margin: 0;
  }

  .short {
    color: var(--danger);
    font-weight: 600;
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--card-min)), 1fr));
    gap: var(--space-2) var(--space-4);
    margin: 0;
  }

  .facts dt {
    color: var(--fg-dim);
    font-size: var(--text-2xs);
  }

  .facts dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  p {
    margin: 0;
  }
  @media (max-width: 768px) {
    .stage {
      gap: var(--space-1);
      padding: var(--space-2);
    }

    .facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-1) var(--space-3);
    }

    .alt {
      padding: 0 var(--space-2);
    }
  }
</style>
