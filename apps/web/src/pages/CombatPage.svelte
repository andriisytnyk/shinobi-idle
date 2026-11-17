<script lang="ts">
  import {
    counterValue,
    enemyStats,
    evalReq,
    fightSlotIndex,
    isCloneSlot,
    killsKey,
    RATE_FULL,
    zoneAvailable,
    zoneCellOf,
  } from '@shinobi/core';
  import CloneStart from '../components/CloneStart.svelte';
  import CombatLog from '../components/CombatLog.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import StatBar from '../components/StatBar.svelte';
  import TimeBar from '../components/TimeBar.svelte';
  import ZoneWhere from '../components/ZoneWhere.svelte';
  import { formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { combatTiming, IDLE_TIMING } from '../lib/timing.ts';
  import type { ProgressTiming } from '../lib/time-progress.ts';
  import SimplePage from './SimplePage.svelte';

  const content = game.content;

  /** Enemies of the Academy yard are open to everyone; the other regions arrive with missions. */
  const enemies = $derived(content.enemies.filter((e) => e.region === 'academy'));

  /**
   * Fight zones the player may see: a region zone once its cell was explored (its point is
   * found), a boss zone once unlocked. Nothing undiscovered and nothing without a name is listed.
   */
  const zones = $derived(
    game.read((gs) =>
      content.zones.flatMap((z) => {
        if (z.region === 'academy') return [];
        const boss = z.region === 'boss';
        const kind = boss ? ('boss' as const) : ('enemy' as const);
        if (!hasKey(`${kind}.${z.enemy}.name`)) return [];
        const available = zoneAvailable(gs, z.id, content);
        const seen = boss
          ? z.unlock === null || evalReq(gs, z.unlock, content).met
          : zoneCellOf(z.id, content) !== null && available;
        return seen ? [{ id: z.id, enemy: z.enemy, kind, available }] : [];
      }),
    ),
  );

  const fight = $derived.by(() =>
    game.read((gs) => {
      const state = gs;
      const combat = state.combat;
      const slot = fightSlotIndex(state);
      if (!combat || slot < 0) return null;
      const enemy = content.enemies.find((e) => e.id === combat.enemy);
      if (!enemy) return null;
      const f = combat.fight;
      const p = f.player;
      // The fight is advanced at events; work the slot has received since then still counts.
      const fraction = (timer: { progress: number; need: number }): number =>
        timer.need > 0
          ? Math.min(1, Math.max(0, (timer.progress + combat.work * RATE_FULL) / timer.need))
          : 1;

      let playerDoing: {
        key: string;
        tech: string | null;
        progress: number;
        timing: ProgressTiming;
      };
      // A fighter waits for the moment, acts (a technique, the plain strike, an item) or, out of breath, rests.
      const doing = p.act;
      const key =
        p.phase === 'rest'
          ? 'combat.doing.rest'
          : doing?.kind === 'technique'
            ? 'combat.doing.cast'
            : doing?.kind === 'item'
              ? 'combat.doing.item'
              : doing?.kind === 'basic'
                ? 'combat.doing.basic'
                : 'combat.doing.wait';
      playerDoing = {
        key,
        tech: doing?.kind === 'technique' ? doing.id : null,
        progress: fraction(p.timer),
        timing: combatTiming(state, p.timer),
      };

      const front = f.enemies.find((e) => e.hp > 0) ?? f.enemies[0];
      const enemyDoing =
        combat.phase === 'respawn' || !front
          ? { key: 'combat.doing.respawn', progress: 0, timing: IDLE_TIMING }
          : {
              key: front.phase === 'wait' ? 'combat.doing.wait' : 'combat.doing.attack',
              progress: fraction(front.timer),
              timing: combatTiming(state, front.timer),
            };

      return {
        slot,
        /** Whether a clone fights: the pools below are the clone's. */
        clone: isCloneSlot(state, content, slot),
        enemy,
        c: {
          hp: p.hp,
          chakra: p.chakra,
          stamina: p.stamina,
          enemyHp: f.enemies.reduce((sum, e) => sum + e.hp, 0),
          phase: combat.phase,
        },
        maxHp: p.maxHp,
        maxChakra: p.maxChakra,
        maxStamina: p.maxStamina,
        enemyMaxHp: f.enemies.reduce((sum, e) => sum + e.maxHp, 0),
        kills: counterValue(state, killsKey(enemy.id)),
        playerDoing,
        enemyDoing,
      };
    }),
  );

  const start = (id: string) =>
    void game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id });
  const stop = () => {
    if (fight)
      void game.dispatch(
        fight.clone
          ? { type: 'clone.dispel', slot: fight.slot }
          : { type: 'action.stop', slot: fight.slot },
      );
  };
</script>

