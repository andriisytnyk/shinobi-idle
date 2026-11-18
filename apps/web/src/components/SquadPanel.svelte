<script lang="ts">
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import {
    ACTION_VERB,
    canCreateClone,
    newCloneShare,
    performersOf,
    squadCounts,
    stopCommand,
    timingOf,
    type Performer,
  } from '../lib/squad.ts';
  import { squadUi } from '../lib/squad-ui.svelte.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import TimeBar from './TimeBar.svelte';

  interface Props {
    /** A phone: a strip of chips, and a sheet with the rows behind a tap. */
    compact?: boolean;
    /** The performers to show; the game's own by default (tests and packs may pass others). */
    performers?: readonly Performer[];
  }

  let { compact = false, performers }: Props = $props();

  const content = game.content;
  const own = $derived(game.read((gs) => performersOf(gs, content, game.rules)));
  const list = $derived(performers ?? own);
  const counts = $derived(game.read((gs) => squadCounts(list, gs, content)));
  const timings = $derived(
    game.read((gs) =>
      Object.fromEntries(list.map((p) => [p.slot, timingOf(gs, p.slot, content, game.rules)])),
    ),
  );
  const canCreate = $derived(game.read((gs) => canCreateClone(gs, content)));

  const nameOf = (p: Performer): string =>
    p.clone ? t('squad.clone', { n: p.n }) : t('squad.you');
  const shortOf = (p: Performer): string =>
    p.clone ? t('squad.mark.clone', { n: p.n }) : t('squad.you');

  /** Every line of the row that says something about the performer, for the screen reader. */
  const summary = (p: Performer): string => `${nameOf(p)}: ${t(`squad.state.${p.state}`)}`;

  function stop(p: Performer): void {
    if (p.clone) return squadUi.askDispel(p.id);
    const result = game.dispatch(stopCommand(p));
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }

  /** Dispels never run from here: the dialog shows what the clone holds and asks first. */
  function giveTask(p: Performer): void {
    squadUi.pick(p.id);
    squadUi.setSheet(false);
    toasts.push({ key: 'squad.giveHint', params: { who: nameOf(p) } });
  }

  function create(): void {
    squadUi.askClone();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && squadUi.sheet) {
      event.stopPropagation();
      squadUi.setSheet(false);
    }
  }
</script>

