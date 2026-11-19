<script lang="ts">
  import { game } from '../lib/store.ts';
  import { currencyName, held, natureIconRef, natureName, rankName } from '../lib/vocab.ts';
  import { t } from '../lib/i18n.ts';
  import { natureStatus } from '@shinobi/core';
  import { tryUi } from '../lib/ext/runtime.svelte.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { markerOf } from '../lib/nav.ts';
  import { nextStep } from '../lib/next-step.ts';
  import Icon from './Icon.svelte';

  const content = game.content;

  interface Props {
    metaOpen: boolean;
    onToggleMeta: () => void;
  }

  let { metaOpen, onToggleMeta }: Props = $props();

  const ui = tryUi();
  /** At phone width the bar is one row and the rest of it sits behind this button. */
  let menuOpen = $state(false);
  const numbers = new Intl.NumberFormat('uk');
  const nature = $derived(game.read((gs) => natureStatus(gs, content)));
  const natures = $derived(game.read((gs) => gs.player.natures));
  /** A nature is waiting to be chosen: the test, or an extra one. */
  const natureDue = $derived(nature.canChoose);
  const rankMarked = $derived(
    game.read(
      (gs) => markerOf(nextStep(gs, content)?.target ?? null, ui?.registry ?? null).nav === 'rank',
    ),
  );
</script>

<svelte:window onhashchange={() => (menuOpen = false)} />

