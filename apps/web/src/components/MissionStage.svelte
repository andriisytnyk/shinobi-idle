<script lang="ts">
  import { formatBonus, formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { currencyOf, teammateName } from '../lib/vocab.ts';
  import type { StageView } from '../lib/missions.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModParts from './ModParts.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    missionId: string;
    view: StageView;
    kind: string;
    /** The stage under way in a running mission. */
    current?: boolean;
    /** How many times longer a slow fallback takes. */
    slowK: number;
  }

  let { missionId, view, kind, current = false, slowK }: Props = $props();

  /** The currency that alternative stages pay: the one with the role study. */
  const study = currencyOf(game.content, 'study') ?? '';

  const stage = $derived(view.forecast);
  const path = $derived(stage.path);
  const self = $derived(path?.who === 'self');
  /** The ways to list: a fight and an items stage ask for nothing, so they have none to show. */
  const ways = $derived(view.ways.ways.filter((w) => w.kind !== 'free'));
  /** The XP the player is sure of by skill, and the style share of a fight, whose skill is not known beforehand. */
  const sure = $derived(stage.xp.lines.filter((l) => l.certain && l.skill !== null));
  const style = $derived(stage.xp.lines.find((l) => !l.certain) ?? null);
  /** The factors the length is made of, as core worked them out: they multiply out to the time shown. */
  const notes = $derived.by(() => {
    const d = stage.duration;
    const out: { label: string; value: string; id: string; raw: number }[] = [];
    if (!d) return out;
    const factor = (id: string, label: string, raw: number): void => {
      if (Math.abs(raw - 1) > 0.0005) {
        out.push({ id, label, value: `×${Math.round(raw * 1000) / 1000}`, raw });
      }
    };
    factor('level', t('mission.stage.partLevel'), d.level);
    factor('mastery', t('mission.stage.partMastery'), d.mastery);
    factor('slow', t('mission.stage.partSlow'), d.slow);
    if (d.ration !== 1) {
      out.push({
        id: 'ration',
        label: t('mission.ration.label'),
        value: formatBonus(d.ration),
        raw: d.ration,
      });
    }
    out.push({
      id: 'floor',
      label: t(d.floored ? 'mission.stage.floorBinds' : 'mission.stage.floor'),
      value: `${Math.round(d.floor * 100)}%`,
      raw: d.floor,
    });
    return out;
  });
  const modifierParts = $derived((stage.duration?.modifiers ?? []).flatMap((m) => m.parts));
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

  {#if ways.length > 0}
    <ul class="alts" aria-label={t('mission.stage.ways')} data-alts>
      {#each ways as way, i (i)}
        <li
          class="alt"
          class:used={way.used}
          data-alt={i}
          data-used={way.used}
          data-slow={way.slow}
          data-kind={way.kind}
          data-intel={way.kind === 'skip'}
          data-met={way.met}
        >
          <div class="what" class:tree={(way.result?.children.length ?? 0) > 0}>
            {#if way.kind === 'skip'}
              <span class="study">
                <Icon entity={{ kind: 'currency', id: study }} size={16} />
                {t('mission.stage.intel', { n: way.intel })}
                <span class="dim"
                  >{t('mission.stage.intelHave', { have: formatInt(way.have) })}</span
                >
              </span>
            {:else if way.kind === 'mate'}
              <span class="mate" data-mate-way data-entity="teammate:{way.who}">
                {t('mission.stage.mateWay', {
                  name: teammateName(way.who),
                  level: way.level,
                  min: way.min,
                })}
                <EntityLink kind="skill" id={way.skill} />
              </span>
            {:else if way.result}
              <ReqTree node={way.result} />
            {/if}
          </div>
          <span class="tags">
            {#if way.used}<span class="tag used-tag" data-tag="used">{t('mission.stage.used')}</span
              >{/if}
            {#if way.slow}<span class="tag" data-tag="slow"
                >{t('mission.stage.slow', { k: slowK })}</span
              >{/if}
            {#if !way.met && way.kind !== 'skip'}<span class="tag" data-tag="unmet"
                >{t('mission.stage.altUnmet')}</span
              >{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if view.ways.takes}
    {@const takes = view.ways.takes}
    <p class="takes" data-takes>
      {t('mission.stage.takes')}
      <EntityLink kind="item" id={takes.item} />
      <span class:short={takes.have < takes.need}>
        {t('mission.stage.haveNeed', {
          have: formatInt(takes.have),
          need: formatInt(takes.need),
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
              {t('mission.who.mate', { name: teammateName(path.who) })}
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
            parts={modifierParts}
            base={stage.duration ? formatDuration(stage.duration.baseMs) : undefined}
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
      {#if stage.xp.fight}
        <div data-stage-fight-xp data-value={stage.xp.fight.total}>
          <dt>{t('mission.stage.fightXp')}</dt>
          <dd>
            {t('mission.stage.fightXpValue', { n: formatXp(stage.xp.fight.total) })}
            <span class="dim">
              {t('mission.stage.fightXpWhere')}
              {#each stage.xp.fight.skills as skill, i (skill)}<EntityLink
                  kind="skill"
                  id={skill}
                />{#if i < stage.xp.fight.skills.length - 1}<span>, </span>{/if}{/each}
            </span>
            {#if style}
              <span class="dim" data-stage-style-xp data-value={style.amount}>
                {t('mission.stage.styleXp', { n: formatXp(style.amount) })}
              </span>
            {/if}
          </dd>
        </div>
      {/if}
      {#if sure.length > 0}
        <div data-stage-xp>
          <dt>{t('mission.stage.xp')}</dt>
          <dd>
            {#each sure as xp, i (xp.skill)}
              {#if i > 0},
              {/if}
              <span data-stage-xp-skill={xp.skill} data-value={xp.amount}>
                {t('mission.stage.xpValue', { n: formatXp(xp.amount) })}
                <EntityLink kind="skill" id={xp.skill ?? ''} />
              </span>
            {/each}
          </dd>
        </div>
      {/if}
      {#if stage.xp.mastery}
        <div data-stage-mastery>
          <dt>{t('mission.stage.mastery')}</dt>
          <dd><EntityLink kind="technique" id={stage.xp.mastery} /></dd>
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
    {#if stage.chance < 1 && formatDuration(stage.expectedMs) !== formatDuration(stage.ms)}
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

  /* A way with a tree of conditions takes the whole line, so that the tree is not squeezed beside its tags. */
  .what.tree {
    flex-basis: 100%;
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

  .study {
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
