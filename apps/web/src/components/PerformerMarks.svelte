<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { hasSquad, performersOf, runningBy } from '../lib/squad.ts';
  import { game } from '../lib/store.ts';

  interface Props {
    kind: string;
    id: string;
  }

  let { kind, id }: Props = $props();

  const content = game.content;
  /** Who runs this action now; nothing is drawn before the player has a clone to tell apart. */
  const runners = $derived(
    game.read((gs) =>
      hasSquad(gs, content) ? runningBy(performersOf(gs, content), kind, id) : [],
    ),
  );
</script>

{#if runners.length > 0}
  <span class="marks" data-ui="performer-marks" role="group" aria-label={t('squad.marks')}>
    {#each runners as p (p.id)}
      <span
        class="mark"
        class:clone={p.clone}
        data-ui="performer-mark"
        data-performer={p.n}
        title={p.clone ? t('squad.clone', { n: p.n }) : t('squad.you')}
        >{p.clone ? t('squad.mark.clone', { n: p.n }) : t('squad.you')}</span
      >
    {/each}
  </span>
{/if}

<style>
  .marks {
    display: inline-flex;
    flex: none;
    gap: var(--space-1);
  }

  .mark {
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-pill);
    color: var(--accent);
    font-size: var(--text-2xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .mark.clone {
    border-color: var(--leaf);
    color: var(--success);
  }
</style>
