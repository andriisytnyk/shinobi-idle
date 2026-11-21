<script lang="ts">
  import { entityAttr, idAttr } from '../lib/reveal.ts';
  import { evalReq, type ActionInfo } from '@shinobi/core';
  import { actionRef } from '../lib/entities.ts';
  import { formatSeconds, formatXp } from '../lib/format.ts';
  import { canPin, techniqueRankReq } from '../lib/goal.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { practiceView, slotTiming } from '../lib/timing.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import StartSplit from './StartSplit.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import MasteryRing from './MasteryRing.svelte';
  import PerformerMarks from './PerformerMarks.svelte';
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
  /**
   * What the locked tile lists. A technique's rank (the mentor teaches it only to a Genin) is not part of
   * the action's own requirements, so it is added here: the tile names what is NOT met, as the technique page does.
   */
  const lockReq = $derived.by(() => {
    const base = info.req;
    if (!base || !technique) return base;
    const rank = techniqueRankReq(technique.id, content);
    if (!rank) return base;
    const of = base.req.t === 'all' ? base.req.of : [base.req];
    return game.read((gs) => evalReq(gs, { t: 'all', of: [...of, rank] }, content));
  });
  const stripSeals = $derived(technique?.sealSeq ?? []);
  const flash = $derived(
    view ? { timing: view.timing, from: view.phases.sealsEnd, to: view.phases.releaseEnd } : null,
  );
</script>

<li
  class="tile"
  class:locked={!info.available}
  class:running
  data-action={idAttr(ref.kind, ref.id)}
  data-ui="action-tile"
  data-entity={entityAttr(ref)}
>
  <div class="top">
    <ActionEmblem
      kind={ref.kind}
      id={ref.id}
      skill={info.skill}
      rank={technique?.rank ?? null}
      size="sm"
      {flash}
    />
    <div class="main">
      <div class="head">
        <h3 class="name"><EntityLink kind={ref.kind} id={ref.id} /></h3>
        <span class="corner">
          <PerformerMarks kind={info.kind} id={info.id} />
          {#if canPin(ref.kind, content)}<PinGoal
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
    <div data-ui="action-mastery">
      <dt>{t('tile.mxph')}</dt>
      <dd>
        <ModBreakdown
          keys={['mastery.xp.all', `mastery.xp.skill.${info.skill}`]}
          display={t('tile.mxphValue', { n: formatXp(info.masteryPerHour) })}
        />
      </dd>
    </div>
    <div class="ring">
      <MasteryRing level={info.masteryLevel} progress={info.masteryProgress} size={36} />
    </div>
  </dl>

  {#if info.available}
    {#if running}
      <TimeBar {timing} part="action-progress" />
    {/if}
    <div class="ct-actions">
      <StartSplit kind={info.kind} id={info.id} />
    </div>
  {:else if lockReq}
    <div class="req">
      <p class="locked-label"><Icon name="lucide:lock" size={14} /> {t('tile.locked')}</p>
      <ReqTree node={lockReq} />
    </div>
  {/if}
  <Slot name="action.tile" ctx={{ action: { kind: info.kind, id: info.id } }} />
</li>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2);
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
    align-items: flex-start;
    gap: var(--space-2);
  }

  .main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  /* The title takes the free width and wraps only when it does not fit; the marks and the pin sit in a compact cluster in the corner. */
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .corner {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }

  .name {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow-wrap: break-word;
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .name :global(a) {
    color: var(--heading);
  }

  /* The numbers sit in even columns that reflow with the card's width; the mastery ring is the last cell. */
  .facts {
    display: grid;
    --_fact-min: 6rem;
    grid-template-columns: repeat(auto-fit, minmax(var(--_fact-min), 1fr));
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0;
  }

  .ring {
    display: flex;
    justify-content: flex-start;
  }

  dt {
    color: var(--fg-dim);
    font-size: var(--text-2xs);
  }

  dd {
    margin: 0;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
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
