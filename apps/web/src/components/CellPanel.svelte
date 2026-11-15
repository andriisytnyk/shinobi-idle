<script lang="ts">
  import { content } from '@shinobi/content';
  import {
    cellInfo,
    instantCost,
    travelBlocked,
    travelOptions,
    walkMs,
    zoneAvailable,
    type CellInfo,
  } from '@shinobi/core';
  import { entityDesc } from '../lib/entities.ts';
  import { formatDuration, formatInt, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { KEY_ICON, keyNameKey, POI_ICON, poiKindKey, uniqueReq, zoneOf } from '../lib/world.ts';
  import RegionEntry from './RegionEntry.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    id: string;
    onClose?: () => void;
  }

  let { id, onClose }: Props = $props();

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
      const cost = instantCost(target, content);
      return {
        blocked: travelBlocked(gs, id, content),
        cost,
        // The core says whether the trip can be paid; a cell it cannot reach is refused by `blocked`.
        canAfford:
          travelOptions(gs, content, game.rules).find((o) => o.cell === id)?.canAffordInstant ??
          true,
        walkMs: walkMs(gs, target, content, game.rules),
      };
    }),
  );

  /** Which fight zones of this cell are available now, by zone id. */
  const zones = $derived(
    game.read((gs) =>
      Object.fromEntries(
        (cell?.pois ?? []).flatMap((p) =>
          p.kind === 'zone' ? [[p.zone, zoneAvailable(gs, p.zone, content)] as const] : [],
        ),
      ),
    ),
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
  const reasonInstant = $derived(
    travel === null ? null : (travel.blocked ?? (travel.canAfford ? null : 'error.notEnoughRyo')),
  );
  const reasonWalk = $derived(travel?.blocked ?? null);

  const explore = () => void game.dispatch({ type: 'action.start', slot: 0, kind: 'explore', id });
  const stop = (slot: number) => void game.dispatch({ type: 'action.stop', slot });
  const go = (mode: 'instant' | 'walk') =>
    void game.dispatch({ type: 'world.travel', cell: id, mode, slot: 0 });
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
            <Icon name={KEY_ICON[info.key]} size={14} />{t(keyNameKey(info.key))}
          </span>
        {/if}
      </div>

      {#if desc}<p class="desc">{desc}</p>{:else if !explored}<p class="desc dim">
          {t('world.panel.unexplored')}
        </p>{/if}

      {#if info.why === 'error.notInRegion'}<RegionEntry region={cell.region} />{/if}

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
                keys={['xp.all', 'xp.skill.scout']}
                display={t('tile.xphValue', { n: formatXp(info.xpPerHour) })}
              />
            </dd>
          </div>
        </dl>
        <p class="small dim">
          {t('world.panel.intel', { n: content.balance.K.intel.perCellLevel })}
        </p>

        {#if busy.explore >= 0}<p class="small dim">{t('world.explore.running')}</p>{/if}
      </section>

      {#if explored}
        <section class="block" data-pois>
          <h3>{t('world.poi.title')}</h3>
          {#if found.length === 0}
            <p class="small dim">{t('world.poi.none')}</p>
          {/if}
          <ul class="poi-list">
            {#each found as poi (poi.id)}
              {@const st = state(poi.id)}
              {@const pdesc = entityDesc({ kind: 'poi', id: poi.id })}
              <li
                class="poi"
                data-poi={poi.id}
                data-poi-kind={poi.kind}
                data-ui="poi-row"
                data-entity="poi:{poi.id}"
              >
                <p class="poi-name">
                  <Icon name={POI_ICON[poi.kind]} size={18} />
                  <EntityLink kind="poi" id={poi.id} />
                  <span class="kind">{t(poiKindKey(poi.kind))}</span>
                </p>
                {#if pdesc}<p class="small dim">{pdesc}</p>{/if}

                {#if poi.kind === 'training'}
                  <p class="small">
                    {t('world.poi.trainingBonus', { pct: Math.round(poi.bonus * 100) })}
                    <EntityLink kind="skill" id={poi.skill} />
                  </p>
                  <p class="small" data-training-active={info.located}>
                    {info.located ? t('world.poi.trainingOn') : t('world.poi.trainingOff')}
                  </p>
                {:else if poi.kind === 'zone'}
                  {@const zone = zoneOf(poi)}
                  {#if zone}
                    <p class="small">
                      {t('world.poi.zoneEnemy')}
                      <EntityLink kind="enemy" id={zone.enemy} />
                    </p>
                    <p class="small" data-zone-available={zones[zone.zone] === true}>
                      {zones[zone.zone] ? t('world.where.open') : t('world.where.closed')}
                      <a class="go" href="#/combat">{t('nav.combat')}</a>
                    </p>
                  {/if}
                {:else if poi.kind === 'story'}
                  <p class="small">{t('world.poi.story')}</p>
                {:else if poi.kind === 'deposit'}
                  <p class="small">
                    {t('world.poi.deposit')}
                    <EntityLink kind="building" id={poi.building} />
                  </p>
                {:else if poi.kind === 'outpost'}
                  <p class="small">{t('world.poi.outpost')}</p>
                {:else if poi.kind === 'mission'}
                  <p class="small">
                    {t('world.poi.mission')}
                    <EntityLink kind="mission" id={poi.mission} />
                  </p>
                {:else if poi.kind === 'cache' || poi.kind === 'vault'}
                  <p class="small">
                    {t(poi.kind === 'cache' ? 'world.poi.lootCache' : 'world.poi.lootVault')}
                    {#if poi.kind === 'cache'}
                      {#if poi.ryo > 0}<span>{t('world.poi.ryo', { n: formatInt(poi.ryo) })}</span
                        >{/if}
                      {#each poi.items as item (item.item)}
                        <span><EntityLink kind="item" id={item.item} /> ×{item.n}</span>
                      {/each}
                    {:else}
                      <EntityLink kind="item" id={poi.item} />
                    {/if}
                  </p>
                  {#if st?.claimed}
                    <p class="small done" data-claimed>{t('world.poi.claimed')}</p>
                  {/if}
                {/if}
              </li>
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
          <button
            type="button"
            class="action"
            data-travel-instant
            disabled={reasonInstant !== null}
            aria-describedby={reasonInstant ? `why-instant-${id}` : undefined}
            title={t('world.travel.instant')}
            onclick={() => go('instant')}
          >
            {t('world.travel.instantShort')} ·
            {travel.cost === 0
              ? t('world.travel.free')
              : t('world.travel.cost', { n: formatInt(travel.cost) })}
          </button>
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
              onclick={() => go('walk')}
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
        {#if reasonInstant}<li class="why" id="why-instant-{id}" data-why="instant">
            {t(reasonInstant)}
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
    border-bottom: 1px solid var(--line);
  }

  .lvl {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--font-size-0-8);
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
    border-top: 1px solid var(--accent);
    background: var(--surface-raised);
  }

  .reasons {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .actions .action {
    flex: 1 1 var(--size-6-5);
    padding-inline: var(--space-2);
  }

  .region {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--font-size-0-8);
  }

  h2 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--font-size-1-25);
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-0-95);
  }

  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    min-width: var(--control-size);
    min-height: var(--control-size);
    border: 1px solid var(--line);
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
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-pill);
    font-size: var(--font-size-0-8);
    line-height: var(--line-height-1-6);
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
    font-size: var(--font-size-0-85);
  }

  .block {
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .bar {
    height: var(--bar-6);
    border-radius: var(--radius-3);
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
    font-size: var(--font-size-0-85);
  }

  .facts dt {
    color: var(--fg-dim);
  }

  .facts dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .action {
    min-height: var(--control-size);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--accent);
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
    font-size: var(--font-size-0-8);
  }

  .poi-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .poi {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--line);
  }

  .poi:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .poi-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-weight: 600;
  }

  .poi-name .kind {
    color: var(--fg-dim);
    font-size: var(--font-size-0-75);
    font-weight: 400;
  }

  .go {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--control-size);
    min-height: var(--control-size);
    color: var(--accent);
  }

  .done {
    color: var(--success);
  }

  .panel :global(a) {
    color: inherit;
  }

  .panel :global(a:hover) {
    color: var(--accent);
    text-decoration: underline;
  }
</style>
