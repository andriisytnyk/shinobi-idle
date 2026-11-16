<script lang="ts">
  import { cellInfo, travelBlocked, walkMs, type CellInfo } from '@shinobi/core';
  import { entityDesc } from '../lib/entities.ts';
  import { formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { skillByActivity } from '../lib/vocab.ts';
  import { keyIcon, keyNameKey, uniqueReq } from '../lib/world.ts';
  import { IDLE_TIMING, slotTiming } from '../lib/timing.ts';
  import PoiRow from './PoiRow.svelte';
  import RegionEntry from './RegionEntry.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import ReqTree from './ReqTree.svelte';
  import TimeBar from './TimeBar.svelte';

  const content = game.content;

  interface Props {
    id: string;
    onClose?: () => void;
  }

  let { id, onClose }: Props = $props();

  /** The skill that explores: the one whose activity is the map. */
  const scoutSkill = skillByActivity(content, 'map') ?? '';
  const cell = $derived(content.cells.find((c) => c.id === id));
  const info = $derived(game.read((gs): CellInfo | null => cellInfo(gs, id, content, game.rules)));

  /** Slots busy with this cell: exploring it, or walking to it. */
  const busy = $derived(
    game.read((gs) => ({
      explore: gs.slots.findIndex((s) => s.action?.kind === 'explore' && s.action.id === id),
      walk: gs.slots.findIndex((s) => s.action?.kind === 'walk' && s.action.id === id),
    })),
  );

  const travel = $derived(
    game.read((gs) => {
      const target = content.cells.find((c) => c.id === id);
      if (!target) return null;
      return {
        blocked: travelBlocked(gs, id, content),
        walkMs: walkMs(gs, target, content, game.rules),
      };
    }),
  );

  /** The cycle of the exploring or the walk that is busy with this cell. */
  const cycle = $derived(
    game.read((gs) => {
      if (busy.explore >= 0 && info) return slotTiming(gs, busy.explore, info.intervalMs);
      if (busy.walk >= 0 && travel) return slotTiming(gs, busy.walk, travel.walkMs, false);
      return IDLE_TIMING;
    }),
  );

  const explored = $derived((info?.level ?? 0) >= 1);
  const desc = $derived(explored ? entityDesc({ kind: 'cell', id }) : null);
  /** Points of interest the player has found; the rest stay hidden. */
  const found = $derived(
    explored ? (cell?.pois ?? []).filter((p) => info?.pois.find((i) => i.id === p.id)?.found) : [],
  );
  const state = (poiId: string) => info?.pois.find((p) => p.id === poiId);
  /** Found caches and vaults not yet emptied; their claim buttons sit in the action row. */
  const claimable = $derived(
    found.filter((p) => (p.kind === 'cache' || p.kind === 'vault') && !state(p.id)?.claimed),
  );

  const reasonExplore = $derived(busy.explore >= 0 ? null : (info?.why ?? null));
  const reasonWalk = $derived(travel?.blocked ?? null);

  const explore = () => void game.dispatch({ type: 'action.start', slot: 0, kind: 'explore', id });
  const stop = (slot: number) => void game.dispatch({ type: 'action.stop', slot });
  const go = () => void game.dispatch({ type: 'world.travel', cell: id, slot: 0 });
  const claim = (poi: string) => void game.dispatch({ type: 'world.claim', poi });
</script>

{#if cell && info}
  <article class="panel" data-cell-panel={id} aria-label={t('world.panel.label')}>
    <header class="head">
      <div>
        <p class="region"><EntityLink kind="region" id={cell.region} /></p>
        <h2 data-cell-title><EntityLink kind="cell" {id} /></h2>
        <p class="lvl" data-cell-level>
          {t('world.panel.level', { n: info.level, max: info.maxLevel })}
        </p>
      </div>
      {#if onClose}
        <button type="button" class="close" aria-label={t('world.panel.close')} onclick={onClose}>
          <Icon name="lucide:x" size={18} />
        </button>
      {/if}
    </header>

    <div class="body">
      <div class="badges">
        {#if info.located}
          <span class="badge here" data-here
            ><Icon name="lucide:map-pin" size={14} />{t('world.tile.here')}</span
          >
        {/if}
        {#if info.key}
          <span class="badge" data-key={info.key}>
            <Icon name={keyIcon(info.key)} size={14} />{t(keyNameKey(info.key))}
          </span>
        {/if}
      </div>

      {#if desc}<p class="desc">{desc}</p>{:else if !explored}<p class="desc dim">
          {t('world.panel.unexplored')}
        </p>{/if}

      {#if info.why === 'error.outOfRange'}<RegionEntry region={cell.region} />{/if}

      <section class="block" data-level-block>
        {#if info.nextAt !== null}
          <div
            class="bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(info.progress * 100)}
            aria-label={t('world.panel.progress', { n: info.explores, total: info.nextAt })}
          >
            <span class="fill" style:width="{Math.round(info.progress * 100)}%"></span>
          </div>
          <p class="small dim">
            {t('world.panel.progress', {
              n: formatInt(info.explores),
              total: formatInt(info.nextAt),
            })}
          </p>
        {:else}
          <p class="small dim">{t('world.panel.maxed')}</p>
        {/if}
        {#if info.req}
          <div data-req data-key-req={info.key ?? undefined}>
            <p class="small dim">{t('world.panel.next')}</p>
            {#if info.key}
              <p class="small">
                <Icon name="lucide:lock" size={14} />
                {t('world.panel.keyLine', { name: t(keyNameKey(info.key)) })}
              </p>
            {/if}
            <ReqTree node={uniqueReq(info.req)} />
          </div>
        {/if}
        <dl class="facts">
          <div>
            <dt>{t('world.panel.time')}</dt>
            <dd>
              <ModBreakdown keys={['interval.explore']} display={formatDuration(info.intervalMs)} />
            </dd>
          </div>
          <div>
            <dt>{t('world.panel.xp')}</dt>
            <dd>
              <ModBreakdown
                keys={['xp.all', `xp.skill.${scoutSkill}`]}
                display={t('tile.xphValue', { n: formatXp(info.xpPerHour) })}
              />
            </dd>
          </div>
        </dl>
        <p class="small dim">
          {t('world.panel.intel', { n: content.balance.K.intel.perCellLevel })}
        </p>

        {#if busy.explore >= 0}<p class="small dim">{t('world.explore.running')}</p>{/if}
        {#if cycle.running}<TimeBar timing={cycle} part="action-progress" />{/if}
      </section>

      {#if explored}
        <section class="block" data-pois>
          <h3>{t('world.poi.title')}</h3>
          {#if found.length === 0}
            <p class="small dim">{t('world.poi.none')}</p>
          {/if}
          <ul class="poi-list">
            {#each found as poi (poi.id)}
              <PoiRow {poi} cell={id} />
            {/each}
          </ul>
        </section>
      {/if}
    </div>

    <div class="actions" data-actions>
      <div class="buttons">
        {#if busy.explore >= 0}
          <button
            type="button"
            class="action stop"
            data-explore-stop
            onclick={() => stop(busy.explore)}
          >
            {t('world.explore.stop')}
          </button>
        {:else}
          <button
            type="button"
            class="action"
            data-explore
            disabled={reasonExplore !== null}
            aria-describedby={reasonExplore ? `why-explore-${id}` : undefined}
            onclick={explore}
          >
            {t('world.explore.short')}
          </button>
        {/if}
        {#if travel}
          {#if busy.walk >= 0}
            <button
              type="button"
              class="action stop"
              data-walk-stop
              onclick={() => stop(busy.walk)}
            >
              {t('now.stop')}
            </button>
          {:else}
            <button
              type="button"
              class="action"
              data-travel-walk
              disabled={reasonWalk !== null}
              aria-describedby={reasonWalk ? `why-walk-${id}` : undefined}
              title={t('world.travel.walk')}
              onclick={go}
            >
              {t('world.travel.walkShort')} · {formatDuration(travel.walkMs)}
            </button>
          {/if}
        {/if}
        {#each claimable as poi (poi.id)}
          <button
            type="button"
            class="action"
            data-claim={poi.id}
            disabled={!info.located}
            aria-describedby={info.located ? undefined : `why-claim-${poi.id}`}
            onclick={() => claim(poi.id)}
          >
            {t('world.poi.claim')}
          </button>
        {/each}
      </div>
      <ul class="reasons">
        {#if reasonExplore}<li class="why" id="why-explore-{id}" data-why="explore">
            {t(reasonExplore)}
          </li>{/if}
        {#if reasonWalk}<li class="why" id="why-walk-{id}" data-why="walk">{t(reasonWalk)}</li>{/if}
        {#if !info.located}
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

  .actions .action {
    --_flex: 6.5rem;
    flex: 1 1 var(--_flex);
    padding-inline: var(--space-2);
  }

  .region {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
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
