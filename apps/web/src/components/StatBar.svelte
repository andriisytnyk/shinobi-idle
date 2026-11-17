<script lang="ts">
  import { formatInt } from '../lib/format.ts';

  interface Props {
    label: string;
    value: number;
    max: number;
    /** Which colour token fills the bar. */
    tone: 'hp' | 'chakra' | 'stamina' | 'enemy';
    /** On a phone: one line (label, bar, value) instead of two. */
    dense?: boolean;
  }

  let { label, value, max, tone, dense = false }: Props = $props();

  const fraction = $derived(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
</script>

<div class="stat" class:dense data-tone={tone}>
  <span class="label">{label}</span>
  <div
    class="bar"
    role="progressbar"
    aria-label={label}
    aria-valuemin="0"
    aria-valuemax={Math.round(max)}
    aria-valuenow={Math.round(Math.max(0, value))}
  >
    <span class="fill" style:width="{fraction * 100}%"></span>
  </div>
  <span class="value">{formatInt(Math.max(0, value))} / {formatInt(max)}</span>
</div>

<style>
  .stat {
    --_grid-template-columns: 7rem;
    display: grid;
    grid-template-columns: var(--_grid-template-columns) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    --tone: var(--hp);
  }

  .stat[data-tone='chakra'] {
    --tone: var(--chakra);
  }

  .stat[data-tone='stamina'] {
    --tone: var(--stamina);
  }

  .stat[data-tone='enemy'] {
    --tone: var(--danger);
  }

  .label {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .bar {
    height: var(--bar-thick);
    border-radius: var(--radius-sm);
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--tone);
  }

  .value {
    --_min-width: 5rem;
    min-width: var(--_min-width);
    font-size: var(--text-xs);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 480px) {
    .stat {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'label value'
        'bar bar';
    }

    .label {
      grid-area: label;
    }

    .bar {
      grid-area: bar;
    }

    .value {
      grid-area: value;
    }
  }

  /* A dense bar on a phone: label, bar and value on one line. */
  @media (max-width: 768px) {
    .stat.dense {
      --_label-width: 5.5rem;
      grid-template-columns: var(--_label-width) minmax(0, 1fr) auto;
      grid-template-areas: none;
      gap: var(--space-2);
    }

    .stat.dense .label,
    .stat.dense .bar,
    .stat.dense .value {
      grid-area: auto;
    }

    .stat.dense .bar {
      height: var(--bar-md);
    }

    .stat.dense .value {
      --_min-width: 4rem;
    }
  }
</style>
