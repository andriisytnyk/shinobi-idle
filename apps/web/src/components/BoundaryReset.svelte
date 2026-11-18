<script lang="ts">
  import { untrack } from 'svelte';

  interface Props {
    /** When this changes, the boundary tries again (the player went to another page). */
    resetKey: string;
    reset: () => void;
  }

  let { resetKey, reset }: Props = $props();

  const first = untrack(() => resetKey);
  $effect(() => {
    if (resetKey !== first) untrack(reset);
  });
</script>
