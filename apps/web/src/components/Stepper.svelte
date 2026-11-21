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
  /** Leaving the field (or Enter) puts a text that is not a whole number back into the range. */
  const settle = () => {
    if (value < 1) set(1);
    else if (String(value) !== text) text = String(value);
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
    value={text}
    oninput={(e) => {
      // Read the field itself: the text and the amount must come from the same keystroke.
      text = e.currentTarget.value;
      value = parse(text);
    }}
    onblur={settle}
    onkeydown={(e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        set(current() + 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        set(current() - 1);
      } else if (e.key === 'Enter') {
        settle();
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
    min-width: var(--control-md);
    min-height: var(--control-md);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
  }

  button {
    font-size: var(--text-md);
    cursor: pointer;
  }

  .wide {
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
  }

  input {
    --_width: 4.5rem;
    width: var(--_width);
    background: var(--surface);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
</style>
