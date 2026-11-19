<script lang="ts">
  import { defaultPouch } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Modal from './Modal.svelte';

  interface Props {
    /** Called with the clone made; the opener goes on with what it wanted the clone to do. */
    onMade: () => void;
    onClose: () => void;
    /** The slot the clone is made in; the next free one when omitted. */
    slot?: number | undefined;
  }

  let { onMade, onClose, slot }: Props = $props();

  /** What the Bank holds, with the default pick: the stacks of the character's pouch. */
  const stock = $derived(
    game.read((gs) => ({
      bank: Object.entries(gs.bank)
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
      pick: defaultPouch(gs, game.content),
    })),
  );

  let taken = $state<Record<string, number>>({});
  let ready = $state(false);

  $effect(() => {
    if (!ready) {
      taken = { ...stock.pick };
      ready = true;
    }
  });

  function make(): void {
    const items = Object.fromEntries(Object.entries(taken).filter(([, n]) => n > 0));
    const result = game.dispatch({
      type: 'clone.create',
      items,
      ...(slot !== undefined ? { slot } : {}),
    });
    if (!result.ok) {
      toasts.push({ key: result.reason, params: refusalParams(result) });
      return;
    }
    onMade();
  }
</script>

<Modal title={t('clone.pouch.title')} {onClose}>
  <div data-ui="clone-pouch">
    <p>{t('clone.pouch.note')}</p>
    {#if stock.bank.length === 0}
      <p>{t('clone.pouch.empty')}</p>
    {:else}
      <ul class="pouch-list">
        {#each stock.bank as [id, have] (id)}
          <li>
            <label>
              <span><EntityLink kind="item" {id} /> ({have})</span>
              <input
                type="number"
                min="0"
                max={have}
                step="1"
                value={taken[id] ?? 0}
                oninput={(e) => {
                  const n = Math.floor(Number(e.currentTarget.value));
                  taken[id] = Number.isFinite(n) ? Math.min(have, Math.max(0, n)) : 0;
                }}
              />
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {#snippet actions()}
    <button type="button" data-ui="clone-pouch-make" onclick={make}>{t('clone.pouch.make')}</button>
    <button type="button" onclick={onClose}>{t('clone.pouch.cancel')}</button>
  {/snippet}
</Modal>

<style>
  .pouch-list {
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  label {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1) 0;
  }
</style>
