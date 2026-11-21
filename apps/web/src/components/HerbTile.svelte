<script lang="ts">
  import { entityAttr, idAttr } from '../lib/reveal.ts';
  import type { ActionInfo } from '@shinobi/core';
  import { blockOf, blockText, bushView } from '../lib/crafts.ts';
  import { formatDuration, formatInt, formatSeconds, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { slotTiming } from '../lib/timing.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import StartSplit from './StartSplit.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import MasteryRing from './MasteryRing.svelte';
  import PerformerMarks from './PerformerMarks.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import PinGoal from './PinGoal.svelte';
  import ReqTree from './ReqTree.svelte';
  import TimeBar from './TimeBar.svelte';

  const content = game.content;

  interface Props {
    info: ActionInfo;
  }

  let { info }: Props = $props();

  const bush = $derived(game.read((gs) => bushView(gs, info.id, content, game.rules)));
  const slotIndex = $derived(
    game.read((gs) =>
      gs.slots.findIndex((s) => s.action?.kind === info.kind && s.action.id === info.id),
    ),
  );
  const running = $derived(slotIndex >= 0);
  /** The running cycle; an empty bush's cycle also holds the regrow, which the tile's interval leaves out. */
  const timing = $derived(
    game.read((gs) =>
      slotTiming(gs, slotIndex, info.intervalMs + (bush.empty ? bush.regrowMs : 0)),
    ),
  );
  const cycle = $derived(timing.fraction);
  const block = $derived(info.available ? null : blockOf(info.req));
  const stockFraction = $derived(bush.size > 0 ? bush.stock / bush.size : 0);
</script>

<li
  class="ct-tile"
  class:running
  data-herb={idAttr('item', info.id)}
  data-action={idAttr('item', info.id)}
  data-ui="action-tile"
  data-entity={entityAttr({ kind: 'item', id: info.id })}
>
  <div class="ct-top">
    <ActionEmblem kind="item" id={info.id} skill={info.skill} size="sm" />
    <div class="ct-head">
      <h3 class="ct-name"><EntityLink kind="item" id={info.id} offered /></h3>
      <span class="ct-corner">
        <PerformerMarks kind={info.kind} id={info.id} />
        <PinGoal kind="item" id={info.id} always={!info.available} />
      </span>
    </div>
  </div>

  <dl class="ct-facts">
    <div>
      <dt>{t('tile.level')}</dt>
      <dd>{info.level}</dd>
    </div>
    <div data-ui="action-interval">
      <dt>{t('tile.interval')}</dt>
      <dd>
        <ModBreakdown
          keys={[`interval.skill.${info.skill}`, `speed.skill.${info.skill}`]}
          display={formatSeconds(info.intervalMs)}
          base={formatSeconds(info.baseMs)}
        />
      </dd>
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
    <div class="ct-ring">
      <MasteryRing level={info.masteryLevel} progress={info.masteryProgress} size={36} />
    </div>
  </dl>

  <div class="bush" data-bush data-empty={bush.empty}>
    <p class="line">
      <span>{t('herb.bush')}</span>
      <span data-stock>{formatInt(bush.stock)}/{formatInt(bush.size)}</span>
    </p>
    <span class="ct-bar" aria-hidden="true"
      ><span class="ct-fill stock" style:width="{stockFraction * 100}%"></span></span
    >
    {#if bush.empty}
      <p class="ct-note" data-regrow>
        {#if running}
          {t('herb.regrowing', {
            time: formatDuration(Math.max(0, (1 - cycle) * (info.intervalMs + bush.regrowMs))),
          })}
        {:else}
          {t('herb.emptyIdle', { time: formatDuration(bush.regrowMs) })}
        {/if}
      </p>
    {:else}
      <p class="ct-note">
        {t('herb.regrowNote', { time: formatDuration(bush.regrowMs), size: bush.size })}
      </p>
    {/if}
  </div>

  {#if running}
    <TimeBar {timing} part="action-progress" />
  {/if}

  {#if info.req && !info.available}
    <div class="req">
      <p class="ct-locked"><Icon name="lucide:lock" size={14} /> {t('tile.locked')}</p>
      <ReqTree node={info.req} />
    </div>
  {/if}

  {#if block}
    <p class="ct-why" id="why-{info.id}" data-why={block.kind}>{blockText(block)}</p>
  {/if}
  <div class="ct-actions">
    <StartSplit
      kind={info.kind}
      id={info.id}
      disabled={!info.available}
      describedBy={block ? `why-${info.id}` : undefined}
    />
  </div>
</li>

<style>
  .bush {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .line {
    display: flex;
    justify-content: space-between;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .req {
    font-size: var(--text-xs);
  }
</style>
