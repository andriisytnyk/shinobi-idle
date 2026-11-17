<script lang="ts">
  import { entityAttr, idAttr } from '../lib/reveal.ts';
  import type { ActionInfo } from '@shinobi/core';
  import { blockOf, blockText, tierView } from '../lib/crafts.ts';
  import { formatInt, formatSeconds, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { slotTiming } from '../lib/timing.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import CloneStart from './CloneStart.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import IngredientRow from './IngredientRow.svelte';
  import MasteryRing from './MasteryRing.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import PinGoal from './PinGoal.svelte';
  import ReqTree from './ReqTree.svelte';
  import TimeBar from './TimeBar.svelte';

  const content = game.content;

  interface Props {
    info: ActionInfo;
  }

  let { info }: Props = $props();

  const tier = $derived(game.read((gs) => tierView(gs, info.id, content, game.rules)));
  const slotIndex = $derived(
    game.read((gs) =>
      gs.slots.findIndex((s) => s.action?.kind === info.kind && s.action.id === info.id),
    ),
  );
  const running = $derived(slotIndex >= 0);
  const timing = $derived(game.read((gs) => slotTiming(gs, slotIndex, info.intervalMs)));
  const block = $derived(info.available ? null : blockOf(info.req));

  function toggle(): void {
    const result = running
      ? game.dispatch({ type: 'action.stop', slot: slotIndex })
      : game.dispatch({ type: 'action.start', slot: 0, kind: info.kind, id: info.id });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

<li
  class="ct-tile"
  class:running
  data-recipe={idAttr('recipe', info.id)}
  data-action={idAttr('recipe', info.id)}
  data-ui="action-tile"
  data-entity={entityAttr({ kind: 'recipe', id: info.id })}
>
  <div class="ct-top">
    <ActionEmblem kind="recipe" id={info.id} skill={info.skill} />
    <div class="ct-head">
      <h3 class="ct-name"><EntityLink kind="recipe" id={info.id} offered /></h3>
      <span class="ct-corner">
        <MasteryRing level={info.masteryLevel} progress={info.masteryProgress} />
        <PinGoal kind="recipe" id={info.id} always={!info.available} />
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
          base={formatSeconds(content.balance.K.craft * 1000)}
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
  </dl>

  <div>
    <p class="ct-caption">{t('craft.needs')}</p>
    <ul class="ct-list" data-inputs>
      {#each info.inputs as input (input.item)}
        <IngredientRow item={input.item} need={input.n} have={input.have} />
      {/each}
    </ul>
  </div>

  <div>
    <p class="ct-caption">{t('craft.makes')}</p>
    <ul class="ct-list" data-outputs>
      {#each info.outputs as out (out.item)}
        <li class="output" data-output={idAttr('item', out.item)}>
          <Icon entity={{ kind: 'item', id: out.item }} size={18} />
          <span class="qty">&times;{formatInt(out.n)}</span>
          <EntityLink kind="item" id={out.item} offered />
          <span class="ct-muted"
            >{t('craft.owned', { n: formatInt(game.read((gs) => gs.bank[out.item] ?? 0)) })}</span
          >
        </li>
      {/each}
    </ul>
  </div>

  <p class="ct-note" data-tier>
    {t('craft.tier', {
      tier: tier.tier,
      tiers: tier.tiers,
      pct: Math.round(tier.bonusChance * 100),
    })}
    {#if tier.nextAt !== null}{t('craft.tierNext', { n: tier.nextAt })}{/if}
  </p>

  {#if running}
    <TimeBar {timing} part="action-progress" />
  {/if}

  <div class="ct-actions">
    <button
      type="button"
      class="ct-action"
      class:stop={running}
      disabled={!info.available && !running}
      aria-describedby={block && !running ? `why-${info.id}` : undefined}
      onclick={toggle}
    >
      {t(running ? 'tile.stop' : 'tile.start')}
    </button>
    <CloneStart kind={info.kind} id={info.id} disabled={!info.available} />
  </div>
  {#if block && !running}
    <p class="ct-why" id="why-{info.id}" data-why={block.kind}>{blockText(block)}</p>
    {#if info.req && block.kind !== 'missing'}
      <div class="req">
        <ReqTree node={info.req} />
        <p class="ct-pin-caption"><PinGoal kind="recipe" id={info.id} variant="link" /></p>
      </div>
    {/if}
  {/if}
</li>

<style>
  .output {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    color: var(--steel);
  }

  .req {
    font-size: var(--text-xs);
  }

  .qty {
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
</style>
