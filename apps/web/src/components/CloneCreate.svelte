<script lang="ts">
  import { startCommand, newCloneSlot } from '../lib/squad.ts';
  import { squadUi } from '../lib/squad-ui.svelte.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import ClonePouch from './ClonePouch.svelte';

  const content = game.content;

  /** The slot a clone made now would take; null when none can be made. */
  const free = $derived(game.read((gs) => newCloneSlot(gs, content)));
  const asked = $derived(squadUi.creating);
  /** The slot the picker was opened for: fixed while it is open, as making the clone moves `free` on. */
  let target = $state<number | null>(null);

  $effect(() => {
    if (asked === null) target = null;
    else if (target === null) target = free;
  });

  /** The pouch picker for a new clone: from «+ Створити клона» (the clone stands) or from a start menu (it takes the action). */
  function made(at: number): void {
    const then = squadUi.creating;
    squadUi.closeClone();
    if (then && then !== 'idle') {
      const result = game.dispatch(startCommand({ slot: at }, then.kind, then.id));
      if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
      else squadUi.pick(null);
      return;
    }
    squadUi.pick(at);
    toasts.push({ key: 'squad.created', params: { n: at } });
  }
</script>

{#if asked !== null && target !== null}
  <ClonePouch
    slot={target}
    onClose={() => squadUi.closeClone()}
    onMade={() => made(target as number)}
  />
{/if}
