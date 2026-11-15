<script lang="ts">
  import { content } from '@shinobi/content';
  import { nextStateHint } from '../lib/hints.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { game } from '../lib/store.ts';
  import Hint from './Hint.svelte';

  /** The hint whose moment has come (first level, first Mastery, exam ready, graduation), one at a time. */
  const hint = $derived(nextStateHint(game.state, content, (id) => settings.hintVisible(id)));
</script>

{#if hint}
  {#key hint.id}<Hint id={hint.id} />{/key}
{/if}
