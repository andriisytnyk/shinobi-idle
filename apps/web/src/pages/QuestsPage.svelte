<script lang="ts">
  import { content } from '@shinobi/content';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import QuestObjective from '../components/QuestObjective.svelte';
  import { entityDesc } from '../lib/entities.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { stepStatus } from '../lib/next-step.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  /** Chains that have started: those under way first, finished ones after. */
  const started = $derived(game.read((gs) => content.quests.filter((q) => gs.quests[q.id])));
  const active = $derived(game.read((gs) => started.filter((q) => !gs.quests[q.id]?.done)));
  const finished = $derived(game.read((gs) => started.filter((q) => gs.quests[q.id]?.done)));
</script>

{#snippet chain(quest: (typeof content.quests)[number], done: boolean)}
  {@const progress = game.state.quests[quest.id]}
  {@const finalKey = `quest.${quest.id}.final`}
  <div class="chain" data-quest={quest.id} data-done={done}>
    {#if !done}
      <p class="summary-line">
        <span class="name"><EntityLink kind="quest" id={quest.id} /></span>
        <span class="count"
          >{t('quests.steps', { done: progress?.step ?? 0, total: quest.steps.length })}</span
        >
      </p>
    {/if}
    {#if entityDesc({ kind: 'quest', id: quest.id })}
      <p class="desc">{entityDesc({ kind: 'quest', id: quest.id })}</p>
    {/if}
    <ol class="steps">
      {#each quest.steps as step, i (i)}
        {@const status = stepStatus(game.state, quest, i)}
        <li
          class="step"
          data-status={status}
          aria-current={status === 'current' ? 'step' : undefined}
        >
          <div class="step-head">
            <span class="mark">
              <Icon
                name={status === 'done'
                  ? 'lucide:check'
                  : status === 'current'
                    ? 'lucide:chevron-right'
                    : 'lucide:minus'}
                size={16}
              />
            </span>
            <span class="status"
              >{t(
                `quests.step${status === 'done' ? 'Done' : status === 'current' ? 'Current' : 'Pending'}`,
              )}</span
            >
          </div>
          <p class="text">{t(step.textKey)}</p>
          <div class="objective"><QuestObjective {quest} index={i} /></div>
        </li>
      {/each}
    </ol>
    {#if done && hasKey(finalKey)}
      <p class="final"><strong>{t('quests.final')}.</strong> {t(finalKey)}</p>
    {/if}
  </div>
{/snippet}

<SimplePage title={t('quests.title')}>
  <Hint id="quests" />

  {#if started.length === 0}
    <p class="empty">{t('quests.empty')}</p>
  {/if}

  {#if active.length > 0}
    <section>
      <h2>{t('quests.active')}</h2>
      {#each active as quest (quest.id)}
        {@render chain(quest, false)}
      {/each}
    </section>
  {/if}

  {#if finished.length > 0}
    <section>
      <h2>{t('quests.finished')}</h2>
      {#each finished as quest (quest.id)}
        <details class="folded">
          <summary>
            <span class="name"><EntityLink kind="quest" id={quest.id} /></span>
            <span class="count">{t('quests.stepDone')}</span>
          </summary>
          {@render chain(quest, true)}
        </details>
      {/each}
    </section>
  {/if}
</SimplePage>

<style>
  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--font-size-1-1);
    font-weight: 400;
  }

  .empty {
    color: var(--fg-dim);
  }

  .chain {
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .summary-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    margin: 0;
  }

  .name {
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--font-size-1-1);
  }

  .name :global(a) {
    color: inherit;
  }

  @media (max-width: 768px) {
    .name :global(a) {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-size);
    }
  }

  .count {
    color: var(--fg-dim);
    font-size: var(--font-size-0-85);
  }

  .desc {
    margin: var(--space-2) 0;
    color: var(--fg-dim);
  }

  .steps {
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
  }

  .step {
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-left-width: var(--border-4);
    border-radius: var(--radius-sm);
    color: var(--fg-dim);
  }

  .step[data-status='current'] {
    border-color: var(--accent);
    background: var(--surface-raised);
    color: var(--fg);
  }

  .step[data-status='done'] {
    border-left-color: var(--success);
  }

  .step-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-0-8);
  }

  .step[data-status='current'] .mark {
    color: var(--accent);
  }

  .step[data-status='done'] .mark {
    color: var(--success);
  }

  .text {
    margin: var(--space-1) 0 var(--space-2);
  }

  .final {
    margin: var(--space-3) 0 0;
    color: var(--fg);
  }

  .folded {
    margin-bottom: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .folded > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--control-size);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }

  .folded .chain {
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
  }
</style>
