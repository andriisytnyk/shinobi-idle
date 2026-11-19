<script lang="ts">
  import { nextStateHint } from '../lib/hints.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { game } from '../lib/store.ts';
  import Hint from './Hint.svelte';

  const content = game.content;

  /** The hint whose moment has come (first level, first Mastery, exam ready, graduation), one at a time. */
  const hint = $derived(
    game.read((gs) => nextStateHint(gs, content, (id) => settings.hintVisible(id), game.signals)),
  );
</script>

{#if hint}
  {#key hint.id}<Hint id={hint.id} />{/key}
{/if}
