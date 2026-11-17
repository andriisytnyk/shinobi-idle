<script lang="ts">
  import { cellInfo, hexInfo, travelPlan, type CellInfo, type HexInfo } from '@shinobi/core';
  import { entityDesc } from '../lib/entities.ts';
  import { formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { autoState } from '../lib/hex-map.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { skillByActivity } from '../lib/vocab.ts';
  import { keyIcon, keyNameKey, uniqueReq } from '../lib/world.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import AutoSurveyButton from './AutoSurveyButton.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import PoiRow from './PoiRow.svelte';
  import ReqTree from './ReqTree.svelte';
  import TimeBar from './TimeBar.svelte';
  import { IDLE_TIMING, slotTiming } from '../lib/timing.ts';

  const content = game.content;

  interface Props {
    /** The hex, as `"q,r"`. */
    coord: string;
    onClose?: () => void;
  }

  let { coord, onClose }: Props = $props();

  const scoutSkill = skillByActivity(content, 'map') ?? '';

  interface View {
    info: HexInfo;
    cell: CellInfo | null;
    travel: { blocked: string | null; hexes: number; ms: number };
    exploreSlot: number;
    walkSlot: number;
    timing: ReturnType<typeof slotTiming>;
    autoWhy: string | null;
    /** Surveys of the next level of this hex; null at the top. */
    nextAt: number | null;
  }

  const view = $derived(
    game.read((gs): View | null => {
      const info = hexInfo(gs, coord, content, game.rules);
      if (!info) return null;
      const cell = info.cell ? cellInfo(gs, info.cell, content, game.rules) : null;
      const plan = travelPlan(gs, info.address, content, game.rules);
      const K = content.balance.K;
      const thresholds = info.cell ? K.cellExplores : K.map.plainSurvey;
      const exploreSlot = gs.slots.findIndex(
        (s) => s.action?.kind === 'explore' && s.action.id === info.address,
      );
      return {
        info,
        cell,
        travel: { blocked: plan.blocked, hexes: plan.hexes.length, ms: plan.ms },
        exploreSlot,
        walkSlot: gs.slots.findIndex(
          (s) => s.action?.kind === 'walk' && s.action.id === info.address,
        ),
        timing: exploreSlot >= 0 ? slotTiming(gs, exploreSlot, info.surveyMs) : IDLE_TIMING,
        autoWhy: autoState(gs, content).why,
        nextAt: info.level >= info.maxLevel ? null : (thresholds[info.level] ?? null),
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

  const survey = () =>
    void game.dispatch({ type: 'action.start', slot: 0, kind: 'explore', id: info?.address ?? '' });
  const stop = (slot: number) => void game.dispatch({ type: 'action.stop', slot });
  const go = () => void game.dispatch({ type: 'world.travel', cell: info?.address ?? '', slot: 0 });
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
      {#if onClose}
        <button type="button" class="close" aria-label={t('map.panel.close')} onclick={onClose}>
          <Icon name="lucide:x" size={18} />
        </button>
      {/if}
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
        {#if cell?.req && view.nextAt !== null && info.level >= 1}
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
        {#if view.exploreSlot >= 0}<p class="small dim">{t('map.running.survey')}</p>{/if}
        {#if view.timing.running}<TimeBar timing={view.timing} part="action-progress" />{/if}
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
          <button
            type="button"
            class="action"
            data-explore
            disabled={reasonSurvey !== null}
            aria-describedby={reasonSurvey ? 'why-explore' : undefined}
            onclick={survey}
          >
            {t('map.act.survey')}
          </button>
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
          <button
            type="button"
            class="action"
            data-travel-walk
            disabled={reasonGo !== null}
            aria-describedby={reasonGo ? 'why-walk' : undefined}
            onclick={go}
          >
            {t('map.act.go')}{view.travel.ms > 0 ? ` · ${formatDuration(view.travel.ms)}` : ''}
          </button>
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

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .why {
    margin: var(--space-1) 0 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
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
