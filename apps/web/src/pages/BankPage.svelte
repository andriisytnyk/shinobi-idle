<script lang="ts">
  import { content } from '@shinobi/content';
  import { masteryLevel } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  /** Items the player holds, in the order of the content. */
  const rows = $derived(
    content.items
      .filter((item) => (game.state.bank[item.id] ?? 0) > 0)
      .map((item) => ({ item, n: game.state.bank[item.id] ?? 0 })),
  );

  /** The item being used, while the player picks a target. */
  let picking = $state<string | null>(null);
  let error = $state<string | null>(null);

  const pickingItem = $derived(content.items.find((i) => i.id === picking));
  const targets = $derived(
    pickingItem?.use
      ? content.techniques.filter((tech) => tech.mentor === pickingItem.use?.mentor)
      : [],
  );

  function use(target: string): void {
    if (!picking) return;
    const result = game.dispatch({ type: 'item.use', id: picking, target });
    if (result.ok) {
      picking = null;
      error = null;
    } else {
      error = result.reason;
    }
  }

  const close = () => {
    picking = null;
    error = null;
  };
</script>

<SimplePage title={t('bank.title')}>
  <Hint id="bank" />

  {#if rows.length === 0}
    <p class="empty">{t('bank.empty')}</p>
  {/if}

  <ul class="items">
    {#each rows as { item, n } (item.id)}
      <li class="item" data-item={item.id}>
        <span class="icon"><Icon entity={{ kind: 'item', id: item.id }} size={32} /></span>
        <span class="name"><EntityLink kind="item" id={item.id} /></span>
        <span class="qty" aria-label={t('bank.quantity')}>&times;{formatInt(n)}</span>
        {#if item.use}
          <button type="button" class="use" onclick={() => (picking = item.id)}>
            {t('bank.use')}
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</SimplePage>

{#if picking && pickingItem}
  <Modal title={t('bank.pick')} onClose={close}>
    <p class="help">{t('bank.pickHelp')}</p>
    <ul class="targets" data-targets>
      {#each targets as tech (tech.id)}
        <li class="target" data-target={tech.id}>
          <span class="icon"><Icon entity={{ kind: 'technique', id: tech.id }} size={24} /></span>
          <span class="name">
            <EntityLink kind="technique" id={tech.id} />
            <span class="level"
              >{t('bank.mastery', { n: masteryLevel(game.state, tech.id, content) })}</span
            >
          </span>
          <button type="button" class="pick" onclick={() => use(tech.id)}>{t('bank.apply')}</button>
        </li>
      {/each}
    </ul>
    {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
    {#snippet actions()}
      <button type="button" onclick={close}>{t('settings.cancel')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .empty,
  .help {
    color: var(--fg-dim);
  }

  .items,
  .targets {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item,
  .target {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .icon {
    display: inline-flex;
    color: var(--steel);
  }

  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }

  @media (max-width: 768px) {
    .name :global(a) {
      display: inline-flex;
      align-items: center;
      min-height: 2.75rem;
    }
  }

  .level {
    display: block;
    color: var(--fg-dim);
    font-size: 0.8rem;
    font-weight: 400;
  }

  .qty {
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
  }

  .use,
  .pick {
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .error {
    color: var(--danger);
  }
</style>
