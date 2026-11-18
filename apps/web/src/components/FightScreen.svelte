<script lang="ts">
  import { allFights, cloneCount } from '@shinobi/core';
  import { buildScene, outcomesOf, targetedKey } from '../lib/fight-scene.ts';
  import { fightView } from '../lib/fight-view.svelte.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import FightSwitcher from './FightSwitcher.svelte';
  import Fighter from './Fighter.svelte';

  const content = game.content;

  /** The performers that fight now (each has a fight of its own), and the one whose fight is shown. */
  const fighters = $derived(game.read((gs) => allFights(gs).map((f) => f.slot)));
  const shown = $derived(fightView.shown(fighters));
  /** The scene of the shown fight: every body, what it does, how far it has got. */
  const scene = $derived(game.read((gs) => buildScene(gs, content, game.rules, shown)));
  const outcomes = $derived(scene ? outcomesOf(scene) : {});
  /** The enemy the player's action is aimed at. */
  const aimed = $derived(scene ? targetedKey(scene) : null);
  /** What the owning slot runs: a zone's fight or an operation names a target a pack can read; a mission does not. */
  const target = $derived(
    game.read((gs) => {
      const a = scene ? gs.slots[scene.slot]?.action : null;
      if (!a) return null;
      if (a.kind === 'fight') return { kind: 'zone' as const, id: a.id };
      if (a.kind === 'operation') return { kind: 'operation' as const, id: a.id };
      return null;
    }),
  );

  /** Whether a clone fights: the pools of the left side are the clone's. */
  const clone = $derived(scene !== null && scene.slot > 0);
  /** Whether a clone exists: the chakra pool of the fighter is divided. */
  const cloned = $derived(game.read((gs) => cloneCount(gs, content) > 0));

  const stop = () => {
    if (!scene) return;
    void game.dispatch(
      clone
        ? { type: 'clone.dispel', slot: scene.slot }
        : { type: 'action.stop', slot: scene.slot },
    );
  };
</script>

{#if scene}
  <FightSwitcher />
  {#if clone}<p class="clone-note" data-clone-fights>
      <strong>{t('combat.cloneFights')}</strong> · {t('combat.cloneNote')}
    </p>{:else if cloned}<p class="clone-note" data-clone-split>{t('combat.cloneSplit')}</p>{/if}
  <section class="arena" data-ui="fight-arena" data-phase={scene.phase}>
    <div class="side" data-side="player">
      <Fighter f={scene.player} outcomes={outcomes[scene.player.key] ?? []} {clone} />
    </div>
    <div class="side" data-side="enemies">
      {#if scene.phase !== 'fight'}
        <p class="banner" data-fight-banner={scene.phase}>
          {t(scene.phase === 'approach' ? 'fight.approach' : 'fight.respawn')}
        </p>
      {/if}
      {#each scene.enemies as e (e.key)}
        <Fighter f={e} outcomes={outcomes[e.key] ?? []} targeted={e.key === aimed} />
      {/each}
    </div>
  </section>

  <Slot name="fight.arena" ctx={{ target }} />

  <button type="button" class="stop" onclick={stop}
    >{t(clone ? 'now.dispel' : 'combat.stop')}</button
  >
{/if}

<style>
  .clone-note {
    margin: 0 0 var(--space-2);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .arena {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--tile-min), 1fr));
    gap: var(--space-4);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .banner {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) dashed var(--line);
    border-radius: var(--radius-sm);
    color: var(--fg-dim);
  }

  /* Phone: one column, the player on top and the enemies under it, close together; the player stays in view while the pack is read. */
  @media (max-width: 768px) {
    .arena {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-2);
    }

    .side {
      gap: var(--space-2);
    }

    /* The body the player is aiming at comes first, the ones that are down come last. */
    .banner {
      order: -2;
    }

    .side :global([data-ui='fighter'][data-targeted='true']) {
      order: -1;
    }

    .side :global([data-ui='fighter'][data-alive='false']) {
      order: 1;
      padding-block: var(--space-1);
    }

    .side[data-side='player'] {
      position: sticky;
      top: 0;
      z-index: var(--z-raised);
    }
  }

  .stop {
    min-height: var(--control-md);
    margin-top: var(--space-3);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
</style>
