<script lang="ts">
  import { markShown } from '../lib/reveal.ts';

  interface Props {
    kind: string;
    id: string;
  }

  let { kind, id }: Props = $props();

  // Mounted only while the entity is not yet shown in full: it tells the core once, and goes when the core agrees.
  $effect(() => {
    markShown([{ kind, id }]);
  });
</script>
