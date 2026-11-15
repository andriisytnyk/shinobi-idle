<script lang="ts">
  import { content } from '@shinobi/content';
  import { actionInfo, cellInfo, locationCell, SHARE_FULL } from '@shinobi/core';
  import { actionRef } from '../lib/entities.ts';
  import { senseiTestInfo } from '../lib/exam-test.ts';
  import { formatDuration, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import BuffStrip from './BuffStrip.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Row {
    slot: number;
    ref: ReturnType<typeof actionRef>;
    fraction: number;
    /** Skill XP per hour; null for actions that pay none by the hour (fights, exams). */
    xpPerHour: number | null;
    /** What the slot does when it is a move on the map: its label key and the time left. */
    move: { key: string; left: number } | null;
  }

  const rows = $derived.by((): Row[] =>
    game.read((state) => {
      const out: Row[] = [];
      state.slots.forEach((slot, index) => {
        if (!slot.action) return;
        const info = actionInfo(state, slot.action, content, game.rules);
        // Fights and exams are not skill tiles, so their cycle comes straight from their kind.
        const kind = game.rules.actionKinds[slot.action.kind];
        const intervalMs =
          info?.intervalMs ?? kind?.intervalMs(state, slot.action.id, content, game.rules);
        if (intervalMs === undefined) return;
        const isExplore = slot.action.kind === 'explore';
        const isWalk = slot.action.kind === 'walk';
        // Exploring has no tile; its XP per hour comes from the map view of the cell.
        const mapInfo = isExplore ? cellInfo(state, slot.action.id, content, game.rules) : null;
        const xpPerHour = info
          ? (info.xpPerHour * slot.share) / SHARE_FULL
          : mapInfo
            ? (mapInfo.xpPerHour * slot.share) / SHARE_FULL
            : null;
        out.push({
          slot: index,
          ref: actionRef(slot.action),
          fraction: Math.min(1, slot.progress / (intervalMs * SHARE_FULL)),
          xpPerHour,
          move:
            isExplore || isWalk
              ? {
                  key: isWalk ? 'world.walking' : 'world.exploring',
                  left: isWalk
                    ? Math.max(
                        0,
                        (intervalMs * SHARE_FULL - slot.progress) / Math.max(1, slot.share),
                      )
                    : 0,
                }
              : null,
        });
      });
      return out;
    }),
  );

  /** Where the player stands, and the training-spot bonus that works there. */
  const place = $derived(
    game.read((state) => {
      const cell = locationCell(state, content);
      if (!cell) return null;
      return {
        id: cell.id,
        training: cell.pois.flatMap((p) =>
          p.kind === 'training' && state.world.pois[p.id]
            ? [{ poi: p.id, skill: p.skill, pct: Math.round(p.bonus * 100) }]
            : [],
        ),
      };
    }),
  );

  /** On a phone the bar is one line; the toggle opens the other slots. */
  let expanded = $state(false);
  const shown = $derived(expanded ? rows : rows.slice(0, 1));

  const wait = $derived(game.read((gs) => senseiTestInfo(gs, game.rules, content)));

  const stop = (slot: number) => void game.dispatch({ type: 'action.stop', slot });
</script>

<footer class="now" aria-label={t('now.title')}>
  <span class="title">{t('now.title')}</span>
  {#if place}
    <div class="place" data-place>
      <Icon name="lucide:map-pin" size={14} />
      <span class="place-label">{t('world.location')}</span>
      <span class="place-name" data-place-cell><EntityLink kind="cell" id={place.id} /></span>
      {#each place.training as spot (spot.poi)}
        <span class="chip" data-training-bonus>
          {t('world.trainingNow', { pct: spot.pct })}
          <EntityLink kind="skill" id={spot.skill} />
        </span>
      {/each}
    </div>
  {/if}
  <div class="buff-slot"><BuffStrip /></div>
  {#if rows.length === 0}
    <span class="idle">{t('now.idle')}</span>
  {:else}
    <ul class="slots">
      {#each shown as row (row.slot)}
        <li class="slot" data-slot={row.slot}>
          <span class="name"
            >{#if row.move}<span class="verb">{t(row.move.key)}</span>
            {/if}<EntityLink kind={row.ref.kind} id={row.ref.id} /></span
          >
          <span
            class="bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(row.fraction * 100)}
            aria-label={t('now.progress')}
          >
            <span class="fill" style:width="{row.fraction * 100}%"></span>
          </span>
          <span class="xph"
            >{#if row.xpPerHour !== null}{t('tile.xphValue', {
                n: formatXp(row.xpPerHour),
              })}{/if}</span
          >
          {#if row.move && row.move.left > 0}
            <span class="wait" data-walk-left
              >{t('world.walkLeft', { time: formatDuration(row.move.left) })}</span
            >
          {/if}
          {#if wait && wait.slot === row.slot}
            <span class="wait" data-exam-wait
              >{t('rank.testLeft', { time: formatDuration(wait.left) })}</span
            >
          {/if}
          <button type="button" class="stop" onclick={() => stop(row.slot)}>{t('now.stop')}</button>
        </li>
      {/each}
    </ul>
    {#if rows.length > 1}
      <button
        type="button"
        class="more"
        aria-expanded={expanded}
        aria-label={t('now.more')}
        onclick={() => (expanded = !expanded)}
      >
        <Icon name={expanded ? 'lucide:chevron-down' : 'lucide:plus'} size={16} />
        {#if !expanded}<span>{rows.length - 1}</span>{/if}
      </button>
    {/if}
  {/if}
</footer>

<style>
  .now {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--now-height);
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--line);
    background: var(--surface);
  }

  .title {
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 0.85rem;
  }

  /* The wrapper adds no box: the buff chips are items of the bar itself. */
  .buff-slot {
    display: contents;
  }

  .place {
    display: flex;
    flex: none;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    max-width: 24rem;
    min-width: 0;
    font-size: 0.85rem;
  }

  .place-label,
  .verb {
    color: var(--fg-dim);
  }

  .verb {
    margin-right: var(--space-1);
  }

  .place-name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .chip {
    padding: 0 var(--space-2);
    border: 1px solid var(--accent);
    border-radius: 999px;
    color: var(--accent);
    font-size: 0.8rem;
  }

  .chip :global(a) {
    font-weight: 600;
  }

  .idle {
    flex: 1;
    color: var(--fg-dim);
  }

  .slots {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .slot {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .name {
    flex: none;
    max-width: 14rem;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name :global(a:hover) {
    text-decoration: underline;
  }

  .bar {
    flex: 1;
    height: 6px;
    min-width: 3rem;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .wait {
    flex: none;
    color: var(--accent);
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .xph {
    flex: none;
    color: var(--fg-dim);
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .stop,
  .more {
    min-height: 2rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .more {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  @media (max-width: 768px) {
    .now {
      flex-wrap: wrap;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      font-size: 0.85rem;
    }

    /* On a phone the buffs take a line of their own under the running action. */
    .buff-slot :global(.buffs) {
      order: 5;
      flex: 1 0 100%;
    }

    .title,
    .xph,
    .place-label {
      display: none;
    }

    .place {
      max-width: 11rem;
    }

    /* The actions take a line of their own when the place and the action do not fit side by side. */
    .slots {
      flex: 1 1 15rem;
    }

    .chip {
      flex: 1 0 100%;
    }

    .name {
      max-width: 9rem;
    }

    /* Whole-tap targets of at least 44 px on a phone. */
    .stop,
    .more {
      min-width: 2.75rem;
      min-height: 2.75rem;
    }
  }
</style>
