<script lang="ts">
  import { formatInt } from '../lib/format.ts';

  interface Props {
    label: string;
    value: number;
    max: number;
    /** Which colour token fills the bar. */
    tone: 'hp' | 'chakra' | 'stamina' | 'enemy';
  }

  let { label, value, max, tone }: Props = $props();

  const fraction = $derived(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
</script>

<div class="stat" data-tone={tone}>
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
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr) auto;
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
    font-size: 0.85rem;
  }

  .bar {
    height: 10px;
    border-radius: 5px;
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--tone);
  }

  .value {
    min-width: 5rem;
    font-size: 0.85rem;
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
</style>
