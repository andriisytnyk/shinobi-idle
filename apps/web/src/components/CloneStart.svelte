<script lang="ts">
  import { cloneSlots } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';

  interface Props {
    kind: string;
    id: string;
    /** Whether the action cannot be started at all (it is locked, or lacks an ingredient). */
    disabled?: boolean;
  }

  let { kind, id, disabled = false }: Props = $props();

  /** The slot of the clone, once the player knows the technique that opens it; -1 before. */
  const slot = $derived(game.read((gs) => cloneSlots(gs, game.content)[0]?.slot ?? -1));
  /** Whether the action already runs, in any slot: the tile's own button stops it then. */
  const running = $derived(
    game.read((gs) => gs.slots.some((s) => s.action?.kind === kind && s.action.id === id)),
  );

  function start(): void {
    const result = game.dispatch({ type: 'action.start', slot, kind, id });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

{#if slot >= 0 && !running}
  <button
    type="button"
    class="ct-action clone"
    data-ui="clone-start"
    {disabled}
    title={t('clone.startTitle')}
    onclick={start}
  >
    {t('tile.clone')}
  </button>
{/if}