<SimplePage title={t('combat.title')}>
  <Hint id="combat" />

  {#if fight}
    <section class="arena" data-fighting={fight.enemy.id}>
      <div class="side">
        <h2 data-fighter={fight.clone ? 'clone' : 'you'}>
          {t(fight.clone ? 'combat.cloneYou' : 'combat.you')}
        </h2>
        {#if fight.clone}<p class="clone-note" data-clone-fights>
            <strong>{t('combat.cloneFights')}</strong> · {t('combat.cloneNote')}
          </p>{/if}
        <StatBar label={t('combat.hpBar')} value={fight.c.hp} max={fight.maxHp} tone="hp" />
        <StatBar
          label={t('combat.chakraBar')}
          value={fight.c.chakra}
          max={fight.maxChakra}
          tone="chakra"
        />
        <StatBar
          label={t('combat.staminaBar')}
          value={fight.c.stamina}
          max={fight.maxStamina}
          tone="stamina"
        />
        <p class="doing" data-player-doing>
          <span class="doing-label">{t(fight.playerDoing.key)}</span>
          {#if fight.playerDoing.tech}<EntityLink
              kind="technique"
              id={fight.playerDoing.tech}
            />{/if}
        </p>
        {#if fight.playerDoing.tech}
          <TimeBar
            timing={fight.playerDoing.timing}
            size="md"
            tone="chakra"
            label={t('combat.doing.cast')}
          />
        {/if}
      </div>

      <div class="side">
        <h2><EntityLink kind="enemy" id={fight.enemy.id} /></h2>
        <StatBar
          label={t('combat.hpBar')}
          value={fight.c.enemyHp}
          max={fight.enemyMaxHp}
          tone="enemy"
        />
        <p class="doing" data-enemy-doing>
          <span class="doing-label">{t(fight.enemyDoing.key)}</span>
        </p>
        {#if fight.enemyDoing.progress > 0 || fight.c.phase === 'fight'}
          <TimeBar
            timing={fight.enemyDoing.timing}
            size="md"
            tone="enemy"
            label={t('combat.doing.attack')}
          />
        {/if}
        <p class="kills" data-kills>{t('combat.kills', { n: formatInt(fight.kills) })}</p>
      </div>
    </section>

    <button type="button" class="stop" onclick={stop}
      >{t(fight.clone ? 'now.dispel' : 'combat.stop')}</button
    >
  {:else}
    <h2>{t('combat.enemies')}</h2>
    {#if enemies.length === 0}
      <p class="empty">{t('combat.empty')}</p>
    {/if}
    <ul class="cards">
      {#each enemies as enemy (enemy.id)}
        <li class="card" data-enemy={enemy.id}>
          <span class="icon"><Icon entity={{ kind: 'enemy', id: enemy.id }} size={36} /></span>
          <div class="info">
            <p class="name"><EntityLink kind="enemy" id={enemy.id} /></p>
            <p class="meta">
              {t('combat.level', { n: enemy.cl })} · {t('combat.hp', {
                n: formatInt(enemyStats(enemy, content).maxHp),
              })}
            </p>
          </div>
          <div class="starts">
            <button type="button" class="start" onclick={() => start(enemy.id)}
              >{t('combat.start')}</button
            >
            <CloneStart kind="fight" id={enemy.id} />
          </div>
        </li>
      {/each}
    </ul>
    <p class="idle">{t('combat.idle')}</p>

    {#if zones.length > 0}
      <h2>{t('combat.zones')}</h2>
      <ul class="cards" data-zones>
        {#each zones as zone (zone.id)}
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
            <div class="starts">
              <button
                type="button"
                class="start"
                disabled={!zone.available}
                aria-describedby={zone.available ? undefined : `why-zone-${zone.id}`}
                onclick={() => start(zone.id)}>{t('combat.zoneStart')}</button
              >
              <CloneStart kind="fight" id={zone.id} disabled={!zone.available} />
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <h2>{t('combat.log')}</h2>
  <CombatLog entries={game.combatLog} fighting={fight !== null} />
</SimplePage>

<style>
  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  h2 :global(a) {
    color: inherit;
  }

  .arena {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--tile-min), 1fr));
    gap: var(--space-4);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .side h2 {
    margin: 0;
  }

  .doing {
    margin: var(--space-1) 0 0;
  }

  .doing-label {
    color: var(--fg-dim);
  }

  .doing :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  .kills {
    margin: 0;
    color: var(--fg-dim);
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

  .starts {
    display: flex;
    gap: var(--space-2);
  }

  .clone-note {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .stop,
  .start {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .stop {
    margin-top: var(--space-3);
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg);
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

    .starts {
      width: 100%;
    }

    .starts > :global(button) {
      flex: 1;
    }
  }
</style>
