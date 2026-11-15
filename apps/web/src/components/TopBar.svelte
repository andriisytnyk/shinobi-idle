<script lang="ts">
  import { game } from '../lib/store.ts';
  import { content } from '@shinobi/content';
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { natureStatus } from '@shinobi/core';
  import { markerOf } from '../lib/nav.ts';
  import { nextStep } from '../lib/next-step.ts';
  import Icon from './Icon.svelte';

  interface Props {
    metaOpen: boolean;
    onToggleMeta: () => void;
  }

  let { metaOpen, onToggleMeta }: Props = $props();

  const numbers = new Intl.NumberFormat('uk');
  const nature = $derived(game.read((gs) => natureStatus(gs, content)));
  const natures = $derived(game.read((gs) => gs.player.natures));
  /** A nature is waiting to be chosen: the test, or an extra one. */
  const natureDue = $derived(nature.canChoose);
  const rankMarked = $derived(
    game.read((gs) => markerOf(nextStep(gs, content)?.target ?? null).nav === 'rank'),
  );
</script>

<header class="topbar">
  <a class="brand" href="#/">{t('app.title')}</a>

  <dl class="stats">
    <div class="stat">
      <dt>
        <Icon entity={{ kind: 'currency', id: 'ryo' }} size={16} /><span class="label"
          >{t('topbar.ryo')}</span
        >
      </dt>
      <dd>{numbers.format(game.state.currencies.ryo)}</dd>
    </div>
    <div class="stat">
      <dt>
        <Icon entity={{ kind: 'currency', id: 'rep' }} size={16} /><span class="label"
          >{t('topbar.rep')}</span
        >
      </dt>
      <dd>{numbers.format(game.state.currencies.rep)}</dd>
    </div>
    <div class="stat intel">
      <dt>
        <Icon entity={{ kind: 'currency', id: 'intel' }} size={16} /><span class="label"
          >{t('topbar.intel')}</span
        >
      </dt>
      <dd>{numbers.format(game.state.currencies.intel)}</dd>
    </div>
    <div class="stat rank">
      <dt><Icon name="rank-3" size={16} /><span class="label">{t('topbar.rank')}</span></dt>
      <dd>
        <a class="rank-link" href="#/rank" data-rank-plate
          >{t(`rank.${game.state.player.rank}`)}{#if rankMarked}<span
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
          {#if natures[0]}<Icon entity={{ kind: 'skill', id: natures[0] }} size={16} />{:else}<Icon
              name="lucide:info"
              size={16}
            />{/if}<span class="label">{t('topbar.nature')}</span>
        </dt>
        <dd>
          <a class="nature-link" href="#/nature" data-nature-link
            >{#if natures.length === 0}{t('topbar.natureTest')}{:else}{natures
                .map((n) => entityName({ kind: 'skill', id: n }))
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

  <div class="tools">
    <label class="lang">
      <span class="label">{t('lang.switch')}</span>
      <select disabled aria-label={t('lang.switch')}>
        <option>{t('lang.uk')}</option>
      </select>
    </label>
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
    width: 0.6rem;
    height: 0.6rem;
    border: 2px solid var(--ink-900);
    border-radius: 50%;
    background: var(--accent);
  }

  .stat.save {
    color: var(--fg-dim);
    font-size: 0.85rem;
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

  .more-link {
    text-decoration: none;
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

    /* Whole-tap targets of at least 44 px on a phone. */
    .meta-toggle,
    .brand {
      display: inline-flex;
      align-items: center;
      min-height: 2.75rem;
    }

    .rank-link,
    .nature-link {
      min-height: 2.75rem;
    }

    .lang,
    .more-link {
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
