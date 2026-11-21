<script lang="ts">
  import { evalReq } from '@shinobi/core';
  import { webRef } from '../lib/entities.ts';
  import { goalTree } from '../lib/goal.ts';
  import { t } from '../lib/i18n.ts';
  import { stepOf } from '../lib/next-step.ts';
  import { entityAttr, revealHintKey, revealLevel } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import GoalMissions from './GoalMissions.svelte';
  import QuestStepCard from './QuestStepCard.svelte';
  import ReqTree from './ReqTree.svelte';

  const content = game.content;

  interface Props {
    /** One pinned goal: a core entity kind and id. */
    goal: { kind: string; id: string };
  }

  let { goal }: Props = $props();

  const goalRef = $derived(webRef(goal));
  /** A pinned goal that is hidden shows as a bare row with its hint. What opens something is no spoiler, so a goal shown by name keeps its tree. */
  const full = $derived(goalRef === null || revealLevel(goalRef) !== 'hidden');
  const hint = $derived(goalRef && !full ? revealHintKey(goalRef) : null);
  const result = $derived(
    game.read((gs) => {
      const req = goalTree(gs, goal, content, game.rules);
      return req ? evalReq(gs, req, content) : null;
    }),
  );
  /** The active step of a pinned quest chain; null once the chain is done. */
  const step = $derived(
    game.read((gs) => {
      const quest =
        goal.kind === 'quest' ? content.quests.find((q) => q.id === goal.id) : undefined;
      return quest ? stepOf(gs, quest, content) : null;
    }),
  );
  const questDone = $derived(
    game.read((gs) => goal.kind === 'quest' && gs.quests[goal.id]?.done === true),
  );
  const done = $derived(goal.kind === 'quest' ? questDone : result?.met === true);
</script>

<div class="goal" data-goal data-goal-kind={goal.kind}>
  <div class="tree">
    {#if !full && goalRef}
      <p class="target" data-ui="goal-row" data-goal-unrevealed>
        <EntityLink kind={goalRef.kind} id={goalRef.id} />
        {#if hint}<span class="hint">{t(hint)}</span>{/if}
      </p>
    {:else if goal.kind === 'quest'}
      {#if step}
        <QuestStepCard {step} />
      {:else}
        <p
          class="target"
          data-ui="goal-row"
          data-entity={entityAttr({ kind: 'quest', id: goal.id })}
        >
          <EntityLink kind="quest" id={goal.id} />
        </p>
      {/if}
    {:else}
      {#if goal.kind === 'mission'}
        <p
          class="target"
          data-goal-mission
          data-entity={entityAttr({ kind: 'mission', id: goal.id })}
        >
          <EntityLink kind="mission" id={goal.id} />
        </p>
      {/if}
      {#if result}
        <ReqTree node={result} part="goal-row" />
      {:else if goalRef}
        <p class="target" data-ui="goal-row" data-entity={entityAttr(goalRef)}>
          <EntityLink kind={goalRef.kind} id={goalRef.id} />
        </p>
      {/if}
    {/if}
  </div>
  {#if full && goal.kind === 'item'}<GoalMissions item={goal.id} />{/if}
  {#if full && done}<p class="done">{t('meta.done')}</p>{/if}
  <button
    type="button"
    class="unpin"
    data-unpin
    onclick={() => game.dispatch({ type: 'goal.unpin', ref: goal as never })}
  >
    {t('meta.unpin')}
  </button>
</div>

<style>
  .goal {
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
  }

  .done {
    margin: var(--space-2) 0;
    color: var(--success);
    font-weight: 600;
  }

  .hint {
    margin-left: var(--space-2);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .target {
    margin: 0;
  }

  .target :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  .unpin {
    min-height: var(--control-md);
    margin-top: var(--space-3);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
</style>
