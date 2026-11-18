<script lang="ts">
  import { formatInt, formatSeconds } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { entityAttr, idAttr } from '../lib/reveal.ts';
  import type { FighterView, Outcome } from '../lib/fight-scene.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import SealStrip from './SealStrip.svelte';
  import StatBar from './StatBar.svelte';
  import TimeBar from './TimeBar.svelte';

  interface Props {
    f: FighterView;
    /** What young actions did to this body: flying figures for about a second. */
    outcomes?: readonly Outcome[];
    /** For an enemy: the player's action is aimed at it. On a phone the other bodies shrink to a line or two. */
    targeted?: boolean;
    /** For the player's side: a clone fights, the body is the clone's. */
    clone?: boolean;
  }

  let { f, outcomes = [], targeted = false, clone = false }: Props = $props();

  const player = $derived(f.side === 'player');
  const action = $derived(f.action);
  const label = $derived(
    f.heldBy !== null
      ? 'held'
      : f.phase === 'wait'
        ? 'wait'
        : f.phase === 'rest'
          ? 'rest'
          : action?.kind === 'technique'
            ? 'cast'
            : action?.kind === 'item'
              ? 'item'
              : 'basic',
  );
  const heldStatus = $derived(f.heldBy !== null && f.heldBy !== 'hook' ? f.heldBy : null);
  const heldKey = $derived(heldStatus !== null ? `state.${heldStatus}.held` : '');
  /** A glyph for an action that has no pictogram of its own. */
  const glyph = $derived(
    label === 'wait'
      ? 'lucide:hourglass'
      : label === 'rest'
        ? 'lucide:wind'
        : label === 'held'
          ? 'lucide:zap-off'
          : 'fist',
  );
  const lastKind = $derived(f.last?.kind);

  /** The defensive technique's own words for a dodge («підмінився колодою»), when its text has them. */
  const dodgeKey = (id: string): string => `technique.${id}.dodge`;
</script>

