<script lang="ts">
  import { ICONS, isIconName } from '../lib/icons.ts';

  interface Props {
    name: string;
    size?: number;
  }

  let { name, size = 20 }: Props = $props();

  // Unknown names fall back to the leaf so a missing icon never leaves a hole in the layout.
  const paths = $derived(ICONS[isIconName(name) ? name : 'leaf']);
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each paths as d (d)}
    <path {d} />
  {/each}
</svg>

<style>
  .icon {
    flex: none;
  }
</style>
