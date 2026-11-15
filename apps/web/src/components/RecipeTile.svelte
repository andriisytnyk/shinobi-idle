<script lang="ts">
  import { content } from '@shinobi/content';
  import { SHARE_FULL, type ActionInfo } from '@shinobi/core';
  import { blockOf, blockText, tierView } from '../lib/crafts.ts';
  import { formatInt, formatSeconds, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import IngredientRow from './IngredientRow.svelte';
  import MasteryRing from './MasteryRing.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import ReqTree from './ReqTree.svelte';

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
  const cycle = $derived(
    game.read((gs) => {
      const slot = gs.slots[slotIndex];
      return slot ? Math.min(1, slot.progress / (info.intervalMs * SHARE_FULL)) : 0;
    }),
  );
  const block = $derived(info.available ? null : blockOf(info.req));

  function toggle(): void {
    const result = running
      ? game.dispatch({ type: 'action.stop', slot: slotIndex })
      : game.dispatch({ type: 'action.start', slot: 0, kind: info.kind, id: info.id });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }
</script>

<li
  class="ct-tile"
  class:running
  data-recipe={info.id}
  data-action={info.id}
  data-ui="action-tile"
  data-entity="recipe:{info.id}"
>
  <div class="ct-head">
    <h3 class="ct-name">
      {#each info.outputs.slice(0, 1) as out (out.item)}
        <span class="ct-icon"><Icon entity={{ kind: 'item', id: out.item }} size={22} /></span>
      {/each}
      <EntityLink kind="recipe" id={info.id} />
    </h3>
    <MasteryRing level={info.masteryLevel} progress={info.masteryProgress} />
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
        <li class="output" data-output={out.item}>
          <Icon entity={{ kind: 'item', id: out.item }} size={18} />
          <span class="qty">&times;{formatInt(out.n)}</span>
          <EntityLink kind="item" id={out.item} />
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
    <span class="ct-bar" aria-hidden="true"
      ><span class="ct-fill" style:width="{cycle * 100}%"></span></span
    >
  {/if}

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
  {#if block && !running}
    <p class="ct-why" id="why-{info.id}" data-why={block.kind}>{blockText(block)}</p>
    {#if info.req && block.kind !== 'missing'}
      <div class="req"><ReqTree node={info.req} /></div>
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
    font-size: var(--font-size-0-9);
  }

  .qty {
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
</style>
