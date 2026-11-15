<script lang="ts">
  import { content } from '@shinobi/content';
  import { evalReq, examFor } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import { entityDesc } from '../lib/entities.ts';
  import { formatDuration } from '../lib/format.ts';
  import { senseiTestInfo } from '../lib/exam-test.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  const exam = $derived(examFor(content, 'genin'));
  const rank = $derived(game.read((gs) => gs.player.rank));
  const passed = $derived(rank !== 'student');
  const checklist = $derived(
    game.read((gs) => (exam ? evalReq(gs, exam.checklist, content) : null)),
  );

  /** The sensei test, while it runs, as a progress action. */
  const test = $derived(game.read((gs) => senseiTestInfo(gs, game.rules, content)));

  let error = $state<string | null>(null);

  function take(): void {
    const result = game.dispatch({ type: 'exam.genin.start' });
    error = result.ok ? null : result.reason;
  }

  const stop = () => {
    if (test) game.dispatch({ type: 'action.stop', slot: test.slot });
  };
</script>

<SimplePage title={t('rank.title')}>
  <Hint id="rank" />

  <section class="plate" data-rank={rank}>
    <Icon name="rank-3" size={32} />
    <div>
      <p class="label">{t('rank.current')}</p>
      <p class="rank">{t(`rank.${rank}`)}</p>
    </div>
  </section>

  {#if exam}
    <section class="exam" data-exam={exam.id}>
      <h2><EntityLink kind="exam" id={exam.id} /></h2>
      {#if entityDesc({ kind: 'exam', id: exam.id })}
        <p class="desc">{entityDesc({ kind: 'exam', id: exam.id })}</p>
      {/if}

      {#if passed}
        <p class="done" data-passed>
          <Icon name="lucide:check" size={16} />
          {t('rank.passed')}
        </p>
        <p class="later">{t('rank.later')}</p>
      {:else}
        <h3>{t('rank.checklist')}</h3>
        {#if checklist}
          <div class="checklist" data-checklist><ReqTree node={checklist} /></div>
        {/if}

        {#if test}
          <div class="test" data-test>
            <h3>{t('rank.test')}</h3>
            <p>{t('rank.testRunning')}</p>
            <div
              class="bar"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(test.fraction * 100)}
              aria-label={t('rank.test')}
            >
              <span class="fill" style:width="{test.fraction * 100}%"></span>
            </div>
            <p class="left">{t('rank.testLeft', { time: formatDuration(test.left) })}</p>
            <button type="button" class="secondary" onclick={stop}>{t('rank.testStop')}</button>
          </div>
        {:else}
          <button type="button" class="take" disabled={!checklist?.met} onclick={take}>
            {t('rank.take')}
          </button>
          {#if !checklist?.met}<p class="blocked">{t('rank.takeBlocked')}</p>{/if}
          {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
        {/if}
      {/if}
    </section>
  {/if}
</SimplePage>

<style>
  .plate {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--steel);
  }

  .plate p {
    margin: 0;
  }

  .label {
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  .rank {
    color: var(--fg);
    font-family: var(--font-heading);
    font-size: 1.2rem;
  }

  .exam {
    margin-top: var(--space-4);
  }

  h2,
  h3 {
    margin: var(--space-3) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-weight: 400;
  }

  h2 {
    font-size: 1.2rem;
  }

  h2 :global(a) {
    color: inherit;
  }

  @media (max-width: 768px) {
    h2 :global(a) {
      display: inline-flex;
      align-items: center;
      min-height: 2.75rem;
    }
  }

  h3 {
    font-size: 1rem;
  }

  .desc,
  .later,
  .blocked {
    color: var(--fg-dim);
  }

  .checklist {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .done {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--success);
    font-weight: 600;
  }

  .take,
  .secondary {
    min-height: 2.75rem;
    margin-top: var(--space-3);
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .take:disabled {
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg-dim);
    cursor: default;
  }

  .secondary {
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg);
    font-weight: 400;
  }

  .test {
    padding: var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }

  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .left {
    margin: var(--space-2) 0 0;
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  .error {
    color: var(--danger);
  }
</style>
