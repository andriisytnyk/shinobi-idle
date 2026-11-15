<script lang="ts">
  import type { Rank } from '@shinobi/content';
  import { emblemTint } from '../lib/emblem.ts';
  import { game } from '../lib/store.ts';
  import { timeProgress, type ProgressTiming } from '../lib/time-progress.ts';
  import Icon from './Icon.svelte';
  import RankStamp from './RankStamp.svelte';

  interface Props {
    /** Entity kind of the action: `technique`, `exercise`, `practice`, `obstacle`, `item` (herb), `recipe`. */
    kind: string;
    id: string;
    /** The skill the action trains; gives the tint of everything but techniques. */
    skill?: string;
    rank?: Rank | null;
    size?: 'sm' | 'md' | 'lg';
    /** A raw icon name for an action whose kind has no pictogram in the content (a map cell, a mission). */
    icon?: string;
    /** The release flash of a practice: the cycle's timing and the fractions the flash covers. */
    flash?: { timing: ProgressTiming; from: number; to: number } | null;
  }

  let { kind, id, skill, rank = null, size = 'md', icon, flash = null }: Props = $props();

  const content = game.content;
  const tint = $derived(emblemTint(content, { kind, id, skill }));
  // An action without a picture gets the generic glyph: the Icon resolves an empty name to it.
  const name = $derived(content.icons[kind]?.[id] ?? icon ?? '');
</script>

<span
  class="emblem {size}"
  data-ui="action-emblem"
  data-emblem-kind={kind}
  data-emblem-icon={name || 'fallback'}
  style:--_tint={tint}
>
  <Icon {name} size={32} />
  {#if flash}
    <span
      class="glow"
      data-emblem-flash
      style:--_from={flash.from}
      style:--_to={flash.to}
      use:timeProgress={flash.timing}
    ></span>
  {/if}
  {#if rank}<span class="rank"><RankStamp {rank} size="xs" /></span>{/if}
</span>

<style>
  .emblem {
    --_size: 3.5rem;
    --_tint: var(--steel);
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--_size);
    height: var(--_size);
    border: var(--border-thick) solid var(--_tint);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--_tint) 18%, var(--surface));
    color: color-mix(in srgb, var(--_tint) 60%, var(--fg));
  }

  .emblem.sm {
    --_size: 2rem;
    border-width: var(--border-thin);
  }

  .emblem.lg {
    --_size: 4.5rem;
  }

  /* The icon fills most of the medallion, whatever the medallion's size. */
  .emblem :global(svg) {
    width: 62%;
    height: 62%;
  }

  /* The release flash: a ring that lights while the cycle is between --_from and --_to. */
  .glow {
    --_from: 2;
    --_to: 3;
    position: absolute;
    inset: calc(-2 * var(--border-thick));
    border: var(--border-thick) solid var(--_tint);
    border-radius: var(--radius-pill);
    box-shadow: 0 0 var(--space-3) var(--_tint);
    opacity: calc(
      clamp(0, (var(--tp, 0) - var(--_from)) * 1000, 1) -
        clamp(0, (var(--tp, 0) - var(--_to)) * 1000, 1)
    );
    pointer-events: none;
  }

  .rank {
    position: absolute;
    right: calc(-1 * var(--space-1));
    bottom: calc(-1 * var(--space-1));
  }

  @media (max-width: 768px) {
    .emblem {
      --_size: 2.75rem;
    }

    .emblem.sm {
      --_size: 1.75rem;
    }

    .emblem.lg {
      --_size: 3.5rem;
    }
  }
</style>
