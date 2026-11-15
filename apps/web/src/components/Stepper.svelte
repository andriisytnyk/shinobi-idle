<script lang="ts">
  import { t } from '../lib/i18n.ts';

  interface Props {
    value: number;
    min?: number;
    max?: number;
    /** Accessible name of the whole control. */
    label: string;
  }

  let { value = $bindable(1), min = 1, max = 999, label }: Props = $props();

  const set = (n: number) => {
    value = Math.min(max, Math.max(min, n));
  };
</script>

<div class="stepper" role="group" aria-label={label}>
  <button type="button" data-dec aria-label={t('stepper.dec')} onclick={() => set(value - 1)}>
    &minus;
  </button>
  <output aria-live="polite" data-qty>{value}</output>
  <button type="button" data-inc aria-label={t('stepper.inc')} onclick={() => set(value + 1)}>
    +
  </button>
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  button {
    min-width: 2.75rem;
    min-height: 2.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    font-size: 1.1rem;
    cursor: pointer;
  }

  output {
    min-width: 2.25rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
