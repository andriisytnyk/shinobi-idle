<script lang="ts">
  import { SHARE_FULL, type ActionInfo } from '@shinobi/core';
  import { actionRef } from '../lib/entities.ts';
  import { formatSeconds, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import MasteryRing from './MasteryRing.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    info: ActionInfo;
  }

  let { info }: Props = $props();

  const ref = $derived(actionRef(info));
  const slotIndex = $derived(
    game.state.slots.findIndex((s) => s.action?.kind === info.kind && s.action.id === info.id),
  );
  const running = $derived(slotIndex >= 0);
  /** How far through the current cycle the running action is, 0..1. */
  const cycle = $derived.by(() => {
    const slot = game.state.slots[slotIndex];
    if (!slot) return 0;
    return Math.min(1, slot.progress / (info.intervalMs * SHARE_FULL));
  });

  function toggle(): void {
    const result = running
      ? game.dispatch({ type: 'action.stop', slot: slotIndex })
      : game.dispatch({ type: 'action.start', slot: 0, kind: info.kind, id: info.id });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }
</script>

<li class="tile" class:locked={!info.available} class:running data-action={info.id}>
  <div class="head">
    <h3 class="name"><EntityLink kind={ref.kind} id={ref.id} /></h3>
    <MasteryRing level={info.masteryLevel} progress={info.masteryProgress} />
  </div>

  <dl class="facts">
    <div>
      <dt>{t('tile.level')}</dt>
      <dd>{info.level}</dd>
    </div>
    <div>
      <dt>{t('tile.interval')}</dt>
      <dd>{formatSeconds(info.intervalMs)}</dd>
    </div>
    <div>
      <dt>{t('tile.xph')}</dt>
      <dd>
        <ModBreakdown
          keys={['xp.all', `xp.skill.${info.skill}`]}
          display={t('tile.xphValue', { n: formatXp(info.xpPerHour) })}
        />
      </dd>
    </div>
  </dl>

  {#if info.available}
    {#if running}
      <span class="cycle" aria-hidden="true"
        ><span class="fill" style:width="{cycle * 100}%"></span></span
      >
    {/if}
    <button type="button" class="action" class:stop={running} onclick={toggle}>
      {t(running ? 'tile.stop' : 'tile.start')}
    </button>
  {:else if info.req}
    <div class="req">
      <p class="locked-label"><Icon name="lucide:lock" size={14} /> {t('tile.locked')}</p>
      <ReqTree node={info.req} />
    </div>
  {/if}
</li>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-raised);
    list-style: none;
  }

  .tile.running {
    border-color: var(--accent);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .name {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .name :global(a) {
    color: var(--heading);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(3, auto);
    justify-content: space-between;
    gap: var(--space-2);
    margin: 0;
  }

  dt {
    color: var(--fg-dim);
    font-size: 0.75rem;
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .cycle {
    height: 4px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .action {
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .action.stop {
    background: none;
    color: var(--accent);
  }

  .locked-label {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0 0 var(--space-1);
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  .req {
    font-size: 0.9rem;
  }
</style>
