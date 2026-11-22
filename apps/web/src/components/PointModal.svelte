<script lang="ts">
  import type { PointInfo } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import ModLine from './ModLine.svelte';
  import RewardList from './RewardList.svelte';

  /** What a point paid when it was found; the same shape the discovery event carries. */
  export interface PointReward {
    ryo?: number;
    currencies?: Record<string, number>;
    items?: readonly { id?: string; item?: string; n: number }[];
    xp?: { skill: string; amount: number } | null;
  }

  interface Props {
    /** The place the point belongs to. */
    place: string;
    reward: PointReward | null;
    /** What the point gives while a performer stands on it. */
    power?: PointInfo['power'];
    /** The heading of the dialog: the name of the point, or «Знайдено точку!» on discovery. */
    title: string;
    /** On discovery the name of the point follows the heading. */
    discovered?: boolean;
    onClose: () => void;
  }

  let { place, reward, power = [], title, discovered = false, onClose }: Props = $props();
</script>

<Modal {title} {onClose}>
  <div data-point-modal={place} data-discovered={discovered}>
    <p class="name">
      <Icon name="lucide:landmark" size={18} />
      {t(`place.${place}.name`)}
    </p>
    <p class="desc">{t(`place.${place}.desc`)}</p>
    {#if power.length > 0}
      <p class="small dim">{t('map.point.bonus')}</p>
      <ul class="mods">
        {#each power as mod, j (j)}
          <li class="small"><ModLine {mod} /></li>
        {/each}
      </ul>
    {/if}
    {#if reward}
      <p class="small" data-point-reward>
        {t('map.point.reward')}
        <RewardList
          money={reward.ryo ?? 0}
          currencies={reward.currencies ?? {}}
          items={(reward.items ?? []).map((i) => ({ id: i.item ?? i.id ?? '', n: i.n }))}
          xp={reward.xp ?? null}
        />
      </p>
    {/if}
  </div>
  {#snippet actions()}
    <button type="button" class="ok" data-point-ok onclick={onClose}>{t('map.point.ok')}</button>
  {/snippet}
</Modal>

<style>
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
  }

  .desc {
    margin: 0 0 var(--space-3);
  }

  .small {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .dim {
    color: var(--fg-dim);
  }

  .mods {
    margin: 0 0 var(--space-2);
    padding: 0;
    list-style: none;
  }

  .ok {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
</style>
