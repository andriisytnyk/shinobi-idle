<script lang="ts">
  import { cloneSlots } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import ClonePouch from './ClonePouch.svelte';

  interface Props {
    kind: string;
    id: string;
    /** Whether the action cannot be started at all (it is locked, or lacks an ingredient). */
    disabled?: boolean;
  }

  let { kind, id, disabled = false }: Props = $props();

  /** The slot of the clone, once the player knows the technique that opens it; -1 before. */
  const slot = $derived(game.read((gs) => cloneSlots(gs, game.content)[0]?.slot ?? -1));
  /** Whether the clone exists: then the action goes to it at once; else a clone is made first, with a pouch. */
  const exists = $derived(game.read((gs) => slot >= 0 && gs.clones[slot] !== undefined));
  /** Whether the clone already runs it; the character running it too does not matter, unless the action is unique. */
  const running = $derived(
    game.read((gs) => {
      // An action that is unique by nature runs in one performer only: a button for the other would be refused.
      if (game.rules.actionKinds[kind]?.unique?.(id, game.content))
        return gs.slots.some((s) => s.action?.kind === kind && s.action.id === id);
      const action = gs.slots[slot]?.action;
      return (
        slot >= 0 && gs.clones[slot] !== undefined && action?.kind === kind && action.id === id
      );
    }),
  );
  let picking = $state(false);

  function start(): void {
    const result = game.dispatch({ type: 'action.start', slot, kind, id });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }

  function click(): void {
    if (exists) start();
    else picking = true;
  }
</script>

{#if slot >= 0 && !running}
  <button
    type="button"
    class="ct-action clone"
    data-ui="clone-start"
    {disabled}
    title={t('clone.startTitle')}
    onclick={click}
  >
    {t('tile.clone')}
  </button>
{/if}
{#if picking}
  <ClonePouch
    onClose={() => (picking = false)}
    onMade={() => {
      picking = false;
      start();
    }}
  />
{/if}
