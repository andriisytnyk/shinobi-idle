<script lang="ts">
  import { content } from '@shinobi/content';
  import { counterValue, enemyStats, fightSlotIndex, killsKey, RATE_FULL } from '@shinobi/core';
  import CombatLog from '../components/CombatLog.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import StatBar from '../components/StatBar.svelte';
  import ZoneWhere from '../components/ZoneWhere.svelte';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  /** Enemies of the Academy yard are open to everyone; the other regions arrive with missions. */
  const enemies = $derived(content.enemies.filter((e) => e.region === 'academy'));

  /** Fight zones of the regions; each sits in a map cell. */
  const zones = $derived(content.zones.filter((z) => z.region !== 'academy'));

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

      let playerDoing: { key: string; tech: string | null; progress: number };
      if (p.phase === 'cast' && p.cast) {
        playerDoing = { key: 'combat.doing.cast', tech: p.cast, progress: fraction(p.timer) };
      } else if (p.phase === 'recover') {
        playerDoing = { key: 'combat.doing.recover', tech: null, progress: 0 };
      } else {
        playerDoing = { key: 'combat.doing.ready', tech: null, progress: 0 };
      }

      const front = f.enemies.find((e) => e.hp > 0) ?? f.enemies[0];
      const enemyDoing =
        combat.phase === 'respawn' || !front
          ? { key: 'combat.doing.respawn', progress: 0 }
          : { key: 'combat.doing.attack', progress: fraction(front.timer) };

      return {
        slot,
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
    if (fight) void game.dispatch({ type: 'action.stop', slot: fight.slot });
  };
</script>

<SimplePage title={t('combat.title')}>
  <Hint id="combat" />

  {#if fight}
    <section class="arena" data-fighting={fight.enemy.id}>
      <div class="side">
        <h2>{t('combat.you')}</h2>
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
          <div
            class="cast"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(fight.playerDoing.progress * 100)}
            aria-label={t('combat.doing.cast')}
          >
            <span class="cast-fill" style:width="{fight.playerDoing.progress * 100}%"></span>
          </div>
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
          <div
            class="cast"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(fight.enemyDoing.progress * 100)}
            aria-label={t('combat.doing.attack')}
          >
            <span class="cast-fill enemy" style:width="{fight.enemyDoing.progress * 100}%"></span>
          </div>
        {/if}
        <p class="kills" data-kills>{t('combat.kills', { n: formatInt(fight.kills) })}</p>
      </div>
    </section>

    <button type="button" class="stop" onclick={stop}>{t('combat.stop')}</button>
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
          <button type="button" class="start" onclick={() => start(enemy.id)}
            >{t('combat.start')}</button
          >
        </li>
      {/each}
    </ul>
    <p class="idle">{t('combat.idle')}</p>

    {#if zones.length > 0}
      <h2>{t('combat.zones')}</h2>
      <p class="idle">{t('combat.zonesNote')}</p>
      <ul class="cards" data-zones>
        {#each zones as zone (zone.id)}
          <li class="card" data-zone={zone.id}>
            <span class="icon"><Icon entity={{ kind: 'enemy', id: zone.enemy }} size={36} /></span>
            <div class="info">
              <p class="name"><EntityLink kind="enemy" id={zone.enemy} /></p>
              <ZoneWhere zone={zone.id} />
            </div>
            <button type="button" class="start" onclick={() => start(zone.enemy)}
              >{t('combat.zoneStart')}</button
            >
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
    font-size: 1.1rem;
    font-weight: 400;
  }

  h2 :global(a) {
    color: inherit;
  }

  .arena {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-4);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
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

  .cast {
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }

  .cast-fill {
    display: block;
    height: 100%;
    background: var(--chakra);
  }

  .cast-fill.enemy {
    background: var(--danger);
  }

  .kills {
    margin: 0;
    color: var(--fg-dim);
  }

  .stop,
  .start {
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--accent);
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
    border: 1px solid var(--line);
    border-radius: var(--radius);
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
      min-height: 2.75rem;
    }
  }

  .meta,
  .idle,
  .empty {
    margin: 0;
    color: var(--fg-dim);
    font-size: 0.9rem;
  }

  .idle {
    margin-top: var(--space-2);
  }

  @media (max-width: 480px) {
    .card {
      flex-wrap: wrap;
    }

    .start {
      width: 100%;
    }
  }
</style>
