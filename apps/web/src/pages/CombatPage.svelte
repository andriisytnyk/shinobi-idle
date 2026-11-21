<script lang="ts">
  import {
    cloneCount,
    enemyStats,
    evalReq,
    allFights,
    zoneAvailable,
    zoneCellOf,
    type GameState,
  } from '@shinobi/core';
  import BattleReport from '../components/BattleReport.svelte';
  import BingoBook from '../components/BingoBook.svelte';
  import CombatLog from '../components/CombatLog.svelte';
  import FightScreen from '../components/FightScreen.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import PrepScreen from '../components/PrepScreen.svelte';
  import RaidPanel from '../components/RaidPanel.svelte';
  import StartSplit from '../components/StartSplit.svelte';
  import ZoneCard from '../components/ZoneCard.svelte';
  import { fightView } from '../lib/fight-view.svelte.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { entityName } from '../lib/entities.ts';
  import type { PrepTarget } from '../lib/prep.ts';
  import { revealLevel } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  interface Props {
    /** The part of the page: the fight (or the list of targets), the Bingo book, the battle report or a preparation. */
    section?: 'fight' | 'bingo' | 'report' | 'prepare';
    /** For a preparation: what it is for. */
    target?: PrepTarget | null;
  }

  let { section = 'fight', target = null }: Props = $props();

  const content = game.content;

  /** What the player can fight: the Academy yard is open to everyone; a region zone once its cell is explored (its point is found); a boss zone once unlocked. */
  const listing = $derived(
    game.read((gs: GameState) => {
      const yard = content.zones.filter((z) => z.region === 'academy');
      const zones = content.zones.flatMap((z) => {
        if (z.region === 'academy') return [];
        const boss = z.region === 'boss';
        const kind = boss ? ('boss' as const) : ('enemy' as const);
        if (!hasKey(`${kind}.${z.enemy}.name`)) return [];
        const available = zoneAvailable(gs, z.id, content);
        const cellId = zoneCellOf(z.id, content);
        const seen = boss
          ? z.unlock === null || evalReq(gs, z.unlock, content).met
          : cellId !== null && (available || revealLevel({ kind, id: z.enemy }) !== 'hidden');
        if (!seen) return [];
        const entry =
          content.enemies.find((e) => e.id === z.enemy) ??
          content.bosses.find((b) => b.id === z.enemy);
        return [
          {
            id: z.id,
            enemy: z.enemy,
            kind,
            available,
            cell: cellId,
            cl: entry?.cl ?? 0,
            hp: entry ? enemyStats(entry, content).maxHp : 0,
          },
        ];
      });
      const operations = content.operations
        .filter((o) => o.unlock === null || evalReq(gs, o.unlock, content).met)
        .map((o) => ({ id: o.id }));
      return {
        fighting: allFights(gs).length > 0,
        selfFighting: gs.combat !== null,
        fighters: allFights(gs).map((f) => f.slot),
        yard: yard.map((z) => ({
          id: z.id,
          enemy: z.enemy,
          hp: enemyStats(
            content.enemies.find((e) => e.id === z.enemy)!,
            content,
          ).maxHp,
          cl: content.enemies.find((e) => e.id === z.enemy)?.cl ?? 0,
        })),
        zones,
        operations,
      };
    }),
  );

  /** The enemy zones by region and cell, in the order of the map; bosses apart. */
  const groups = $derived.by(() => {
    const regions = content.regions.flatMap((region) => {
      const cells = region.cells.flatMap((cellId) => {
        const zones = listing.zones.filter((z) => z.kind === 'enemy' && z.cell === cellId);
        return zones.length > 0 ? [{ id: cellId, zones }] : [];
      });
      return cells.length > 0
        ? [{ id: region.id, cells, open: cells.some((c) => c.zones.some((z) => z.available)) }]
        : [];
    });
    return { regions, bosses: listing.zones.filter((z) => z.kind === 'boss') };
  });

  /** The preparation shown in a sheet over the list. */
  let sheet = $state.raw<PrepTarget | null>(null);
  const openSheet = (kind: PrepTarget['kind'], id: string) => (sheet = { kind, id });
  const closeSheet = () => (sheet = null);

  /** The performer whose fight is shown (the fight screen sets it), and the lines of that fight alone, worded for it. */
  const shownFight = $derived(fightView.shown(listing.fighters));
  const logEntries = () => game.combatLog.filter((e) => (e.event.slot ?? 0) === shownFight);

  /**
   * The heading of the fight shown: «Тренувальний бій» is the fight in the Academy yard; a fight in a zone
   * or an operation is named by its enemy or operation. Null when no fight runs, or the training one.
   */
  const fightName = $derived(
    game.read((gs: GameState) => {
      if (!listing.fighting) return null;
      const action = gs.slots[shownFight]?.action;
      if (!action) return null;
      if (action.kind === 'operation') return opName(action.id);
      const zone = action.kind === 'fight' ? content.zones.find((z) => z.id === action.id) : null;
      if (!zone || zone.region === 'academy') return null;
      return entityName({ kind: zone.region === 'boss' ? 'boss' : 'enemy', id: zone.enemy });
    }),
  );

  /** Whether the fight shown is the training one (the Academy yard). */
  const trainingShown = $derived(
    game.read((gs: GameState) => {
      if (!listing.fighting) return false;
      const action = gs.slots[shownFight]?.action;
      const zone = action?.kind === 'fight' ? content.zones.find((z) => z.id === action.id) : null;
      return zone?.region === 'academy';
    }),
  );

  /** Whether a clone exists: the character's chakra pool is divided then. */
  const cloned = $derived(game.read((gs: GameState) => cloneCount(gs, content) > 0));

  const opName = (id: string) => (hasKey(`operation.${id}.name`) ? t(`operation.${id}.name`) : id);
