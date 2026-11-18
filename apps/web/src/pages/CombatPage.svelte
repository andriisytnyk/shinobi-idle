<script lang="ts">
  import {
    cloneCount,
    enemyStats,
    evalReq,
    fightSlotIndex,
    isCloneSlot,
    zoneAvailable,
    zoneCellOf,
    type GameState,
  } from '@shinobi/core';
  import BattleReport from '../components/BattleReport.svelte';
  import BingoBook from '../components/BingoBook.svelte';
  import CloneStart from '../components/CloneStart.svelte';
  import CombatLog from '../components/CombatLog.svelte';
  import FightScreen from '../components/FightScreen.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import PrepScreen from '../components/PrepScreen.svelte';
  import RaidPanel from '../components/RaidPanel.svelte';
  import ZoneWhere from '../components/ZoneWhere.svelte';
  import { formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import type { PrepTarget } from '../lib/prep.ts';
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
        const seen = boss
          ? z.unlock === null || evalReq(gs, z.unlock, content).met
          : zoneCellOf(z.id, content) !== null && available;
        return seen ? [{ id: z.id, enemy: z.enemy, kind, available }] : [];
      });
      const operations = content.operations
        .filter((o) => o.unlock === null || evalReq(gs, o.unlock, content).met)
        .map((o) => ({ id: o.id }));
      return {
        fighting: fightSlotIndex(gs) >= 0,
        cloneFights: isCloneSlot(gs, content, fightSlotIndex(gs)),
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

  /** Whether a clone exists: the character's chakra pool is divided then. */
  const cloned = $derived(game.read((gs: GameState) => cloneCount(gs, content) > 0));

  const start = (kind: 'fight' | 'operation', id: string) =>
    void game.dispatch({ type: 'action.start', slot: 0, kind, id });
  const prepareHref = (kind: PrepTarget['kind'], id: string) => `#/combat/prepare/${kind}/${id}`;
  const opName = (id: string) => (hasKey(`operation.${id}.name`) ? t(`operation.${id}.name`) : id);
</script>

<SimplePage
  title={t(
    section === 'bingo'
      ? 'combat.tab.bingo'
      : section === 'report'
        ? 'combat.tab.report'
        : section === 'prepare'
          ? 'combat.prepare'
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
  {:else if listing.fighting}
    <!-- The arena comes first: on a phone the hint above it would push the fight off the screen. -->
    <FightScreen />
    <RaidPanel compact progress />
    <Hint id="combat" />
  {:else if section === 'prepare' && target}
    <PrepScreen {target} />
  {:else}
    <Hint id="combat" />
    <RaidPanel compact />
    <h2>{t('combat.enemies')}</h2>
    {#if listing.yard.length === 0}
      <p class="empty">{t('combat.empty')}</p>
    {/if}
    <ul class="cards">
      {#each listing.yard as zone (zone.id)}
        <li class="card" data-enemy={zone.enemy}>
          <span class="icon"><Icon entity={{ kind: 'enemy', id: zone.enemy }} size={36} /></span>
          <div class="info">
            <p class="name"><EntityLink kind="enemy" id={zone.enemy} /></p>
            <p class="meta">
              {t('combat.level', { n: zone.cl })} · {t('combat.hp', { n: formatInt(zone.hp) })}
            </p>
          </div>
          <div class="buttons">
            <a class="prepare" href={prepareHref('zone', zone.id)}>{t('combat.prepare')}</a>
            <button type="button" class="start" onclick={() => start('fight', zone.id)}
              >{t('combat.start')}</button
            >
            <CloneStart kind="fight" id={zone.id} />
          </div>
        </li>
      {/each}
    </ul>
    <p class="idle">{t('combat.idle')}</p>
    {#if cloned}<p class="clone-note" data-clone-split>{t('combat.cloneSplit')}</p>{/if}

    {#if listing.zones.length > 0}
      <h2>{t('combat.zones')}</h2>
      <ul class="cards" data-zones>
        {#each listing.zones as zone (zone.id)}
          <li class="card" data-zone={zone.id}>
            <span class="icon"><Icon entity={{ kind: zone.kind, id: zone.enemy }} size={36} /></span
            >
            <div class="info">
              <p class="name"><EntityLink kind={zone.kind} id={zone.enemy} /></p>
              <ZoneWhere zone={zone.id} />
              {#if !zone.available}<p class="why" id="why-zone-{zone.id}">
                  {t('world.where.closed')}
                </p>{/if}
            </div>
            <div class="buttons">
              <a class="prepare" href={prepareHref('zone', zone.id)}>{t('combat.prepare')}</a>
              <button
                type="button"
                class="start"
                disabled={!zone.available}
                aria-describedby={zone.available ? undefined : `why-zone-${zone.id}`}
                onclick={() => start('fight', zone.id)}>{t('combat.zoneStart')}</button
              >
              <CloneStart kind="fight" id={zone.id} disabled={!zone.available} />
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if listing.operations.length > 0}
      <h2>{t('combat.operations')}</h2>
      <ul class="cards" data-operations>
        {#each listing.operations as op (op.id)}
          <li class="card">
            <span class="icon"><Icon name="lucide:swords" size={36} /></span>
            <div class="info"><p class="name">{opName(op.id)}</p></div>
            <div class="buttons">
              <a class="prepare" href={prepareHref('operation', op.id)}>{t('combat.prepare')}</a>
              <button type="button" class="start" onclick={() => start('operation', op.id)}
                >{t('combat.start')}</button
              >
              <CloneStart kind="operation" id={op.id} />
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if section === 'fight' || (section === 'prepare' && listing.fighting)}
    <details class="log" data-fight-log>
      <summary>{t('combat.log')}</summary>
      <CombatLog entries={game.combatLog} fighting={listing.fighting} clone={listing.cloneFights} />
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

  .clone-note {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .why {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .start:disabled {
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg-dim);
    cursor: not-allowed;
  }

  .start,
  .prepare {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }

  .prepare {
    background: transparent;
    color: var(--accent);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .cards {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .icon {
    display: inline-flex;
    color: var(--steel);
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .name {
    margin: 0;
    font-weight: 600;
  }

  @media (max-width: 768px) {
    .name :global(a),
    h2 :global(a) {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-md);
    }
  }

  .meta,
  .idle,
  .empty {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .idle {
    margin-top: var(--space-2);
  }

  @media (max-width: 480px) {
    .card {
      flex-wrap: wrap;
    }

    .buttons {
      width: 100%;
    }

    .buttons > * {
      flex: 1;
    }
  }
</style>
