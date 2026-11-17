<script lang="ts">
  import { buildScene, outcomesOf } from '../lib/fight-scene.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import Fighter from './Fighter.svelte';

  const content = game.content;

  /** The scene of the running fight: every body, what it does, how far it has got. */
  const scene = $derived(game.read((gs) => buildScene(gs, content, game.rules)));
  const outcomes = $derived(scene ? outcomesOf(scene) : {});
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

  const stop = () => {
    if (scene) void game.dispatch({ type: 'action.stop', slot: scene.slot });
  };
</script>

{#if scene}
  <section class="arena" data-ui="fight-arena" data-phase={scene.phase}>
    <div class="side" data-side="player">
      <Fighter f={scene.player} outcomes={outcomes[scene.player.key] ?? []} />
    </div>
    <div class="side" data-side="enemies">
      {#if scene.phase !== 'fight'}
        <p class="banner" data-fight-banner={scene.phase}>
          {t(scene.phase === 'approach' ? 'fight.approach' : 'fight.respawn')}
        </p>
      {/if}
      {#each scene.enemies as e (e.key)}
        <Fighter f={e} outcomes={outcomes[e.key] ?? []} />
      {/each}
    </div>
  </section>

  <Slot name="fight.arena" ctx={{ target }} />

  <button type="button" class="stop" onclick={stop}>{t('combat.stop')}</button>
{/if}

<style>
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