{#snippet row(p: Performer)}
  <li
    class="row"
    class:picked={squadUi.picked === p.n}
    class:idle={p.clone && p.state === 'idle'}
    data-ui="squad-row"
    data-performer={p.n}
    data-slot-index={p.slot}
    data-state={p.state}
  >
    <button
      type="button"
      class="who"
      aria-pressed={squadUi.picked === p.n}
      aria-label={t('squad.pick', { who: summary(p) })}
      onclick={() => squadUi.pick(squadUi.picked === p.n ? null : p.id)}
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="name">{nameOf(p)}</span>
      <span class="state">{t(`squad.state.${p.state}`)}</span>
    </button>

    {#if p.ref && p.action}
      <p class="doing" data-squad-doing>
        {#if ACTION_VERB[p.action.kind]}<span class="verb"
            >{t(ACTION_VERB[p.action.kind] ?? '')}</span
          >{/if}
        <EntityLink kind={p.ref.kind} id={p.ref.id} />
      </p>
      <TimeBar
        timing={timings[p.slot] ?? { fraction: 0, cycleMs: 0, running: false }}
        part="action-progress"
      />
    {/if}

    <dl class="facts">
      {#if p.clone && p.lifeMs !== undefined}
        <div data-squad-life>
          <dt>{t('squad.life')}</dt>
          <dd>{t('squad.lifeValue', { time: formatDuration(p.lifeMs) })}</dd>
        </div>
        {#if p.lifeFraction !== undefined}
          <progress class="life" max="1" value={p.lifeFraction} aria-label={t('squad.life')}
          ></progress>
        {/if}
      {/if}
      {#if p.clone && p.held?.xp !== undefined}
        <div data-squad-held>
          <dt>{t('squad.held')}</dt>
          <dd>{t('squad.heldValue', { n: formatInt(p.held.xp) })}</dd>
        </div>
      {/if}
      {#if !p.clone}
        <div data-squad-chakra>
          <dt>{t('squad.chakra')}</dt>
          <dd>{t('squad.chakraValue', { pct: Math.round(p.chakraShare * 100) })}</dd>
        </div>
        {#if p.fatigueMs !== undefined && p.fatigueMs > 0}
          <div data-squad-fatigue>
            <dt>{t('squad.fatigue')}</dt>
            <dd>{formatDuration(p.fatigueMs)}</dd>
          </div>
        {/if}
      {/if}
    </dl>

    <div class="buttons">
      {#if p.state === 'idle' && p.clone}
        <button type="button" class="give" data-give onclick={() => giveTask(p)}>
          {t('squad.giveTask')}
        </button>
      {/if}
      {#if p.action}
        <button
          type="button"
          class="stop"
          data-squad-stop
          aria-label={t(p.clone ? 'now.dispel' : 'now.stop') + ': ' + nameOf(p)}
          onclick={() => stop(p)}
        >
          <Icon name={p.clone ? 'lucide:x' : 'lucide:square'} size={14} />
          {t(p.clone ? 'now.dispel' : 'now.stop')}
        </button>
      {:else if p.clone}
        <button type="button" class="stop" data-squad-stop onclick={() => squadUi.askDispel(p.id)}>
          <Icon name="lucide:x" size={14} />
          {t('now.dispel')}
        </button>
      {/if}
    </div>
    <Slot name="squad.row" ctx={{ performer: p.id, slot: p.slot }} />
  </li>
{/snippet}

{#snippet header()}
  <header class="head">
    <h2>{t('squad.title')}</h2>
    <p class="counts" data-squad-counts>
      {t('squad.counts', { n: counts.clones, max: counts.max, free: counts.free })}
    </p>
  </header>
{/snippet}

{#snippet footer()}
  <button type="button" class="create" data-squad-create disabled={!canCreate} onclick={create}>
    <Icon name="lucide:plus" size={16} />
    {t('squad.create', { share: newCloneShare(list) })}
  </button>
{/snippet}

{#if compact}
  <section class="strip" data-ui="squad" data-compact aria-label={t('squad.title')}>
    <ul class="chips">
      {#each list as p (p.id)}
        <li>
          <button
            type="button"
            class="chip"
            class:idle={p.clone && p.state === 'idle'}
            class:picked={squadUi.picked === p.n}
            data-ui="squad-chip"
            data-performer={p.n}
            data-state={p.state}
            aria-label={summary(p)}
            aria-haspopup="dialog"
            aria-expanded={squadUi.sheet}
            onclick={() => squadUi.setSheet(true)}
          >
            <span class="dot" aria-hidden="true"></span>
            <span class="chip-name">{shortOf(p)}</span>
            <TimeBar timing={timings[p.slot] ?? { fraction: 0, cycleMs: 0, running: false }} />
          </button>
        </li>
      {/each}
    </ul>
  </section>
  {#if squadUi.sheet}
    <div class="backdrop" role="presentation" onclick={() => squadUi.setSheet(false)}></div>
    <div
      class="sheet"
      data-ui="squad-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={t('squad.title')}
      tabindex="-1"
      onkeydown={onKeydown}
    >
      <div class="sheet-head">
        {@render header()}
        <button
          type="button"
          class="close"
          aria-label={t('squad.close')}
          onclick={() => squadUi.setSheet(false)}
        >
          <Icon name="lucide:x" size={18} />
        </button>
      </div>
      <ul class="rows">
        {#each list as p (p.id)}{@render row(p)}{/each}
      </ul>
      {@render footer()}
    </div>
  {/if}
{:else}
  <aside class="panel" data-ui="squad" aria-label={t('squad.title')}>
    {@render header()}
    <ul class="rows">
      {#each list as p (p.id)}{@render row(p)}{/each}
    </ul>
    {@render footer()}
  </aside>
{/if}

<style>
  .panel,
  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    padding: var(--space-3);
    background: var(--surface);
    overflow-y: auto;
  }

  .panel {
    border-left: var(--border-thin) solid var(--line);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  h2 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .counts {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    --_state: var(--fg-dim);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-left: var(--border-heavy) solid var(--_state);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    font-size: var(--text-xs);
  }

  .row[data-state='working'],
  .chip[data-state='working'] {
    --_state: var(--accent);
  }

  .row[data-state='fighting'],
  .chip[data-state='fighting'] {
    --_state: var(--danger);
  }

  .row[data-state='standing'],
  .chip[data-state='standing'] {
    --_state: var(--chakra);
  }

  .row[data-state='idle'],
  .chip[data-state='idle'] {
    --_state: var(--success);
  }

  /* A clone that waits for a task is lit: it is what the player should give work to. */
  .row.idle {
    background: var(--surface);
    box-shadow: 0 0 0 var(--border-thin) var(--_state);
  }

  .row.picked,
  .chip.picked {
    outline: var(--border-thick) solid var(--accent);
    outline-offset: calc(-1 * var(--border-thick));
  }

  .who {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-xs);
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
  }

  .dot {
    flex: none;
    width: var(--icon-xs);
    height: var(--icon-xs);
    border-radius: var(--radius-pill);
    background: var(--_state);
  }

  .name {
    font-weight: 600;
  }

  .state {
    margin-inline-start: auto;
    color: var(--_state);
    font-size: var(--text-xs);
  }

  .doing {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .verb {
    color: var(--fg-dim);
  }

  .doing :global(a) {
    display: inline;
    min-height: 0;
    font-weight: 600;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
  }

  .facts div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  dt {
    color: var(--fg-dim);
  }

  dd {
    margin: 0;
    font-weight: 600;
  }

  .life {
    width: 100%;
    height: var(--bar-thin);
    accent-color: var(--chakra);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .give,
  .stop,
  .create,
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-height: var(--control-sm);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .give {
    flex: 1;
    border-color: var(--success);
    color: var(--success);
    font-weight: 600;
  }

  .create {
    border-style: dashed;
    color: var(--accent);
  }

  .create:disabled {
    color: var(--fg-dim);
    cursor: not-allowed;
  }

  /* The phone: a strip of chips above the bottom bar. */
  .strip {
    padding: var(--space-1) var(--space-3);
    border-top: var(--border-thin) solid var(--line);
    background: var(--surface);
  }

  .chips {
    display: flex;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    overflow-x: auto;
    list-style: none;
  }

  .chip {
    --_state: var(--fg-dim);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-1) var(--space-2);
    min-width: var(--panel-min);
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--_state);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .chip :global(.time-bar) {
    grid-column: 1 / -1;
  }

  .chip.idle {
    background: var(--surface);
    font-weight: 600;
  }

  .chip-name {
    font-weight: 600;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    background: var(--scrim);
  }

  .sheet {
    position: fixed;
    inset: auto 0 var(--tabbar-height) 0;
    z-index: var(--z-popover);
    max-height: 70dvh;
    border-top: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }

  .sheet-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .close {
    min-width: var(--control-md);
    min-height: var(--control-md);
  }

  @media (prefers-reduced-motion: no-preference) {
    .row,
    .chip {
      transition: box-shadow 0.15s;
    }
  }
</style>