</script>

<SimplePage
  title={section === 'fight' && fightName !== null
    ? fightName
    : t(
        section === 'bingo'
          ? 'combat.tab.bingo'
          : section === 'report'
            ? 'combat.tab.report'
            : section === 'prepare'
              ? 'combat.prepare'
              : trainingShown
                ? 'combat.titleTraining'
                : 'combat.title',
      )}
  compact={listing.fighting}
>
  <nav class="tabs" aria-label={t('combat.sections')} data-combat-tabs>
    <a
      href="#/combat"
      class:active={section === 'fight' || section === 'prepare'}
      aria-current={section === 'fight' || section === 'prepare' ? 'page' : undefined}
      data-combat-tab="fight">{t('combat.tab.fight')}</a
    >
    <a
      href="#/combat/bingo"
      class:active={section === 'bingo'}
      aria-current={section === 'bingo' ? 'page' : undefined}
      data-combat-tab="bingo">{t('combat.tab.bingo')}</a
    >
    <a
      href="#/combat/report"
      class:active={section === 'report'}
      aria-current={section === 'report' ? 'page' : undefined}
      data-combat-tab="report">{t('combat.tab.report')}</a
    >
  </nav>

  {#if section === 'bingo'}
    <BingoBook />
  {:else if section === 'report'}
    <BattleReport />
  {:else if section === 'prepare' && target && listing.selfFighting}
    <!-- A preparation is asked for while a fight runs: it is shown, with a way back to the fight. -->
    <p class="running-note" data-prepare-running>
      {t('combat.prepare.running')}
      <a href="#/combat" data-prepare-running-link>{t('combat.prepare.toFight')}</a>
    </p>
    <PrepScreen {target} />
  {:else if listing.selfFighting}
    <!-- The arena comes first: on a phone the hint above it would push the fight off the screen. -->
    <FightScreen />
    <RaidPanel compact progress />
    <Hint id="combat" />
  {:else if section === 'prepare' && target}
    <PrepScreen {target} />
  {:else}
    <!-- Only clones fight: their fights show above the list, from which the character can start its own. -->
    {#if listing.fighting}<FightScreen />{/if}
    <Hint id="combat" />
    <RaidPanel compact />
    <section class="group" data-ui="zone-group" data-group="academy">
      <h2>{t('combat.group.academy')}</h2>
      {#if listing.yard.length === 0}
        <p class="empty">{t('combat.empty')}</p>
      {/if}
      <ul class="ct-tiles">
        {#each listing.yard as zone (zone.id)}
          <ZoneCard
            zone={{ ...zone, kind: 'enemy', available: true }}
            startLabel="combat.start"
            onPrepare={(id) => openSheet('zone', id)}
          />
        {/each}
      </ul>
    </section>
    <p class="idle">{t('combat.idle')}</p>
    {#if cloned}<p class="clone-note" data-clone-split>{t('combat.cloneSplit')}</p>{/if}

    {#each groups.regions as region (region.id)}
      <details class="group" open={region.open} data-ui="zone-group" data-group={region.id}>
        <summary><h2><EntityLink kind="region" id={region.id} /></h2></summary>
        {#each region.cells as cell (cell.id)}
          <h3 class="cell"><EntityLink kind="cell" id={cell.id} /></h3>
          <ul class="ct-tiles" data-zones>
            {#each cell.zones as zone (zone.id)}
              <ZoneCard {zone} onPrepare={(id) => openSheet('zone', id)} />
            {/each}
          </ul>
        {/each}
      </details>
    {/each}

    {#if groups.bosses.length > 0}
      <section class="group" data-ui="zone-group" data-group="bosses">
        <h2>{t('combat.group.bosses')}</h2>
        <ul class="ct-tiles" data-zones>
          {#each groups.bosses as zone (zone.id)}
            <ZoneCard {zone} onPrepare={(id) => openSheet('zone', id)} />
          {/each}
        </ul>
      </section>
    {/if}

    {#if listing.operations.length > 0}
      <section class="group" data-ui="zone-group" data-group="operations">
        <h2>{t('combat.operations')}</h2>
        <ul class="ct-tiles" data-operations>
          {#each listing.operations as op (op.id)}
            <li class="ct-tile" data-ui="zone-card" data-operation={op.id}>
              <div class="ct-top">
                <span class="ct-icon"><Icon name="lucide:swords" size={32} /></span>
                <div class="ct-head"><h4 class="ct-name">{opName(op.id)}</h4></div>
              </div>
              <div class="ct-actions buttons">
                <button
                  type="button"
                  class="ct-action stop prepare"
                  data-prepare
                  onclick={() => openSheet('operation', op.id)}>{t('combat.prepare')}</button
                >
                <StartSplit kind="operation" id={op.id} label="combat.start" />
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}

  {#if sheet}
    <div
      class="sheet-backdrop"
      data-ui="prep-sheet-backdrop"
      role="presentation"
      onclick={closeSheet}
    ></div>
    <div
      class="sheet"
      data-ui="prep-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={t('combat.prepare')}
      tabindex="-1"
      onkeydown={(e) => e.key === 'Escape' && closeSheet()}
    >
      <button
        type="button"
        class="sheet-close"
        data-sheet-close
        aria-label={t('modal.close')}
        onclick={closeSheet}
      >
        <Icon name="lucide:x" size={18} />
      </button>
      <PrepScreen target={sheet} onStarted={closeSheet} onClose={closeSheet} />
    </div>
  {/if}

  {#if section === 'fight' || (section === 'prepare' && listing.fighting)}
    <details class="log" data-fight-log>
      <summary>{t('combat.log')}</summary>
      <CombatLog entries={logEntries()} fighting={listing.fighting} clone={shownFight > 0} />
    </details>
  {/if}
</SimplePage>

<style>
  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
  }

  .tabs a {
    display: inline-flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    min-height: var(--control-md);
    padding: 0 var(--space-3);
    white-space: nowrap;
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    text-decoration: none;
  }

  .tabs a.active {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .log {
    margin-top: var(--space-4);
  }

  .log summary {
    min-height: var(--control-sm);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    cursor: pointer;
  }

  .running-note {
    margin: 0 0 var(--space-3);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .clone-note {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .group {
    margin-bottom: var(--space-2);
  }

  details.group > summary {
    min-height: var(--control-md);
    cursor: pointer;
    list-style-position: inside;
  }

  details.group > summary h2 {
    display: inline;
  }

  .cell {
    margin: var(--space-3) 0 var(--space-2);
    color: var(--fg-dim);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .idle,
  .empty {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .prepare {
    display: inline-flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }

  .buttons {
    flex-wrap: wrap;
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: var(--scrim);
  }

  .sheet {
    position: fixed;
    z-index: var(--z-modal);
    top: 0;
    right: 0;
    bottom: 0;
    width: min(100%, var(--modal-width));
    padding: var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--surface);
    border-left: var(--border-thin) solid var(--line);
  }

  .sheet-close {
    position: sticky;
    top: 0;
    float: right;
    z-index: 1;
    min-width: var(--control-md);
    min-height: var(--control-md);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    cursor: pointer;
  }
</style>
