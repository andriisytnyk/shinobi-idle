<script lang="ts">
  import { t } from '../lib/i18n.ts';

  interface Props {
    level: number;
    /** Fraction of the way to the next level, 0..1. */
    progress: number;
    size?: number;
  }

  let { level, progress, size = 44 }: Props = $props();

  const RADIUS = 18;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const dash = $derived(Math.max(0, Math.min(1, progress)) * CIRCUMFERENCE);
</script>

<span
  class="ring"
  data-ui="mastery-ring"
  role="img"
  aria-label={t('mastery.ring', { n: level, pct: Math.round(progress * 100) })}
  style:width="{size}px"
  style:height="{size}px"
>
  <svg viewBox="0 0 44 44" width={size} height={size} aria-hidden="true">
    <circle class="track" cx="22" cy="22" r={RADIUS} />
    <circle
      class="value"
      cx="22"
      cy="22"
      r={RADIUS}
      stroke-dasharray="{dash} {CIRCUMFERENCE}"
      transform="rotate(-90 22 22)"
    />
  </svg>
  <span class="level">{level}</span>
</span>

<style>
  .ring {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
  }

  svg {
    position: absolute;
    inset: 0;
  }

  circle {
    fill: none;
    stroke-width: 4;
  }

  .track {
    stroke: var(--line);
  }

  .value {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dasharray var(--duration-base);
  }

  .level {
    position: relative;
    font-size: var(--font-size-0-85);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
