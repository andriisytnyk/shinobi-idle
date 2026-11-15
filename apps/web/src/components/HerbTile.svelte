<script lang="ts">
  import { content } from '@shinobi/content';
  import { SHARE_FULL, type ActionInfo } from '@shinobi/core';
  import { blockOf, blockText, bushView } from '../lib/crafts.ts';
  import { formatDuration, formatInt, formatSeconds, formatXp } from '../lib/format.ts';
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

  const bush = $derived(game.read((gs) => bushView(gs, info.id, content, game.rules)));
  const slotIndex = $derived(
    game.read((gs) =>
      gs.slots.findIndex((s) => s.action?.kind === info.kind && s.action.id === info.id),
    ),
  );
  const running = $derived(slotIndex >= 0);
  /** How far through the current cycle (an empty bush: through its regrow) the running action is, 0..1. */
  const cycle = $derived(
    game.read((gs) => {
      const slot = gs.slots[slotIndex];
      // An empty bush's cycle also holds the regrow, which the tile's interval leaves out.
      const length = info.intervalMs + (bush.empty ? bush.regrowMs : 0);
      return slot ? Math.min(1, slot.progress / (length * SHARE_FULL)) : 0;
    }),
  );
  const block = $derived(info.available ? null : blockOf(info.req));
  const stockFraction = $derived(bush.size > 0 ? bush.stock / bush.size : 0);

  function toggle(): void {
    const result = running
      ? game.dispatch({ type: 'action.stop', slot: slotIndex })
      : game.dispatch({ type: 'action.start', slot: 0, kind: info.kind, id: info.id });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }
</script>

<li class="ct-tile" class:running data-herb={info.id} data-action={info.id}>
  <div class="ct-head">
    <h3 class="ct-name">
      <span class="ct-icon"><Icon entity={{ kind: 'item', id: info.id }} size={22} /></span>
      <EntityLink kind="item" id={info.id} />
    </h3>
    <MasteryRing level={info.masteryLevel} progress={info.masteryProgress} />
  </div>

  <dl class="ct-facts">
    <div>
      <dt>{t('tile.level')}</dt>
      <dd>{info.level}</dd>
    </div>
    <div>
      <dt>{t('tile.interval')}</dt>
      <dd>
        <ModBreakdown
          keys={['interval.skill.herb', 'speed.skill.herb']}
          display={formatSeconds(info.intervalMs)}
          base={formatSeconds(content.balance.K.gather * 1000)}
        />
      </dd>
    </div>
    <div>
      <dt>{t('tile.xph')}</dt>
      <dd>
        <ModBreakdown
          keys={['xp.all', 'xp.skill.herb']}
          display={t('tile.xphValue', { n: formatXp(info.xpPerHour) })}
        />
      </dd>
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
    <span class="ct-bar" aria-hidden="true"
      ><span class="ct-fill" style:width="{cycle * 100}%"></span></span
    >
  {/if}

  {#if info.req && !info.available}
    <div class="req">
      <p class="ct-locked"><Icon name="lucide:lock" size={14} /> {t('tile.locked')}</p>
      <ReqTree node={info.req} />
    </div>
  {/if}

  <button
    type="button"
    class="ct-action"
    class:stop={running}
    disabled={!info.available}
    aria-describedby={block ? `why-${info.id}` : undefined}
    onclick={toggle}
  >
    {t(running ? 'tile.stop' : 'tile.start')}
  </button>
  {#if block}
    <p class="ct-why" id="why-{info.id}" data-why={block.kind}>{blockText(block)}</p>
  {/if}
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
    font-size: 0.9rem;
  }
</style>
