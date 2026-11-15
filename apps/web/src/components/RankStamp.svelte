<script lang="ts">
  import type { Rank } from '@shinobi/content';
  import { t } from '../lib/i18n.ts';

  interface Props {
    rank: Rank;
    /** `xs` is the small stamp on the corner of an emblem. */
    size?: 'md' | 'xs';
  }

  let { rank, size = 'md' }: Props = $props();

  // E has no colour of its own in the palette; it shares the grey of D.
  const color = $derived(`var(--rank-${rank === 'E' ? 'd' : rank.toLowerCase()})`);
</script>

<span class="stamp {size}" role="img" aria-label={t('rank.stamp', { rank })} style:--stamp={color}>
  {rank}
</span>

<style>
  .stamp {
    --_width: 2.25rem;
    --_height: 2.25rem;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--_width);
    height: var(--_height);
    border: var(--border-thick) solid var(--stamp);
    border-radius: var(--radius-sm);
    color: var(--stamp);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    transform: rotate(-6deg);
  }

  .stamp.xs {
    --_width: 1.15rem;
    --_height: 1.15rem;
    border-width: var(--border-thin);
    background: var(--surface);
    font-size: var(--text-2xs);
    line-height: 1;
  }
</style>
