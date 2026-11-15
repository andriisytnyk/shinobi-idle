<script lang="ts">
  import type { ActionInfo } from '@shinobi/core';
  import { actionRef } from '../lib/entities.ts';
  import { formatSeconds, formatXp } from '../lib/format.ts';
  import { canPin } from '../lib/goal.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { practiceView, slotTiming } from '../lib/timing.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import MasteryRing from './MasteryRing.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import PinGoal from './PinGoal.svelte';
  import ReqTree from './ReqTree.svelte';
  import SealStrip from './SealStrip.svelte';
  import TimeBar from './TimeBar.svelte';
  import Slot from '../lib/ext/Slot.svelte';

  interface Props {
    info: ActionInfo;
  }

  let { info }: Props = $props();

  const content = game.content;
  const ref = $derived(actionRef(info));
  const slotIndex = $derived(
    game.read((gs) =>
      gs.slots.findIndex((s) => s.action?.kind === info.kind && s.action.id === info.id),
    ),
  );
  const running = $derived(slotIndex >= 0);
  const timing = $derived(game.read((gs) => slotTiming(gs, slotIndex, info.intervalMs)));
  const technique = $derived(
    info.kind === 'practice' ? content.techniques.find((x) => x.id === info.id) : undefined,
  );
  /** The phases of the practice while it runs, and how many seals the technique has. */
  const view = $derived(
    technique && running
      ? game.read((gs) => practiceView(gs, slotIndex, content, info.intervalMs))
      : null,
  );
  /** The strip also shows on a tile that is idle, so the player sees what the technique asks for. */
  const stripSeals = $derived(technique?.sealSeq ?? []);
  const flash = $derived(
    view ? { timing: view.timing, from: view.phases.sealsEnd, to: view.phases.releaseEnd } : null,
  );

  function toggle(): void {
    const result = running
      ? game.dispatch({ type: 'action.stop', slot: slotIndex })
      : game.dispatch({ type: 'action.start', slot: 0, kind: info.kind, id: info.id });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

<li
  class="tile"
  class:locked={!info.available}
  class:running
  data-action={info.id}
  data-ui="action-tile"
  data-entity="{ref.kind}:{ref.id}"
>
  <div class="top">
    <ActionEmblem
      kind={ref.kind}
      id={ref.id}
      skill={info.skill}
      rank={technique?.rank ?? null}
      {flash}
    />
    <div class="main">
      <div class="head">
        <h3 class="name"><EntityLink kind={ref.kind} id={ref.id} /></h3>
        <span class="corner">
          <MasteryRing level={info.masteryLevel} progress={info.masteryProgress} />
          {#if canPin(ref.kind)}<PinGoal
              kind={ref.kind}
              id={ref.id}
              always={!info.available}
            />{/if}
        </span>
      </div>
      {#if stripSeals.length > 0}
        <SealStrip seals={stripSeals} {view} compact />
      {/if}
    </div>
  </div>

  <dl class="facts">
    <div>
      <dt>{t('tile.level')}</dt>
      <dd>{info.level}</dd>
    </div>
    <div data-ui="action-interval">
      <dt>{t('tile.interval')}</dt>
      <dd>{formatSeconds(info.intervalMs)}</dd>
    </div>
    <div data-ui="action-xp">
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
      <TimeBar {timing} part="action-progress" />
    {/if}
    <button type="button" class="action" class:stop={running} onclick={toggle}>
      {t(running ? 'tile.stop' : 'tile.start')}
    </button>
  {:else if info.req}
    <div class="req">
      <p class="locked-label"><Icon name="lucide:lock" size={14} /> {t('tile.locked')}</p>
      <ReqTree node={info.req} />
      {#if canPin(ref.kind)}
        <p class="pin-caption"><PinGoal kind={ref.kind} id={ref.id} variant="link" /></p>
      {/if}
    </div>
  {/if}
  <Slot name="action.tile" ctx={{ action: { kind: info.kind, id: info.id } }} />
</li>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    list-style: none;
  }

  .tile.running {
    border-color: var(--accent);
  }

  /* The emblem sits left of the title; the numbers go under both. */
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .corner {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
  }

  .pin-caption {
    margin: var(--space-1) 0 0;
  }

  .name {
    margin: 0;
    font-size: var(--text-sm);
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
    font-size: var(--text-2xs);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .action {
    min-height: var(--control-md);
    padding: var(--space-2) var(--space-4);
    border: var(--border-thin) solid var(--accent);
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
    font-size: var(--text-xs);
  }

  .req {
    font-size: var(--text-xs);
  }
</style>
