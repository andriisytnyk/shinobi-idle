<script lang="ts">
  import { entityAttr } from '../lib/reveal.ts';
  import {
    actionInfo,
    cellInfo,
    isCloneSlot,
    hexKey,
    locationCell,
    positionHex,
    SHARE_FULL,
    travelPlan,
  } from '@shinobi/core';
  import { actionRef } from '../lib/entities.ts';
  import { senseiTestInfo } from '../lib/exam-test.ts';
  import { formatDuration, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { missionNow, type MissionNow } from '../lib/missions.ts';
  import { game } from '../lib/store.ts';
  import { practiceView, type PhaseName } from '../lib/timing.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import BuffStrip from './BuffStrip.svelte';
  import EntityLink from './EntityLink.svelte';
  import Slot from '../lib/ext/Slot.svelte';
  import Icon from './Icon.svelte';
  import NowMission from './NowMission.svelte';

  /** The phrase that says what each kind of action is doing; a kind without one shows its name alone. */
  const VERB: Readonly<Record<string, string>> = {
    gather: 'now.doing.gather',
    craft: 'now.doing.craft',
    drill: 'now.doing.drill',
    meditate: 'now.doing.meditate',
    course: 'now.doing.course',
    explore: 'now.doing.explore',
    walk: 'now.doing.walk',
    autosurvey: 'now.doing.autosurvey',
    fight: 'now.doing.fight',
    mission: 'now.doing.mission',
    senseiTest: 'now.doing.exam',
  };

  /** The phase of a practice, by its phase name. */
  const PHASE_KEY: Readonly<Record<PhaseName, string>> = {
    focus: 'now.phase.focus',
    seal: 'now.phase.seal',
    release: 'now.phase.release',
  };

  /** The picture of an action whose entity kind has no pictogram in the content. */
  const FALLBACK_ICON: Readonly<Record<string, string>> = {
    cell: 'lucide:map-pin',
    hex: 'lucide:map-pin',
    mission: 'lucide:scroll-text',
    exam: 'lucide:clipboard-list',
  };

  interface Row {
    slot: number;
    /** Whether the slot is a clone's. */
    clone: boolean;
    kind: string;
    ref: ReturnType<typeof actionRef>;
    skill: string | undefined;
    /** Skill XP per hour; null for actions that pay none by the hour (fights, exams). */
    xpPerHour: number | null;
    /** Time left of a walk, in ms. */
    walkLeft: number;
    /** The stage, performer and failures of a mission in the slot. */
    mission: MissionNow | null;
    /** What a practised technique is doing right now. */
    practice: { phase: PhaseName; seal: { id: string; glyph: string } | null } | null;
    /** What the player does in a fight: a key of the fight page and the technique being cast. */
    fight: { key: string; tech: string | null } | null;
  }

  const rows = $derived.by((): Row[] =>
    game.read((state) => {
      const content = game.content;
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
        const ref = actionRef(slot.action, state);
        // Exploring has no tile; its XP per hour comes from the map view of the cell. A hex in fog
        // is only "a hex": the numbers of the cell on it are not shown before it is surveyed.
        const mapInfo =
          isExplore && ref.kind !== 'hex'
            ? cellInfo(state, slot.action.id, content, game.rules)
            : null;
        const xpPerHour = info
          ? (info.xpPerHour * slot.share) / SHARE_FULL
          : mapInfo
            ? (mapInfo.xpPerHour * slot.share) / SHARE_FULL
            : null;

        let practice: Row['practice'] = null;
        if (slot.action.kind === 'practice') {
          const view = practiceView(state, index, content, intervalMs);
          const tech = content.techniques.find((x) => x.id === slot.action?.id);
          if (view && tech) {
            const id = view.phase.seal >= 0 ? tech.sealSeq[view.phase.seal] : undefined;
            practice = {
              phase: view.phase.name,
              seal: id ? { id, glyph: content.seals.find((x) => x.id === id)?.glyph ?? '?' } : null,
            };
          }
        }
        let fight: Row['fight'] = null;
        const player = state.combat?.fight.player;
        if (slot.action.kind === 'fight' && player) {
          const doing = player.act;
          fight =
            doing?.kind === 'technique' && doing.id
              ? { key: 'combat.doing.cast', tech: doing.id }
              : {
                  key:
                    player.phase === 'rest'
                      ? 'combat.doing.rest'
                      : doing?.kind === 'item'
                        ? 'combat.doing.item'
                        : doing?.kind === 'basic'
                          ? 'combat.doing.basic'
                          : 'combat.doing.wait',
                  tech: null,
                };
        }

        out.push({
          slot: index,
          clone: isCloneSlot(state, content, index),
          kind: slot.action.kind,
          ref,
          skill: info?.skill,
          xpPerHour,
          mission: missionNow(state, index, game.content),
          practice,
          fight,
          // The time to arrival: the whole route, less what the step in progress has already taken.
          walkLeft: isWalk
            ? Math.max(
                0,
                (travelPlan(state, slot.action.id, content, game.rules, index).ms * SHARE_FULL -
                  slot.progress) /
                  Math.max(1, slot.share),
              )
            : 0,
        });
      });
      return out;
    }),
  );

  /** Where the player stands, and the training-spot bonus that works there. */
  const place = $derived(
    game.read((state) => {
      const cell = locationCell(state, game.content);
      const at = positionHex(state, game.content);
      if (!cell && !at) return null;
      return {
        id: cell?.id ?? null,
        /** The key of the hex, for a hex that is no cell. */
        hex: at ? hexKey(at.q, at.r) : '',
        training: (cell?.pois ?? []).flatMap((p) =>
          p.kind === 'training' && state.world.pois[p.id]
            ? [{ poi: p.id, skill: p.skill, pct: Math.round(p.bonus * 100) }]
            : [],
        ),
      };
    }),
  );

  /** On a phone the bar is one line; the toggle opens the other slots. */
  let expanded = $state(false);

  const wait = $derived(game.read((gs) => senseiTestInfo(gs, game.rules, game.content)));

  const stop = (row: Row) =>
    void game.dispatch(
      row.clone
        ? { type: 'clone.dispel', slot: row.slot }
        : { type: 'action.stop', slot: row.slot },
    );