{#snippet applied(statuses: readonly string[], combos: readonly string[])}
  {#if statuses.length > 0}
    <span class="applied"
      >{t('fight.out.applied')}
      {#each statuses as id, i (id)}{#if i > 0},
        {/if}<EntityLink kind="status" {id} />{/each}</span
    >
  {/if}
  {#each combos as id (id)}
    <span class="combo">{t('fight.out.combo')} <EntityLink kind="combo" {id} /></span>
  {/each}
{/snippet}

{#snippet pops()}
  {#each outcomes as o (o.key)}
    <div
      class="pop"
      data-ui="fight-outcome"
      data-kind="pop"
      data-outcome={o.kind}
      aria-hidden="true"
    >
      {#if o.kind === 'damage'}
        <span class="dmg">{t('fight.out.damage', { n: formatInt(o.amount) })}</span>
      {:else if o.kind === 'dodge'}
        <span class="dodge">{t('fight.out.dodged')}</span>
        {#if o.via && hasKey(dodgeKey(o.via))}<span class="via">{t(dodgeKey(o.via))}</span>{/if}
      {:else if o.kind === 'interrupted'}
        <span class="interrupted">{t('fight.out.interrupted')}</span>
      {/if}
    </div>
  {/each}
{/snippet}

<article
  class="fighter"
  class:down={!f.alive}
  data-ui="fighter"
  data-side={f.side}
  data-entity={f.entry === null ? undefined : entityAttr({ kind: 'enemy', id: f.entry })}
  data-alive={f.alive}
  data-targeted={f.side === 'enemy' && f.alive ? targeted : undefined}
>
  <header class="head">
    <span class="face">
      {#if player}
        <Icon name="fist" size={28} />
      {:else if f.entry}
        <Icon entity={{ kind: 'enemy', id: f.entry }} size={28} />
      {/if}
    </span>
    <h3 class="name" data-fighter={player ? (clone ? 'clone' : 'you') : undefined}>
      {#if player}{t(clone ? 'combat.cloneYou' : 'fight.you')}{:else if f.entry}<EntityLink
          kind="enemy"
          id={f.entry}
        />{#if f.of > 1}&nbsp;<span class="nth">#{f.nth}</span>{/if}{/if}
    </h3>
    {#if !f.alive}<span class="down-tag">{t('fight.down')}</span>{/if}
    {@render pops()}
  </header>

  {#if f.alive}
    <div class="bars">
      <StatBar
        label={t('combat.hpBar')}
        value={f.hp}
        max={f.maxHp}
        tone={player ? 'hp' : 'enemy'}
        dense
      />
      {#if f.maxChakra > 0}
        <StatBar
          label={t('combat.chakraBar')}
          value={f.chakra}
          max={f.maxChakra}
          tone="chakra"
          dense
        />
      {/if}
      {#if f.maxStamina > 0}
        <StatBar
          label={t('combat.staminaBar')}
          value={f.stamina}
          max={f.maxStamina}
          tone="stamina"
          dense
        />
      {/if}
    </div>

    {#if f.statuses.length > 0}
      <ul class="statuses" aria-label={t('fight.statuses')}>
        {#each f.statuses as s (s.id)}
          <li class="status" data-status={idAttr('status', s.id)}>
            <EntityLink kind="status" id={s.id} />
            {#if s.stacks > 1}<span class="stacks">×{formatInt(s.stacks)}</span>{/if}
            <span class="left"
              >{s.remainingMs === null
                ? t('fight.statusFight')
                : formatSeconds(s.remainingMs)}</span
            >
          </li>
        {/each}
      </ul>
    {/if}

    <div
      class="action"
      data-ui="fight-action"
      data-phase={f.phase}
      data-action={label}
      data-held={f.heldBy !== null ? true : undefined}
    >
      <div class="row">
        {#if label === 'cast' && action?.id}
          <ActionEmblem kind="technique" id={action.id} size="sm" />
        {:else if label === 'item' && action?.id}
          <ActionEmblem kind="item" id={action.id} size="sm" />
        {:else}
          <ActionEmblem kind="fight" id={label} icon={glyph} size="sm" />
        {/if}
        <p class="what">
          {#if label === 'held'}
            <span class="verb held"
              >{heldStatus !== null && hasKey(heldKey) ? t(heldKey) : t('fight.action.held')}</span
            >{#if heldStatus !== null && !hasKey(heldKey)}
              <EntityLink kind="status" id={heldStatus} />{/if}
          {:else if label === 'cast' && action?.id}
            <span class="verb">{t('fight.action.cast')}</span>
            <EntityLink kind="technique" id={action.id} />
          {:else if label === 'item' && action?.id}
            <span class="verb">{t('fight.action.item')}</span>
            <EntityLink kind="item" id={action.id} />
          {:else}
            <span class="verb">{t(`fight.action.${label}`)}</span>
          {/if}
        </p>
      </div>
      <TimeBar
        timing={f.timing}
        size="md"
        tone={player ? (label === 'cast' ? 'chakra' : 'accent') : 'enemy'}
        label={t('fight.progress')}
      />
      {#if f.cast && f.seals.length > 0}
        <SealStrip seals={f.seals} view={f.cast} compact />
      {/if}
    </div>
  {/if}

  {#if f.last && f.alive}
    <p
      class="last"
      data-ui="fight-outcome"
      data-kind="last"
      data-outcome={f.last.outcome}
      data-last-action={lastKind}
    >
      <span class="verb"
        >{t(
          f.last.kind === 'technique'
            ? 'fight.last.technique'
            : f.last.kind === 'item'
              ? 'fight.last.item'
              : f.last.kind === 'rest'
                ? 'fight.last.rest'
                : player
                  ? 'fight.last.basic'
                  : 'fight.last.attack',
        )}</span
      >
      {#if f.last.kind === 'technique' && f.last.id}<EntityLink
          kind="technique"
          id={f.last.id}
        />{:else if f.last.kind === 'item' && f.last.id}<EntityLink
          kind="item"
          id={f.last.id}
        />{/if}
      {#if f.last.outcome === 'hit' && f.last.damage > 0}
        <span class="sep">—</span>
        <span class="dmg">{t('fight.out.damage', { n: formatInt(f.last.damage) })}</span>
      {:else if f.last.outcome === 'miss'}
        <span class="sep">—</span>
        <span class="dodge"
          >{t(
            player ? 'fight.out.foeDodged' : 'fight.out.youDodged',
          )}{#if f.last.avoidedBy}&nbsp;{#if hasKey(dodgeKey(f.last.avoidedBy))}({t(
                dodgeKey(f.last.avoidedBy),
              )}){:else}({t('fight.out.thanks')}&nbsp;<EntityLink
                kind="technique"
                id={f.last.avoidedBy}
              />){/if}{/if}</span
        >
      {:else if f.last.outcome === 'interrupted'}
        <span class="sep">—</span>
        <span class="interrupted">{t('fight.out.interrupted')}</span>
      {/if}
      {@render applied(f.last.statuses, f.last.combos)}
    </p>
  {/if}
</article>

<style>
  .fighter {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .fighter.down {
    opacity: 0.6;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .face {
    display: inline-flex;
    color: var(--steel);
  }

  .name {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  .name :global(a) {
    color: inherit;
  }

  .nth,
  .down-tag {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .statuses {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-size: var(--text-xs);
  }

  .status :global(a) {
    min-height: 0;
  }

  .left {
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
  }

  .action {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .what {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .verb {
    color: var(--fg-dim);
  }

  .verb.held {
    color: var(--danger);
    font-weight: 600;
  }

  .what :global(a),
  .last :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  .last {
    margin: 0;
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .dmg {
    color: var(--danger);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .dodge,
  .via {
    color: var(--chakra);
    font-weight: 600;
  }

  .interrupted {
    color: var(--accent);
    font-weight: 600;
  }

  .sep {
    color: var(--fg-dim);
  }

  .applied,
  .combo {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  /* The figure that flies off the body an action landed on; with reduced motion only the last-action line stays. */
  .pop {
    position: absolute;
    top: var(--space-1);
    right: var(--space-2);
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    white-space: nowrap;
    pointer-events: none;
    animation: fly 1s ease-out forwards;
  }

  .pop .via {
    font-family: var(--font-text);
    font-size: var(--text-xs);
  }

  @keyframes fly {
    from {
      transform: translateY(0);
      opacity: 1;
    }

    70% {
      opacity: 1;
    }

    to {
      transform: translateY(calc(-1 * var(--space-5)));
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pop {
      display: none;
    }
  }

  .bars {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /*
   * Phone: the arena has to be readable without scrolling, so a body is a few lines, not a card.
   * The pop is a flex item of the head (never over the name); the three bars are one line each; the
   * action is a medallion with its words and its bar beside it. A body that is not the target keeps
   * its name, health and action line, and drops the rest (secondary bars, the last-action text).
   */
  @media (max-width: 768px) {
    .fighter {
      gap: var(--space-1);
      padding: var(--space-2);
    }

    /* A long name keeps its words whole: the pop drops below it instead of squeezing it into pieces. */
    .head {
      flex-wrap: wrap;
    }

    .name {
      flex: 1 1 var(--panel-min);
      min-width: min(var(--panel-min), 100%);
      font-size: var(--text-sm);
      overflow-wrap: break-word;
    }

    .pop {
      position: static;
      flex: 0 1 auto;
      flex-direction: column;
      align-items: flex-end;
      gap: 0;
      max-width: 60%;
      margin-left: auto;
      padding: 0 var(--space-2);
      animation: fade 1s ease-out forwards;
      font-size: var(--text-md);
      line-height: 1.2;
      text-align: right;
      white-space: normal;
    }

    .bars {
      gap: var(--space-1);
    }

    .action {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      column-gap: var(--space-2);
      row-gap: var(--space-1);
      padding: var(--space-1) var(--space-2);
    }

    .action .row {
      display: contents;
    }

    .action > :global(.time-bar) {
      grid-column: 2;
    }

    .action > :global(:not(.time-bar)) {
      grid-column: 1 / -1;
    }

    .action .row > :global(.emblem) {
      grid-row: 1 / span 2;
    }

    .last {
      font-size: var(--text-xs);
    }

    /* The links of the arena are read, not aimed at while a fight runs: no tap-target height, like the Now bar. */
    .name :global(a),
    .what :global(a),
    .last :global(a) {
      display: inline;
      min-height: 0;
    }

    .fighter[data-targeted='false'] .bars > :global(:not(:first-child)),
    .fighter[data-targeted='false'] .last {
      display: none;
    }

    .fighter[data-targeted='true'] {
      border-color: var(--accent);
    }
  }

  @keyframes fade {
    from {
      opacity: 1;
    }

    70% {
      opacity: 1;
    }

    to {
      opacity: 0;
    }
  }
</style>
