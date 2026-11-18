<script lang="ts">
  import { dt } from './texts.ts';

  interface Props {
    label: string;
    options: readonly { id: string; name: string }[];
    value: string;
  }

  let { label, options, value = $bindable() }: Props = $props();

  let filter = $state('');
  const shown = $derived(
    options
      .filter((o) => `${o.name} ${o.id}`.toLowerCase().includes(filter.trim().toLowerCase()))
      .slice(0, 200),
  );
</script>

<div class="pick">
  <span class="cap">{label}</span>
  <input
    type="search"
    placeholder={dt('dev.search')}
    aria-label={dt('dev.search')}
    bind:value={filter}
  />
  <select aria-label={label} bind:value>
    {#each shown as o (o.id)}
      <option value={o.id}>{o.name}</option>
    {/each}
  </select>
</div>

<style>
  .pick {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
    flex: 1 1 var(--toast-width);
  }

  .cap {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  input,
  select {
    min-height: var(--control-md);
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
</style>