<header class="topbar" class:open={menuOpen}>
  <a class="brand" href="#/">{t('app.title')}</a>

  <dl class="stats">
    {#each content.currencies as currency, i (currency.id)}
      <div
        class="stat"
        class:primary={i === 0}
        data-ui="topbar-currency"
        data-entity="currency:{currency.id}"
      >
        <dt>
          <Icon entity={{ kind: 'currency', id: currency.id }} size={16} /><span class="label"
            >{currencyName(currency.id)}</span
          >
        </dt>
        <dd>{numbers.format(held(game.state, currency.id))}</dd>
      </div>
    {/each}
    <div class="stat rank primary">
      <dt><Icon name="rank-3" size={16} /><span class="label">{t('topbar.rank')}</span></dt>
      <dd>
        <a class="rank-link" href="#/rank" data-rank-plate
          >{rankName(game.state.player.rank)}{#if rankMarked}<span
              class="marker"
              data-marker
              role="img"
              aria-label={t('nav.next')}
            ></span>{/if}</a
        >
      </dd>
    </div>
    {#if nature.stage !== 'locked'}
      <div class="stat nature">
        <dt>
          {#if natures[0]}<Icon entity={natureIconRef(content, natures[0])} size={16} />{:else}<Icon
              name="lucide:info"
              size={16}
            />{/if}<span class="label">{t('topbar.nature')}</span>
        </dt>
        <dd>
          <a class="nature-link" href="#/nature" data-nature-link
            >{#if natures.length === 0}{t('topbar.natureTest')}{:else}{natures
                .map((n) => natureName(n))
                .join(', ')}{/if}{#if natureDue}<span
                class="marker"
                data-marker
                role="img"
                aria-label={t('nav.next')}
              ></span>{/if}</a
          >
        </dd>
      </div>
    {/if}
    <div class="stat save" data-save={game.saveStatus}>
      <dt class="label">{t('topbar.save')}</dt>
      <dd>{t(`topbar.save.${game.saveStatus}`)}</dd>
    </div>
  </dl>

  <span class="fold" aria-hidden="true"></span>

  <div class="tools" id="topbar-menu">
    <label class="lang">
      <span class="label">{t('lang.switch')}</span>
      <select disabled aria-label={t('lang.switch')}>
        <option>{t('lang.uk')}</option>
      </select>
    </label>
    <a class="meta-toggle shop-link" href="#/bank" data-bank-link>
      <Icon name="lucide:package" size={18} />
      <span>{t('nav.bank')}</span>
    </a>
    <a class="meta-toggle shop-link" href="#/village" data-village-link>
      <Icon name="lucide:landmark" size={18} />
      <span>{t('nav.village')}</span>
    </a>
    <a class="meta-toggle shop-link" href="#/shop" data-shop-link>
      <Icon name="lucide:store" size={18} />
      <span>{t('nav.shop')}</span>
    </a>
    <a class="meta-toggle more-link" href="#/more">
      <Icon name="lucide:settings" size={18} />
      <span class="more-label">{t('nav.more')}</span>
    </a>
    <button
      type="button"
      class="meta-toggle"
      aria-expanded={metaOpen}
      aria-controls="meta-panel"
      onclick={onToggleMeta}
    >
      <Icon name="lucide:panel-right" size={18} />
      <span>{t('nav.meta')}</span>
    </button>
  </div>
  <button
    type="button"
    class="menu-btn"
    aria-expanded={menuOpen}
    aria-controls="topbar-menu"
    aria-label={t('topbar.menu')}
    onclick={() => (menuOpen = !menuOpen)}
  >
    <Icon name={menuOpen ? 'lucide:x' : 'lucide:menu'} size={18} />
  </button>
  <Slot name="topbar" />
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--topbar-height);
    padding: 0 var(--space-4);
    border-bottom: var(--border-thin) solid var(--line);
    background: var(--surface);
  }

  .brand {
    color: var(--accent);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    text-decoration: none;
    white-space: nowrap;
  }

  .stats {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: 0;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  dt {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--fg-dim);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .stat.rank dd {
    border-radius: var(--radius-sm);
    background: var(--steel);
    color: var(--ink-900);
    font-weight: 600;
  }

  .rank-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    color: inherit;
    text-decoration: none;
  }

  .nature-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--accent);
    text-decoration: none;
  }

  .marker {
    width: var(--icon-xs);
    height: var(--icon-xs);
    border: var(--border-thick) solid var(--ink-900);
    border-radius: 50%;
    background: var(--accent);
  }

  .stat.save {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .stat.save[data-save='error'] dd {
    color: var(--danger);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .lang {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-dim);
  }

  select,
  .meta-toggle {
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
  }

  .meta-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }

  .more-link,
  .shop-link {
    text-decoration: none;
  }

  .meta-toggle[aria-expanded='true'] {
    border-color: var(--accent);
  }

  .menu-btn,
  .fold {
    display: none;
  }

  /*
   * Phone: one row, brand, the first currency and the rank, then the menu button. The rest of the
   * stats and the tools unfold under it when the button is pressed. `.stats` dissolves into the bar
   * so its items can be ordered next to the others.
   */
  @media (max-width: 768px) {
    .topbar {
      position: relative;
      flex-wrap: wrap;
      gap: 0 var(--space-3);
      padding: var(--space-1) var(--space-3);
    }

    .stats {
      display: contents;
      font-size: var(--text-sm);
    }

    .brand {
      order: 0;
    }

    .stat.primary {
      order: 1;
    }

    .stat:not(.primary) {
      display: none;
      order: 5;
      min-height: var(--control-md);
    }

    .menu-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      order: 2;
      min-width: var(--control-md);
      min-height: var(--control-md);
      margin-left: auto;
      padding: var(--space-1) var(--space-2);
      border: var(--border-thin) solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--surface-raised);
      color: var(--fg);
      cursor: pointer;
    }

    .menu-btn[aria-expanded='true'] {
      border-color: var(--accent);
    }

    .tools {
      display: none;
      order: 6;
      flex-basis: 100%;
      flex-wrap: wrap;
      margin-left: 0;
      padding-bottom: var(--space-2);
    }

    .fold {
      order: 4;
      flex-basis: 100%;
      height: 0;
    }

    .open .stat:not(.primary) {
      display: flex;
    }

    .open .tools {
      display: flex;
    }

    .open .fold {
      display: block;
    }

    /* Whole-tap targets of at least 44 px on a phone. */
    .meta-toggle,
    .brand,
    .rank-link,
    .nature-link {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-md);
    }

    .lang,
    .more-link {
      display: none;
    }

    /* The labels of the stats are for the unfolded menu; in the bar the icons say enough. */
    .label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .open .stat:not(.primary) .label {
      position: static;
      width: auto;
      height: auto;
      overflow: visible;
      clip-path: none;
    }
  }
</style>
