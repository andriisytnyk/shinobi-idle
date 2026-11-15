<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    children?: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<article class="simple-page">
  <h1>{title}</h1>
  {@render children?.()}
</article>

<style>
  h1 {
    margin: 0 0 var(--space-3);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--font-size-1-6);
    font-weight: 400;
  }
</style>
