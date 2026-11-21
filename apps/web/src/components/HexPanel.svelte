<script lang="ts">
  import {
    AUTOSURVEY_KIND,
    autoPlan,
    cellInfo,
    hexDistance,
    hexInfo,
    travelPlan,
    type CellInfo,
    type HexInfo,
  } from '@shinobi/core';
  import { entityDesc } from '../lib/entities.ts';
  import { formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { autoState } from '../lib/hex-map.ts';
  import { t } from '../lib/i18n.ts';
  import { performersOf } from '../lib/squad.ts';
  import { squadUi } from '../lib/squad-ui.svelte.ts';
  import { game } from '../lib/store.ts';
  import { skillByActivity } from '../lib/vocab.ts';
  import { moneyName } from '../lib/vocab.ts';
  import { keyIcon, keyNameKey, uniqueReq } from '../lib/world.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import AutoSurveyButton from './AutoSurveyButton.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import ModLine from './ModLine.svelte';
  import PoiRow from './PoiRow.svelte';
  import ReqTree from './ReqTree.svelte';
  import StartSplit from './StartSplit.svelte';
  import RewardList from './RewardList.svelte';
  import TimeBar from './TimeBar.svelte';
  import { IDLE_TIMING, slotTiming } from '../lib/timing.ts';

  const content = game.content;

  interface Props {
    /** The hex, as `"q,r"`. */
    coord: string;
    /** Shown in a bottom sheet: the actions come right after the header, so that they stay in view. */
    sheet?: boolean;
    /** The sheet is opened wide (only in a sheet). */
    expanded?: boolean;
    onToggle?: () => void;
    onClose?: () => void;
  }

  let { coord, sheet = false, expanded = false, onToggle, onClose }: Props = $props();

  const scoutSkill = skillByActivity(content, 'map') ?? '';

  interface View {
    info: HexInfo;
    cell: CellInfo | null;
    travel: {
      blocked: string | null;
      hexes: number;
      ms: number;
      /** The price of the same trip made at once, in ryo; null when there is no route. */
      price: number | null;
      /** Why the trip for ryo cannot be made; null when it can. */
      paidBlocked: string | null;
      /** Whether the trip is free and at once: the performer stands on a found outpost and the target is one of its group. */
      free: boolean;
    };
    exploreSlot: number;
    /** The slot whose auto-survey is surveying this very hex now; -1 when none is. */
    autoSlot: number;
    walkSlot: number;
    timing: ReturnType<typeof slotTiming>;
    autoWhy: string | null;
    /** Surveys of the next level of this hex; null at the top. */
    nextAt: number | null;
  }

  /** The action slot of the performer picked on the map or in the squad; the character's when none is. */
  const viewSlot = $derived(
    game.read(
      (gs) => performersOf(gs, content, game.rules).find((p) => p.id === squadUi.picked)?.slot ?? 0,
    ),
  );

  const view = $derived(
    game.read((gs): View | null => {
      const info = hexInfo(gs, coord, content, game.rules, undefined, viewSlot);
      if (!info) return null;
      const cell = info.cell ? cellInfo(gs, info.cell, content, game.rules) : null;
      const plan = travelPlan(gs, info.address, content, game.rules, viewSlot);
      const K = content.balance.K;
      const thresholds = info.cell ? K.cellExplores : K.map.plainSurvey;
      const exploreSlot = gs.slots.findIndex(
        (s) => s.action?.kind === 'explore' && s.action.id === info.address,
      );
      const autoSlot = gs.slots.findIndex((s, i) => {
        if (s.action?.kind !== AUTOSURVEY_KIND) return false;
        const plan = autoPlan(gs, content, i);
        return plan !== null && plan.route.length === 0 && plan.subject.address === info.address;
      });
      const surveySlot = exploreSlot >= 0 ? exploreSlot : autoSlot;
      return {
        info,
        cell,
        autoSlot,
        travel: {
          blocked: plan.blocked,
          hexes: plan.hexes.length,
          ms: plan.ms,
          price: plan.price,
          paidBlocked: plan.paidBlocked,
          free: plan.free,
        },
        exploreSlot,
        walkSlot: gs.slots.findIndex(
          (s) => s.action?.kind === 'walk' && s.action.id === info.address,
        ),
        timing: surveySlot >= 0 ? slotTiming(gs, surveySlot, info.surveyMs) : IDLE_TIMING,
        autoWhy: autoState(gs, content).why,
        // In fog nothing is said of levels or counts: they would tell a cell from a plain hex.
        nextAt:
          !info.surveyed || info.level >= info.maxLevel ? null : (thresholds[info.level] ?? null),
      };
    }),
  );

  const info = $derived(view?.info ?? null);
  const cell = $derived(view?.cell ?? null);
  const fog = $derived(info !== null && !info.surveyed);
  const cellEntity = $derived(info?.cell ?? null);
  /**
   * A plain hex of the start zone (within `startRadius` of where the story begins) starts with the
   * surveys of its first level: the rule of the world, said in the panel so that «6 з 18» is not a mystery.
   */
  const startZone = $derived.by(() => {
    if (!info || info.cell || info.level < 1) return false;
    const first = content.balance.K.map.plainSurvey[0] ?? 0;
    if (info.explores !== first) return false;
    const home =
      content.cells.find((c) => c.id === content.regions[0]?.cells[0]) ?? content.cells[0];
    return (
      home !== undefined &&
      hexDistance({ q: home.hex[0], r: home.hex[1] }, { q: info.q, r: info.r }) <=
        content.balance.K.map.startRadius
    );
  });
  const regionOfCell = $derived(
    cellEntity ? (content.cells.find((c) => c.id === cellEntity)?.region ?? null) : null,
  );
  const desc = $derived(
    cellEntity && (info?.level ?? 0) >= 1 ? entityDesc({ kind: 'cell', id: cellEntity }) : null,
  );

  /** The points of interest the player found here. */
  const found = $derived(
    (cellEntity ? (content.cells.find((c) => c.id === cellEntity)?.pois ?? []) : []).filter(
      (p) => cell?.pois.find((i) => i.id === p.id)?.found,
    ),
  );
  const claimable = $derived(
    found.filter(
      (p) =>
        (p.kind === 'cache' || p.kind === 'vault') &&
        !cell?.pois.find((i) => i.id === p.id)?.claimed,
    ),
  );

  /**
   * Why the hex cannot be surveyed. A cell says which of its requirements fails (region, key, level);
   * a hex still in fog says only that something is missing, so that the fog gives nothing away.
   */
  const reasonSurvey = $derived.by(() => {
    if (!view || view.exploreSlot >= 0 || !info) return null;
    if (cell) return cell.why;
    return fog && info.surveyWhy === 'error.scoutLevelLow' ? 'map.why.fog' : info.surveyWhy;
  });
  const reasonGo = $derived(view?.travel.blocked ?? null);

  /** What the next level of this hex gives, as one line. */
  const nextLine = $derived.by(() => {
    if (!info) return null;
    if (fog) return 'map.next.fog';
    if (info.level >= info.maxLevel && info.maxLevel > 0) return 'map.next.max';
    if (info.cell) return info.level === 0 ? 'map.next.cell0' : null;
    return 'map.next.plain';
  });

  const stop = (slot: number) => void game.dispatch({ type: 'action.stop', slot });
  /** The trip the performer makes: on foot, for ryo, or free from an outpost. */
  const travel = (mode: 'walk' | 'paid' | 'outpost') => (p: { slot: number }) =>
    game.dispatch({ type: 'world.travel', cell: info?.address ?? '', mode, slot: p.slot });
  /** Why the trip for ryo cannot be made, when the trip on foot can: it is said beside the button. */
  const reasonPaid = $derived(
    view && view.travel.blocked === null && !info?.here ? view.travel.paidBlocked : null,
  );
  const claim = (poi: string) => void game.dispatch({ type: 'world.claim', poi });

  const title = $derived.by(() => {
    if (!info) return '';
    if (info.places.length > 0) return info.places.map((p) => t(`place.${p}.name`)).join(', ');
    return info.terrain ? t(`terrain.${info.terrain}.name`) : t('map.hex.fog');
  });
</script>

{#if view && info}
  <article
    class="panel"
    class:sheet
    data-ui="hex-panel"
    data-hex-panel={coord}
    aria-label={t('map.panel.label')}
  >
    <header class="head">
      <div>
        <p class="sub">
          {#if info.country}{t(`country.${info.country}.name`)}{:else}{t(
              'map.panel.unknownLand',
            )}{/if}
          {#if regionOfCell}
            · <EntityLink kind="region" id={regionOfCell} />
          {/if}
        </p>
        <h2 data-hex-title>
          {#if cellEntity}<EntityLink kind="cell" id={cellEntity} />{:else}{title}{/if}
        </h2>
        <p class="lvl" data-hex-level>
          {#if fog}{t('map.panel.notSurveyed')}{:else}{t('map.panel.level', {
              n: info.level,
              max: info.maxLevel,
            })}{/if}
        </p>
      </div>
      <div class="head-buttons">
        {#if sheet && onToggle}
          <button
            type="button"
            class="close"
            data-sheet-toggle
            aria-expanded={expanded}
            aria-label={t(expanded ? 'map.panel.collapse' : 'map.panel.expand')}
            onclick={onToggle}
          >
            <Icon name={expanded ? 'lucide:chevron-down' : 'lucide:chevron-up'} size={18} />
          </button>
        {/if}
        {#if onClose}
          <button type="button" class="close" aria-label={t('map.panel.close')} onclick={onClose}>
            <Icon name="lucide:x" size={18} />
          </button>
        {/if}
      </div>
    </header>

    <div class="body">
      <div class="badges">
        {#if info.here}
          <span class="badge here" data-here
            ><Icon name="lucide:map-pin" size={14} />{t('map.here')}</span
          >
        {/if}
        {#if info.terrain}
          <span class="badge" data-terrain={info.terrain}>
            {t(`terrain.${info.terrain}.name`)}
          </span>
        {/if}
        {#if cell?.key}
          <span class="badge" data-key={cell.key}>
            <Icon name={keyIcon(cell.key)} size={14} />{t(keyNameKey(cell.key))}
          </span>
        {/if}
      </div>

      {#if fog}
        <p class="desc dim">{t('map.hex.fogDesc')}</p>
      {:else if desc}
        <p class="desc">{desc}</p>
      {/if}

      {#if info.places.length > 0}
        <section class="block" data-places>
          <h3>{t('map.places')}</h3>
          <ul class="places">
            {#each info.places as place (place)}
              <li>
                <p class="place-name">
                  <Icon name="lucide:landmark" size={16} />
                  {t(`place.${place}.name`)}
                </p>
                <p class="small dim">{t(`place.${place}.desc`)}</p>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if info.points.length > 0}
        <section class="block" data-points>
          <h3>{t('map.points')}</h3>
          <ul class="points">
            {#each info.points as point, i (i)}
              <li
                class="point"
                class:active={point.active}
                data-ui="point-row"
                data-point-status={point.status}
                data-point={point.place ?? undefined}
              >
                {#if point.status === 'veiled'}
                  <p class="place-name">
                    <Icon name="lucide:circle-help" size={16} />
                    {t('map.point.veiled')}
                  </p>
                  {#if point.hint}<p class="small dim" data-point-hint>{t(point.hint)}</p>{/if}
                {:else}
                  <p class="place-name">
                    <Icon
                      name={point.travel !== null ? 'lucide:footprints' : 'lucide:landmark'}
                      size={16}
                    />
                    {point.place ? t(`place.${point.place}.name`) : ''}
                  </p>
                  <p class="badges">
                    <span class="badge" data-point-state>{t(`map.point.${point.status}`)}</span>
                    {#if point.travel !== null}
                      <span class="badge" data-point-outpost>{t('map.point.outpost')}</span>
                    {/if}
                    {#if point.power.length > 0}
                      <span class="badge" data-point-power>{t('map.point.power')}</span>
                    {/if}
                    {#if point.active && point.power.length > 0}
                      <span class="badge here" data-point-active>{t('map.point.active')}</span>
                    {/if}
                  </p>
                  {#if point.power.length > 0}
                    <p class="small dim">{t('map.point.bonus')}</p>
                    <ul class="mods">
                      {#each point.power as mod, j (j)}
                        <li class="small" data-point-mod><ModLine {mod} /></li>
                      {/each}
                    </ul>
                  {/if}
                  {#if point.travel !== null}
                    <p class="small dim">{t('map.point.outpostHint')}</p>
                  {/if}
                  {#if point.opens.length > 0}
                    <p class="small" data-point-opens>
                      {t('map.point.opens')}
                      {#each point.opens as work, k (work)}{k > 0 ? ', ' : ''}<EntityLink
                          kind="fieldwork"
                          id={work}
                        />{/each}
                    </p>
                  {/if}
                  {#if point.reward}
                    <p class="small" data-point-reward>
                      {t('map.point.reward')}
                      <RewardList
                        money={point.reward.ryo ?? 0}
                        currencies={point.reward.currencies}
                        items={(point.reward.items ?? []).map((i) => ({ id: i.item, n: i.n }))}
                        xp={point.reward.xp ?? null}
                      />
                    </p>
                  {:else}
                    <p class="small dim">{t('map.point.rewardUnknown')}</p>
                  {/if}
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="block" data-level-block>
        {#if view.nextAt !== null}
          {@const total = view.nextAt}
          {@const start = info.level === 0 ? 0 : (cell?.levelStart ?? 0)}
          {@const share =
            total > start ? Math.max(0, Math.min(1, (info.explores - start) / (total - start))) : 0}
          <div
            class="bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(share * 100)}
            aria-label={t('world.panel.progress', { n: info.explores, total })}
          >
            <span class="fill" style:width="{Math.round(share * 100)}%"></span>
          </div>
          <p class="small dim">
            {t('world.panel.progress', { n: formatInt(info.explores), total: formatInt(total) })}
          </p>
        {/if}
        {#if nextLine}<p class="small" data-next={nextLine}>{t(nextLine)}</p>{/if}
        {#if cell && info.level >= 1 && view.nextAt !== null}
          <p class="small dim">
            {t('world.panel.intel', { n: content.balance.K.intel.perCellLevel })}
          </p>
        {/if}
        {#if cell?.req && view.nextAt !== null}
          <div data-req data-key-req={cell.key ?? undefined}>
            <p class="small dim">{t('world.panel.next')}</p>
            <ReqTree node={uniqueReq(cell.req)} />
          </div>
        {/if}
        {#if info.surveyMs > 0 || view.exploreSlot >= 0}
          <dl class="facts">
            <div>
              <dt>{t('world.panel.time')}</dt>
              <dd>
                <ModBreakdown
                  keys={['interval.explore']}
                  display={formatDuration(info.surveyMs || (cell?.intervalMs ?? 0))}
                />
              </dd>
            </div>
            {#if cell}
              <div>
                <dt>{t('world.panel.xp')}</dt>
                <dd>
                  <ModBreakdown
                    keys={['xp.all', `xp.skill.${scoutSkill}`]}
                    display={t('tile.xphValue', { n: formatXp(cell.xpPerHour) })}
                  />
                </dd>
              </div>
            {/if}
          </dl>
        {/if}
        {#if view.exploreSlot >= 0}<p class="small dim" data-surveying-now>
            {t('map.running.survey')}
          </p>{:else if view.autoSlot >= 0}<p class="small dim" data-surveying-now>
            {t('map.running.auto')}
          </p>{/if}
        {#if view.timing.running}
          <TimeBar
            timing={view.timing}
            part="action-progress"
            size="md"
            label={t('map.surveyProgress')}
          />
          <p class="small dim" data-survey-left>
            {t('map.surveyLeft', {
              time: formatDuration(view.timing.cycleMs * (1 - view.timing.fraction)),
            })}
          </p>
        {/if}
        {#if startZone}<p class="small dim" data-start-zone>
            {t('map.startZone', { n: formatInt(info.explores) })}
          </p>{/if}
        {#if view.walkSlot >= 0}<p class="small dim" data-walking>{t('map.running.walk')}</p>{/if}
      </section>

      {#if cellEntity && info.level >= 1}
        <section class="block" data-pois>
          <h3>{t('world.poi.title')}</h3>
          {#if found.length === 0}
            <p class="small dim">{t('world.poi.none')}</p>
          {/if}
          <ul class="poi-list">
            {#each found as poi (poi.id)}
              <PoiRow {poi} cell={cellEntity} />
            {/each}
          </ul>
        </section>
      {/if}

      <p class="small dim" data-auto-help>{t('map.auto.help')}</p>

      <Slot name="map.panel" ctx={{ hex: coord, cell: info.cell }} />
    </div>

    <div class="actions" data-actions>
      <div class="buttons">
        {#if view.exploreSlot >= 0}
          <button
            type="button"
            class="action stop"
            data-explore-stop
            onclick={() => stop(view.exploreSlot)}
          >
            {t('map.act.surveyStop')}
          </button>
        {:else}
          <StartSplit
            kind="explore"
            id={info.address}
            label="map.act.survey"
            disabled={reasonSurvey !== null}
            describedBy={reasonSurvey ? 'why-explore' : undefined}
            mark="explore"
            wrap
          />
        {/if}
        {#if view.walkSlot >= 0}
          <button
            type="button"
            class="action stop"
            data-walk-stop
            onclick={() => stop(view.walkSlot)}
          >
            {t('now.stop')}
          </button>
        {:else if !info.here}
          <StartSplit
            kind="walk"
            id={info.address}
            label="map.act.walk"
            suffix={view.travel.ms > 0 ? formatDuration(view.travel.ms) : ''}
            disabled={reasonGo !== null}
            describedBy={reasonGo ? 'why-walk' : undefined}
            run={travel('walk')}
            mark="travel-walk"
            wrap
          />
          <StartSplit
            kind="travel-paid"
            id={info.address}
            label="map.act.paid"
            suffix={view.travel.price !== null
              ? `${formatInt(view.travel.price)} ${moneyName(content)}`
              : ''}
            disabled={view.travel.paidBlocked !== null}
            describedBy={reasonPaid ? 'why-paid' : undefined}
            run={travel('paid')}
            mark="travel-paid"
            wrap
          />
          {#if view.travel.free}
            <StartSplit
              kind="travel-free"
              id={info.address}
              label="map.act.free"
              run={travel('outpost')}
              mark="travel-free"
              wrap
            />
          {/if}
        {/if}
        <AutoSurveyButton whyId="why-auto" />
        {#each claimable as poi (poi.id)}
          <button
            type="button"
            class="action"
            data-claim={poi.id}
            disabled={!info.here}
            aria-describedby={info.here ? undefined : `why-claim-${poi.id}`}
            onclick={() => claim(poi.id)}
          >
            {t('world.poi.claim')}
          </button>
        {/each}
      </div>
      <ul class="reasons">
        {#if reasonSurvey}<li class="why" id="why-explore" data-why="explore">
            {t(reasonSurvey)}
          </li>{/if}
        {#if reasonGo && !info.here}<li class="why" id="why-walk" data-why="walk">
            {t(reasonGo)}
          </li>{/if}
        {#if reasonPaid}<li class="why" id="why-paid" data-why="paid">
            {t(reasonPaid, { price: view.travel.price ?? 0 })}
          </li>{/if}
        {#if view.travel.hexes > 0 && !info.here}<li class="route-line" data-route-line>
            {t('map.route', { n: view.travel.hexes, time: formatDuration(view.travel.ms) })}
            {#if view.travel.free}
              · {t('map.route.free')}{/if}
          </li>{/if}
        {#if view.autoWhy}<li class="why" id="why-auto" data-why="auto">{t(view.autoWhy)}</li>{/if}
        {#if !info.here}
          {#each claimable as poi (poi.id)}
            <li class="why" id="why-claim-{poi.id}" data-why="claim">{t('error.notHere')}</li>
          {/each}
        {/if}
      </ul>
    </div>
  </article>
{/if}

<style>
  /* The header and the action row stay in view; only the body scrolls. */
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .head {
    display: flex;
    flex: none;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-thin) solid var(--line);
  }

  .head-buttons {
    display: flex;
    flex: none;
    gap: var(--space-2);
  }

  /* In a sheet the terrain, the level and the actions come first and stay in view; the rest scrolls under them. */
  .panel.sheet .head {
    padding: var(--space-2) var(--space-3);
  }

  .panel.sheet h2 {
    font-size: var(--text-md);
  }

  .panel.sheet .actions {
    order: 2;
    padding: var(--space-2) var(--space-3);
    border-top: 0;
    border-bottom: var(--border-thin) solid var(--line);
  }

  .panel.sheet .body {
    order: 3;
    padding: var(--space-3);
  }

  .panel.sheet .buttons {
    gap: var(--space-2);
  }

  .panel.sheet .actions :global(.action) {
    min-height: var(--control-sm);
    --_flex: 5.5rem;
    padding-inline: var(--space-1);
    font-size: var(--text-sm);
  }

  .sub,
  .lvl {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    padding: var(--space-3) var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .actions {
    flex: none;
    padding: var(--space-2) var(--space-4);
    border-top: var(--border-thin) solid var(--accent);
    background: var(--surface-raised);
  }

  .reasons {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .actions :global(.action) {
    --_flex: 6.5rem;
    flex: 1 1 var(--_flex);
    padding-inline: var(--space-2);
  }

  h2 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    min-width: var(--control-md);
    min-height: var(--control-md);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    cursor: pointer;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .badge {
    --_line-height: 1.6rem;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    line-height: var(--_line-height);
  }

  .badge.here {
    border-color: var(--chakra);
    color: var(--chakra);
  }

  .desc {
    margin: 0;
  }

  .dim {
    color: var(--fg-dim);
  }

  .small {
    margin: var(--space-1) 0;
    font-size: var(--text-xs);
  }

  .block {
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .places {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .place-name {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-weight: 600;
  }

  .bar {
    height: var(--bar-md);
    border-radius: var(--radius-xs);
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .facts {
    display: grid;
    gap: var(--space-1);
    margin: var(--space-2) 0;
  }

  .facts div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-xs);
  }

  .facts dt {
    color: var(--fg-dim);
  }

  .facts dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .action {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .action.stop {
    background: var(--surface-raised);
    color: var(--fg);
  }

  .action:disabled {
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg-dim);
    cursor: not-allowed;
  }

  /* Two columns where they fit, one where they do not: every label is shown in full. */
  .buttons {
    display: grid;
    --_cell: 9rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--_cell)), 1fr));
    gap: var(--space-3);
  }

  .why {
    margin: var(--space-1) 0 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .points {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .point.active {
    padding-left: var(--space-2);
    border-left: var(--border-thick) solid var(--chakra);
  }

  .mods {
    margin: 0;
    padding: 0 0 0 var(--space-4);
  }

  .route-line {
    margin: var(--space-1) 0 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
    list-style: none;
  }

  .poi-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .panel :global(a) {
    color: inherit;
  }

  .panel :global(a:hover) {
    color: var(--accent);
    text-decoration: underline;
  }
</style>
