<script lang="ts">
  import {
    AUTOSURVEY_KIND,
    autoPlan,
    cellInfo,
    hexInfo,
    travelPlan,
    type CellInfo,
    type HexInfo,
  } from '@shinobi/core';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { autoState } from '../lib/hex-map.ts';
  import { t } from '../lib/i18n.ts';
  import { firstUnmetPart } from '../lib/req-rows.ts';
  import { performersOf } from '../lib/squad.ts';
  import { squadUi } from '../lib/squad-ui.svelte.ts';
  import { game } from '../lib/store.ts';
  import { IDLE_TIMING, slotTiming } from '../lib/timing.ts';
  import { uniqueReq } from '../lib/world.ts';
  import { AUTOSURVEY_ID } from '@shinobi/core';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import PointModal from './PointModal.svelte';
  import ReqTree from './ReqTree.svelte';
  import StartSplit from './StartSplit.svelte';

  const content = game.content;

  interface Props {
    /** The hex, as `"q,r"`. */
    coord: string;
    onClose: () => void;
    /** Opens the full information of the hex. */
    onDetails: () => void;
  }

  let { coord, onClose, onDetails }: Props = $props();

  interface View {
    info: HexInfo;
    cell: CellInfo | null;
    travel: ReturnType<typeof travelPlan>;
    exploreSlot: number;
    autoSlot: number;
    walkSlot: number;
    timing: ReturnType<typeof slotTiming>;
    autoWhy: string | null;
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
      const travel = travelPlan(gs, info.address, content, game.rules, viewSlot);
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
        travel,
        exploreSlot,
        autoSlot,
        walkSlot: gs.slots.findIndex(
          (s) => s.action?.kind === 'walk' && s.action.id === info.address,
        ),
        timing: surveySlot >= 0 ? slotTiming(gs, surveySlot, info.surveyMs) : IDLE_TIMING,
        autoWhy: autoState(gs, content).why,
      };
    }),
  );

  const info = $derived(view?.info ?? null);
  const cell = $derived(view?.cell ?? null);
  const fog = $derived(info !== null && !info.surveyed);
  const cellEntity = $derived(info?.cell ?? null);
  const regionOfCell = $derived(
    cellEntity ? (content.cells.find((c) => c.id === cellEntity)?.region ?? null) : null,
  );
  const title = $derived.by(() => {
    if (!info) return '';
    if (info.places.length > 0) return info.places.map((p) => t(`place.${p}.name`)).join(', ');
    return info.terrain ? t(`terrain.${info.terrain}.name`) : t('map.hex.fog');
  });

  /** The first requirement of the cell that is not met, as one row; nothing when all hold. */
  const unmet = $derived(
    cell?.req && view?.exploreSlot === -1 ? firstUnmetPart(uniqueReq(cell.req)) : null,
  );
  const reasonSurvey = $derived.by(() => {
    if (!view || view.exploreSlot >= 0 || !info) return null;
    if (cell) return cell.why;
    return fog && info.surveyWhy === 'error.scoutLevelLow' ? 'map.why.fog' : info.surveyWhy;
  });
  const reasonGo = $derived(view?.travel.blocked ?? null);
  const reasonPaid = $derived(
    view && view.travel.blocked === null && !info?.here ? view.travel.paidBlocked : null,
  );
  const travel = (mode: 'walk' | 'paid' | 'outpost') => (p: { slot: number }) =>
    game.dispatch({ type: 'world.travel', cell: info?.address ?? '', mode, slot: p.slot });
  const stop = (slot: number) => void game.dispatch({ type: 'action.stop', slot });
  const autoOn = $derived(game.read((gs) => autoState(gs, content).slot));

  /** The found point of interest of this hex, if any: the first one the player can name. */
  const point = $derived(
    info?.points.find((p) => p.place !== null && (p.status === 'found' || p.status === 'open')) ??
      null,
  );
  let pointOpen = $state(false);
  /** The text of a disabled action, for its `title`. */
  const why = (key: string | null, params: Record<string, number> = {}): string | undefined =>
    key ? t(key, params) : undefined;
</script>

