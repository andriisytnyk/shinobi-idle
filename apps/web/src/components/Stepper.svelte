<script lang="ts">
  import { t } from '../lib/i18n.ts';

  interface Props {
    /** The amount; 0 while the typed text is not a whole number of at least 1. */
    value: number;
    /** What the «макс» button sets: the most that can be bought or sold (at least 1 is used). */
    max?: number;
    /** Accessible name: says what the amount is of. */
    label: string;
    /** Pressing Enter in the field. */
    onSubmit?: () => void;
  }

  let { value = $bindable(1), max = 1, label, onSubmit }: Props = $props();

  let text = $state(String(value));

  const parse = (s: string): number => (/^\d{1,7}$/.test(s.trim()) ? Number(s) : 0);

  // The parent may change the amount (a smaller bank); the field follows when it differs.
  $effect(() => {
    if (value >= 1 && value !== parse(text)) text = String(value);
  });

  const set = (n: number) => {
    const next = Math.max(1, Math.min(9_999_999, n));
    text = String(next);
    value = next;
  };
  const current = () => (value >= 1 ? value : 0);
</script>

<div class="stepper" role="group" aria-label={label}>
  <button
    type="button"
    data-dec
    aria-label={t('stepper.dec', { what: label })}
    onclick={() => set(current() - 1)}
  >
    &minus;
  </button>
  <input
    type="text"
    inputmode="numeric"
    autocomplete="off"
    data-qty
    aria-label={label}
    aria-invalid={value < 1}
    bind:value={text}
    oninput={() => (value = parse(text))}
    onkeydown={(e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        set(current() + 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        set(current() - 1);
      } else if (e.key === 'Enter') {
        onSubmit?.();
      }
    }}
  />
  <button
    type="button"
    data-inc
    aria-label={t('stepper.inc', { what: label })}
    onclick={() => set(current() + 1)}
  >
    +
  </button>
  <button type="button" class="wide" data-ten onclick={() => set(current() + 10)}>+10</button>
  <button type="button" class="wide" data-max onclick={() => set(max)}>{t('stepper.max')}</button>
</div>

<style>
  .stepper {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  button,
  input {
    min-width: var(--control-size);
    min-height: var(--control-size);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
  }

  button {
    font-size: var(--font-size-1-1);
    cursor: pointer;
  }

  .wide {
    padding: 0 var(--space-2);
    font-size: var(--font-size-0-9);
  }

  input {
    width: var(--size-4-5);
    background: var(--surface);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
</style>
