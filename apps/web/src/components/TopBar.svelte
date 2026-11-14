<script lang="ts">
  import { state } from '../lib/game.ts';
  import { t } from '../lib/i18n.ts';
  import Icon from './Icon.svelte';

  interface Props {
    metaOpen: boolean;
    onToggleMeta: () => void;
  }

  let { metaOpen, onToggleMeta }: Props = $props();

  const numbers = new Intl.NumberFormat('uk');
</script>

<header class="topbar">
  <a class="brand" href="#/">{t('app.title')}</a>

  <dl class="stats">
    <div class="stat">
      <dt><Icon name="coin" size={16} /><span class="label">{t('topbar.ryo')}</span></dt>
      <dd>{numbers.format(state.currencies.ryo)}</dd>
    </div>
    <div class="stat">
      <dt><Icon name="star" size={16} /><span class="label">{t('topbar.rep')}</span></dt>
      <dd>{numbers.format(state.currencies.rep)}</dd>
    </div>
    <div class="stat intel">
      <dt><Icon name="eye" size={16} /><span class="label">{t('topbar.intel')}</span></dt>
      <dd>{numbers.format(state.currencies.intel)}</dd>
    </div>
    <div class="stat rank">
      <dt><Icon name="shield" size={16} /><span class="label">{t('topbar.rank')}</span></dt>
      <dd>{t(`rank.${state.player.rank}`)}</dd>
    </div>
  </dl>

  <div class="tools">
    <label class="lang">
      <span class="label">{t('lang.switch')}</span>
      <select disabled aria-label={t('lang.switch')}>
        <option>{t('lang.uk')}</option>
      </select>
    </label>
    <button
      type="button"
      class="meta-toggle"
      aria-expanded={metaOpen}
      aria-controls="meta-panel"
      onclick={onToggleMeta}
    >
      <Icon name="scroll" size={18} />
      <span>{t('nav.meta')}</span>
    </button>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--topbar-height);
    padding: 0 var(--space-4);
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }

  .brand {
    color: var(--accent);
    font-family: var(--font-heading);
    font-size: 1.1rem;
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

  .stat.intel dt {
    color: var(--chakra);
  }

  .stat.rank dd {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--steel);
    color: var(--ink-900);
    font-weight: 600;
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
    border: 1px solid var(--line);
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

  .meta-toggle[aria-expanded='true'] {
    border-color: var(--accent);
  }

  @media (max-width: 768px) {
    .topbar {
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
      padding: var(--space-2) var(--space-3);
    }

    .stats {
      order: 3;
      flex-basis: 100%;
      gap: var(--space-3);
      font-size: 0.85rem;
    }

    .tools {
      margin-left: auto;
    }

    .lang {
      display: none;
    }

    /* Icons stay, labels remain available to screen readers. */
    .label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
</style>
