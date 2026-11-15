<script lang="ts">
  import { formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import type { Reward } from '../lib/missions.ts';
  import { resourceIcon } from '../lib/village.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    reward: Reward;
  }

  let { reward }: Props = $props();

  const currencyKey = $derived(reward.t === 'currency' ? `topbar.${reward.id}` : '');
  const percent = $derived(reward.t === 'item' ? Math.round(reward.chance * 100) : 100);
</script>

<span
  class="reward"
  data-ui="mission-reward"
  data-entity="{reward.t}:{reward.id}"
  data-reward={reward.t}
>
  {#if reward.t === 'currency'}
    <Icon entity={{ kind: 'currency', id: reward.id }} size={16} />
    <span>+{formatInt(reward.n)} {hasKey(currencyKey) ? t(currencyKey) : reward.id}</span>
  {:else if reward.t === 'item'}
    <Icon entity={{ kind: 'item', id: reward.id }} size={16} />
    <span>
      <EntityLink kind="item" id={reward.id} />
      {#if reward.n > 1}×{formatInt(reward.n)}{/if}
      {#if percent < 100}<span class="chance">{t('mission.chance', { pct: percent })}</span>{/if}
    </span>
  {:else}
    <Icon name={resourceIcon(reward.id)} size={16} />
    <a href="#/village">+{formatInt(reward.n)} {t(`resource.${reward.id}.name`)}</a>
  {/if}
</span>

<style>
  .reward {
    display: inline-flex;
    align-items: center;
    line-height: var(--leading-tight);
    gap: var(--space-1);
  }

  .reward a {
    color: var(--fg);
    text-decoration: none;
  }

  .reward a:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  .chance {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }
</style>