</script>

<footer class="now" aria-label={t('now.title')}>
  <span class="title">{t('now.title')}</span>
  {#if place}
    <div class="place" data-place>
      <Icon name="lucide:map-pin" size={14} />
      <span class="place-label">{t('world.location')}</span>
      <span class="place-name" data-place-cell
        >{#if place.id}<EntityLink kind="cell" id={place.id} />{:else}<EntityLink
            kind="hex"
            id={place.hex}
          />{/if}</span
      >
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
    <ul class="slots" class:open={expanded}>
      {#each rows as row (row.slot)}
        <li
          class="slot"
          data-slot={row.slot}
          data-ui="now-slot"
          data-slot-index={row.slot}
          data-entity={row.ref.kind === 'hex' ? undefined : entityAttr(row.ref)}
          class:with-mission={row.mission}
          class:clone={row.clone}
        >
          <span class="emblem">
            <ActionEmblem
              size="sm"
              kind={row.ref.kind}
              id={row.ref.id}
              skill={row.skill}
              icon={FALLBACK_ICON[row.ref.kind]}
            />
          </span>
          <span class="what" data-now-what>
            <span class="line">
              {#if row.clone}<span class="clone-tag" data-ui="clone-tag" title={t('now.cloneMark')}
                  ><Icon name="lucide:copy" size={14} />{t('now.clone')}</span
                >{/if}
              {#if VERB[row.kind]}<span class="verb">{t(VERB[row.kind] ?? '')}</span>{/if}
              <span class="name"><EntityLink kind={row.ref.kind} id={row.ref.id} /></span>
            </span>
            {#if row.practice}
              <span class="phrase" data-now-phase={row.practice.phase}>
                {#if row.practice.phase === 'seal' && row.practice.seal}
                  <span class="lead">{t(PHASE_KEY.seal)}</span>
                  <span class="kanji" lang="ja">{row.practice.seal.glyph}</span>
                  <EntityLink kind="seal" id={row.practice.seal.id} />
                {:else}
                  {t(PHASE_KEY[row.practice.phase])}
                {/if}
              </span>
            {:else if row.fight}
              <span class="phrase" data-now-fight>
                {#if row.fight.tech}<span class="fight-tech" data-now-fight-tech
                    ><ActionEmblem kind="technique" id={row.fight.tech} size="sm" /></span
                  >{/if}
                {t(row.fight.key)}
                {#if row.fight.tech}<EntityLink kind="technique" id={row.fight.tech} />{/if}
              </span>
            {/if}
          </span>
          <span class="xph"
            >{#if row.xpPerHour !== null}{t('tile.xphValue', {
                n: formatXp(row.xpPerHour),
              })}{/if}</span
          >
          {#if row.walkLeft > 0}
            <span class="wait" data-walk-left
              >{t('world.walkLeft', { time: formatDuration(row.walkLeft) })}</span
            >
          {/if}
          {#if wait && wait.slot === row.slot}
            <span class="wait" data-exam-wait
              >{t('rank.testLeft', { time: formatDuration(wait.left) })}</span
            >
          {/if}
          <button
            type="button"
            class="stop"
            aria-label={t(row.clone ? 'now.dispel' : 'now.stop')}
            title={t(row.clone ? 'now.dispelTitle' : 'now.stop')}
            onclick={() => stop(row)}
          >
            <span class="stop-icon"
              ><Icon name={row.clone ? 'lucide:x' : 'lucide:square'} size={16} /></span
            >
            <span class="stop-label">{t(row.clone ? 'now.dispel' : 'now.stop')}</span>
          </button>
          {#if row.mission}<NowMission now={row.mission} />{/if}
          <Slot name="now.bar" ctx={{ slot: row.slot }} />
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
    border-top: var(--border-thin) solid var(--line);
    background: var(--surface);
  }

  .title {
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-xs);
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
    max-width: var(--measure);
    min-width: 0;
    font-size: var(--text-xs);
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
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-pill);
    color: var(--accent);
    font-size: var(--text-xs);
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

  /* A mission shows its stage on a line of its own under the bar. */
  .slot.with-mission {
    flex-wrap: wrap;
  }

  /* One line: the name gives way first, then the phrase; each is cut with an ellipsis. */
  .what {
    display: flex;
    flex: 1;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    white-space: nowrap;
  }

  .emblem {
    display: inline-flex;
    flex: none;
  }

  /* The verb and the name read as one phrase; the name gives way first. */
  .line {
    display: flex;
    flex: 0 8 auto;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .verb {
    flex: none;
  }

  /* The clone's slot is marked by a pill with the clone's glyph and its name. */
  .clone-tag {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-pill);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .name,
  .phrase {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .name {
    flex: 0 1 auto;
    font-weight: 600;
  }

  .phrase {
    flex: 0 1 auto;
  }

  .name :global(a),
  .phrase :global(a) {
    display: inline;
    min-height: 0;
  }

  .name :global(a:hover),
  .phrase :global(a:hover) {
    text-decoration: underline;
  }

  .phrase {
    color: var(--accent);
  }

  .phrase :global(a) {
    font-weight: 600;
  }

  /* The technique the player is casting: its medallion leads the phrase. */
  .fight-tech {
    display: inline-flex;
    vertical-align: middle;
    margin-right: var(--space-1);
  }

  .kanji {
    font-family: var(--font-kanji);
    font-weight: 600;
  }

  .wait {
    flex: none;
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .xph {
    flex: none;
    color: var(--fg-dim);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .stop-icon {
    display: none;
  }

  .stop,
  .more {
    min-height: var(--control-xs);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .more {
    display: none;
    align-items: center;
    gap: var(--space-1);
  }

  @media (max-width: 768px) {
    .now {
      flex-wrap: wrap;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      font-size: var(--text-xs);
    }

    /* On a phone the buffs take a line of their own under the running action. */
    .buff-slot :global(.buffs) {
      order: 5;
      flex: 1 0 100%;
    }

    /* On a phone the seal is named by its kanji and name alone. */
    .lead {
      display: none;
    }

    .title,
    .xph,
    .place-label {
      display: none;
    }

    /* One line on a phone: the other slots wait behind the toggle. */
    .more {
      display: inline-flex;
    }

    .slots:not(.open) > .slot:nth-child(n + 2) {
      display: none;
    }

    .place {
      --_max-width: 11rem;
      max-width: var(--_max-width);
    }

    /* The actions take a line of their own when the place and the action do not fit side by side. */
    .slots {
      --_flex: 15rem;
      flex: 1 1 var(--_flex);
    }

    .chip {
      flex: 1 0 100%;
    }

    /*
     * One slot takes two lines: the emblem and the whole action name on the first, the live phrase
     * on the second, and the stop control as an icon at the end. The name wraps rather than being cut.
     */
    .slot {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-1) var(--space-2);
    }

    .slot > :global(*) {
      grid-column: 1 / -1;
    }

    .slot > .emblem {
      grid-column: 1;
      grid-row: 1 / span 2;
    }

    .slot > .what {
      display: contents;
    }

    .line {
      grid-column: 2;
      grid-row: 1;
      flex-wrap: wrap;
    }

    .name {
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .phrase {
      grid-column: 2;
      grid-row: 2;
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
    }

    .slot > .wait {
      grid-column: 2;
    }

    .slot > .stop {
      grid-column: 3;
      grid-row: 1 / span 2;
    }

    .stop-label {
      display: none;
    }

    .stop-icon {
      display: inline-flex;
    }

    /* Whole-tap targets of at least 44 px on a phone. */
    .stop,
    .more {
      min-width: var(--control-md);
      min-height: var(--control-md);
    }
  }
</style>
