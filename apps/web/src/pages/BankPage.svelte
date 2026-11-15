<script lang="ts">
  import { content } from '@shinobi/content';
  import { hasItem, masteryLevel, sellPrice } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import { bankTab, BANK_TABS, type BankTab } from '../lib/crafts.ts';
  import { entityName } from '../lib/entities.ts';
  import { formatInt } from '../lib/format.ts';
  import { goalItemIds } from '../lib/goal.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import SimplePage from './SimplePage.svelte';

  let tab = $state<BankTab>('all');
  let query = $state('');
  let onlyGoal = $state(false);

  /** What the bank holds and which items the shown goal asks for. */
  const view = $derived(
    game.read((gs) => ({ owned: { ...gs.bank }, goal: goalItemIds(gs, content) })),
  );

  /**
   * The rows: items the player holds; with the goal filter on, exactly the items of the goal's
   * requirement tree, held or not.
   */
  const rows = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return content.items
      .filter((item) => {
        const n = view.owned[item.id] ?? 0;
        if (onlyGoal ? !view.goal.includes(item.id) : n < 1) return false;
        if (tab !== 'all' && bankTab(item) !== tab) return false;
        return (
          needle === '' || entityName({ kind: 'item', id: item.id }).toLowerCase().includes(needle)
        );
      })
      .map((item) => ({
        item,
        n: view.owned[item.id] ?? 0,
        sellable: sellPrice(item.id, content) !== null,
        coatable: content.coat.some((c) => c.poison === item.id || c.base === item.id),
        tonic: item.fx?.kind === 'tonic',
      }));
  });

  /** The item being used on a technique, while the player picks the target. */
  let picking = $state<string | null>(null);
  let coating = $state(false);
  let error = $state<string | null>(null);

  const pickingItem = $derived(content.items.find((i) => i.id === picking));
  const targets = $derived(
    game.read((gs) =>
      pickingItem?.use
        ? content.techniques.filter((tech) =>
            pickingItem.use?.t === 'notes'
              ? tech.rank !== null && gs.known[tech.id] === true
              : tech.mentor === pickingItem.use?.mentor && gs.known[tech.id] === true,
          )
        : [],
    ),
  );
  /** Every way to coat, with what the bank holds of each part. */
  const coats = $derived(
    game.read((gs) =>
      content.coat.map((c) => {
        const product = content.items.find((i) => i.id === c.product);
        const need = (item: string) => product?.madeFrom.find((m) => m.item === item)?.n ?? 1;
        return {
          ...c,
          dose: need(c.poison),
          batch: need(c.base),
          haveDose: gs.bank[c.poison] ?? 0,
          haveBase: gs.bank[c.base] ?? 0,
          haveProduct: gs.bank[c.product] ?? 0,
          ready: hasItem(gs, c.poison, need(c.poison)) && hasItem(gs, c.base, need(c.base)),
        };
      }),
    ),
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

  function drink(id: string): void {
    const result = game.dispatch({ type: 'item.use', id });
    if (!result.ok) toasts.push({ key: result.reason, params: {} });
  }

  function coat(poison: string, base: string): void {
    const result = game.dispatch({ type: 'item.coat', poison, base });
    error = result.ok ? null : result.reason;
  }

  const close = () => {
    picking = null;
    coating = false;
    error = null;
  };
</script>

<SimplePage title={t('bank.title')}>
  <Hint id="bank" />

  <div class="tools">
    <div class="tabs" role="tablist" aria-label={t('bank.tabs')}>
      {#each BANK_TABS as id (id)}
        <button
          type="button"
          role="tab"
          class="tab"
          class:active={tab === id}
          aria-selected={tab === id}
          data-tab={id}
          onclick={() => (tab = id)}
        >
          {t(`bank.tab.${id}`)}
        </button>
      {/each}
    </div>
    <label class="search">
      <Icon name="lucide:search" size={16} />
      <input
        type="search"
        data-search
        placeholder={t('bank.search')}
        aria-label={t('bank.search')}
        bind:value={query}
      />
    </label>
    <label class="goal-filter">
      <input type="checkbox" data-goal-filter bind:checked={onlyGoal} />
      <span>{t('bank.goalFilter')}</span>
    </label>
  </div>

  {#if onlyGoal && view.goal.length === 0}
    <p class="empty" data-goal-empty>{t('bank.goalEmpty')}</p>
  {:else if rows.length === 0}
    <p class="empty" data-empty>
      {t(onlyGoal || query || tab !== 'all' ? 'bank.noMatch' : 'bank.empty')}
    </p>
  {/if}

  <ul class="items">
    {#each rows as { item, n, sellable, coatable, tonic } (item.id)}
      <li class="item" class:none={n < 1} data-item={item.id}>
        <span class="icon"><Icon entity={{ kind: 'item', id: item.id }} size={32} /></span>
        <span class="name"><EntityLink kind="item" id={item.id} /></span>
        <span class="qty" aria-label={t('bank.quantity')}>&times;{formatInt(n)}</span>
        {#if n > 0}
          <span class="actions">
            {#if tonic}
              <button type="button" class="act" data-drink={item.id} onclick={() => drink(item.id)}>
                {t('bank.drink')}
              </button>
            {:else if item.use}
              <button type="button" class="act use" onclick={() => (picking = item.id)}>
                {t('bank.use')}
              </button>
            {/if}
            {#if coatable}
              <button
                type="button"
                class="act"
                data-coat={item.id}
                onclick={() => (coating = true)}
              >
                {t('bank.coat')}
              </button>
            {/if}
            {#if sellable}
              <a class="act" data-sell-link={item.id} href="#/shop/sell">{t('bank.sell')}</a>
            {/if}
          </span>
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
          <button type="button" class="act pick" onclick={() => use(tech.id)}
            >{t('bank.apply')}</button
          >
        </li>
      {/each}
    </ul>
    {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
    {#snippet actions()}
      <button type="button" onclick={close}>{t('settings.cancel')}</button>
    {/snippet}
  </Modal>
{/if}

{#if coating}
  <Modal title={t('bank.coatTitle')} onClose={close}>
    <p class="help">{t('bank.coatHelp')}</p>
    <ul class="targets" data-coats>
      {#each coats as c (c.poison + c.base)}
        <li class="coat" data-coat-pair={c.product}>
          <p class="line">
            <EntityLink kind="item" id={c.poison} />
            <span class="qty">{c.haveDose}/{c.dose}</span>
            +
            <EntityLink kind="item" id={c.base} />
            <span class="qty">{c.haveBase}/{c.batch}</span>
          </p>
          <p class="line result" data-coat-result>
            {t('bank.coatResult')}
            <span class="qty">&times;{c.batch}</span>
            <EntityLink kind="item" id={c.product} />
            <span class="qty">{t('bank.coatOwned', { n: c.haveProduct })}</span>
          </p>
          <button
            type="button"
            class="act pick"
            disabled={!c.ready}
            aria-describedby={c.ready ? undefined : `why-coat-${c.product}`}
            onclick={() => coat(c.poison, c.base)}
          >
            {t('bank.coatDo')}
          </button>
          {#if !c.ready}
            <p class="why" id="why-coat-{c.product}" data-why="missing">
              {t('error.missingIngredient')}
            </p>
          {/if}
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
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    margin-bottom: var(--space-3);
  }

  .tabs {
    display: flex;
    flex: 1 1 100%;
    gap: var(--space-1);
    overflow-x: auto;
  }

  .tab {
    flex: none;
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: var(--fg-dim);
    font: inherit;
    cursor: pointer;
  }

  .tab.active {
    border-bottom-color: var(--accent);
    color: var(--fg);
  }

  .search {
    display: inline-flex;
    flex: 1 1 12rem;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg-dim);
  }

  .search input {
    flex: 1;
    min-width: 0;
    min-height: 2.75rem;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
  }

  .goal-filter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    cursor: pointer;
  }

  .goal-filter input {
    width: 1.25rem;
    height: 1.25rem;
  }

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
  .target,
  .coat {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .item.none {
    opacity: 0.75;
  }

  .coat {
    flex-direction: column;
    align-items: flex-start;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0;
  }

  .result {
    color: var(--fg-dim);
  }

  .icon {
    display: inline-flex;
    color: var(--steel);
  }

  .name {
    flex: 1 1 8rem;
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

  .actions {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .act {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    text-decoration: none;
    cursor: pointer;
  }

  .act:disabled {
    border-color: var(--line);
    color: var(--fg-dim);
    cursor: not-allowed;
  }

  .why {
    margin: 0;
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  .why::before {
    content: '! ';
    color: var(--danger);
    font-weight: 700;
  }

  .error {
    color: var(--danger);
  }
</style>
