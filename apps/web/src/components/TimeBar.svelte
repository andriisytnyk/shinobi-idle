<script lang="ts">
  import { timeProgress, type ProgressTiming } from '../lib/time-progress.ts';

  interface Props {
    timing: ProgressTiming;
    /** `data-ui` part name of the track. */
    part?: string;
    size?: 'thin' | 'md';
    tone?: 'accent' | 'chakra' | 'enemy';
    /** When set, the bar is announced as a progress bar with this label. */
    label?: string;
  }

  let { timing, part, size = 'thin', tone = 'accent', label }: Props = $props();
</script>

<span
  class="time-bar {size} {tone}"
  data-ui={part}
  role={label ? 'progressbar' : undefined}
  aria-label={label}
  aria-valuemin={label ? 0 : undefined}
  aria-valuemax={label ? 100 : undefined}
  aria-valuenow={label ? Math.round(timing.fraction * 100) : undefined}
  aria-hidden={label ? undefined : 'true'}
>
  <span class="fill" use:timeProgress={timing}></span>
</span>

<style>
  .time-bar {
    display: block;
    height: var(--bar-thin);
    border-radius: var(--radius-xs);
    background: var(--line);
    overflow: hidden;
  }

  .time-bar.md {
    height: var(--bar-md);
  }

  /* The fill is always full width; the primitive animates --tp, which scales it. */
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transform: scaleX(var(--tp, 0));
    transform-origin: 0 50%;
  }

  .chakra .fill {
    background: var(--chakra);
  }

  .enemy .fill {
    background: var(--danger);
  }
</style>
