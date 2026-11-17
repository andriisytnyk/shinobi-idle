<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    /** On a phone the title is read by screen readers only: the page needs the room (the map). */
    compact?: boolean;
    children?: Snippet;
  }

  let { title, compact = false, children }: Props = $props();
</script>

<article class="simple-page">
  <h1 class:compact>{title}</h1>
  {@render children?.()}
</article>

<style>
  h1 {
    margin: 0 0 var(--space-3);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: 400;
  }

  @media (max-width: 768px) {
    h1.compact {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  }
</style>