{#if view && info}
  <article class="card" data-ui="hex-card" data-hex-card={coord} aria-label={t('map.panel.label')}>
    <header class="head">
      <div class="names">
        <p class="sub" data-hex-sub>
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
      </div>
      <button type="button" class="close" aria-label={t('map.panel.close')} onclick={onClose}>
        <Icon name="lucide:x" size={16} />
      </button>
    </header>

    <p class="lvl" data-hex-level>
      {#if fog}
        {t('map.panel.notSurveyed')}
      {:else}
        <span class="pips" aria-hidden="true">
          {#each { length: info.maxLevel } as _, i (i)}<span class="pip" class:on={i < info.level}
            ></span>{/each}
        </span>
        <span>{t('map.card.level', { n: info.level, max: info.maxLevel })}</span>
      {/if}
      {#if info.here}<span class="here" data-here>· {t('map.here')}</span>{/if}
    </p>

    {#if unmet}
      <div class="need" data-card-need>
        <span>{t('map.card.need')}</span><ReqTree node={unmet} />
      </div>
    {/if}

    {#if view.timing.running}
      <div
        class="bar"
        role="progressbar"
        aria-label={t('map.surveyProgress')}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(view.timing.fraction * 100)}
        data-survey-bar
      >
        <span class="fill" style:width="{Math.round(view.timing.fraction * 100)}%"></span>
      </div>
    {/if}

    {#if view.travel.hexes.length > 0 && !info.here}
      <p class="route" data-route-line>
        {t('map.card.route', {
          n: view.travel.hexes.length,
          time: formatDuration(view.travel.ms),
        })}
      </p>
    {/if}

    {#if point}
      <p class="find" data-card-point>
        <Icon name={point.travel !== null ? 'lucide:footprints' : 'lucide:landmark'} size={14} />
        <span class="find-name">{t(`place.${point.place}.name`)}</span>
        <button type="button" class="mini" data-card-find onclick={() => (pointOpen = true)}
          >{t('map.card.find')}</button
        >
      </p>
    {/if}

    <div class="actions" data-actions>
      {#if view.exploreSlot >= 0}
        <button
          type="button"
          class="action stop"
          data-explore-stop
          onclick={() => stop(view.exploreSlot)}>{t('map.act.surveyStop')}</button
        >
      {:else}
        <StartSplit
          kind="explore"
          id={info.address}
          label="map.act.survey"
          disabled={reasonSurvey !== null}
          title={why(reasonSurvey)}
          mark="explore"
        />
      {/if}
      {#if autoOn >= 0}
        <button type="button" class="action stop" data-auto-stop onclick={() => stop(autoOn)}
          >{t('map.card.autoStop')}</button
        >
      {:else}
        <StartSplit
          kind={AUTOSURVEY_KIND}
          id={AUTOSURVEY_ID}
          label="map.card.auto"
          disabled={view.autoWhy !== null}
          title={why(view.autoWhy)}
          mark="auto"
        />
      {/if}
      {#if view.walkSlot >= 0}
        <button type="button" class="action stop" data-walk-stop onclick={() => stop(view.walkSlot)}
          >{t('now.stop')}</button
        >
      {:else if !info.here}
        <StartSplit
          kind="walk"
          id={info.address}
          label="map.act.walk"
          suffix={view.travel.ms > 0 ? formatDuration(view.travel.ms) : ''}
          disabled={reasonGo !== null}
          title={why(reasonGo)}
          run={travel('walk')}
          mark="travel-walk"
        />
        <StartSplit
          kind="travel-paid"
          id={info.address}
          label="map.act.paid"
          suffix={view.travel.price !== null ? formatInt(view.travel.price) : ''}
          disabled={view.travel.paidBlocked !== null}
          title={why(reasonPaid, { price: view.travel.price ?? 0 })}
          run={travel('paid')}
          mark="travel-paid"
        />
        {#if view.travel.free}
          <StartSplit
            kind="travel-free"
            id={info.address}
            label="map.act.free"
            run={travel('outpost')}
            mark="travel-free"
          />
        {/if}
      {/if}
      <button type="button" class="action details" data-hex-details onclick={onDetails}
        ><Icon name="lucide:info" size={14} /> {t('map.card.details')}</button
      >
    </div>
  </article>
  {#if pointOpen && point && point.place}
    <PointModal
      place={point.place}
      reward={point.reward ?? null}
      power={point.power}
      title={t(`place.${point.place}.name`)}
      onClose={() => (pointOpen = false)}
    />
  {/if}
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    font-size: var(--text-sm);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .names {
    min-width: 0;
  }

  .sub,
  h2 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  h2 {
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg);
    cursor: pointer;
  }

  .lvl,
  .route,
  .find {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .pips {
    display: inline-flex;
    gap: var(--space-1);
  }

  .pip {
    --_pip: 0.5rem;
    width: var(--_pip);
    height: var(--_pip);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-pill);
  }

  .pip.on {
    background: var(--accent);
  }

  .need {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }

  .bar {
    height: var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--surface);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .find-name {
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mini {
    margin-inline-start: auto;
    min-height: var(--control-xs);
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
  }

  .actions {
    --_btn-min: 8.5rem;
  }

  .actions :global(.split),
  .details {
    flex: 1 1 var(--_btn-min);
    min-width: var(--_btn-min);
  }

  /* Every action is one short line: the label is cut with an ellipsis, the reason is in the title. */
  .actions :global(.action) {
    --_flex: 5rem;
    min-height: var(--control-sm);
    padding-inline: var(--space-2);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .action.stop,
  .action.details {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
</style>
