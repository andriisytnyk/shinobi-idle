<script lang="ts">
  import { evalReq, examFor } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import { entityDesc } from '../lib/entities.ts';
  import { formatDuration } from '../lib/format.ts';
  import { senseiTestInfo } from '../lib/exam-test.ts';
  import { rankEntries } from '../lib/rank-ladder.ts';
  import { t } from '../lib/i18n.ts';
  import { nextExamRank, rankIndex, rankName } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  const content = game.content;

  const rank = $derived(game.read((gs) => gs.player.rank));
  /** The exam to show: the next one the player has to take, else the last one they passed. */
  const exam = $derived.by(() => {
    const pending = nextExamRank(content, rank);
    if (pending !== null) return examFor(content, pending);
    const taken = content.exams.filter(
      (e) => rankIndex(content, e.rank) <= rankIndex(content, rank),
    );
    return taken.sort((a, b) => rankIndex(content, a.rank) - rankIndex(content, b.rank)).at(-1);
  });
  const passed = $derived(exam ? rankIndex(content, exam.rank) <= rankIndex(content, rank) : false);
  /** Links shown at once in a rank's «Відкриває» list; the rest are behind «ще N». */
  const OPENS_SHOWN = 5;
  const ladder = $derived(rankEntries(content, rank));
  const checklist = $derived(
    game.read((gs) => (exam ? evalReq(gs, exam.checklist, content) : null)),
  );

  /** The sensei test, while it runs, as a progress action. */
  const test = $derived(game.read((gs) => senseiTestInfo(gs, game.rules, content)));

  let error = $state<string | null>(null);

  function take(): void {
    const result = game.dispatch({ type: 'exam.start', rank: exam?.rank ?? '' });
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
      <p class="rank">{rankName(rank)}</p>
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

  <section class="ladder" data-ranks>
    <h2>{t('rank.ladder')}</h2>
    <ol>
      {#each ladder as entry (entry.id)}
        <li data-rank-row={entry.id} data-state={entry.state}>
          <span class="name">{rankName(entry.id)}</span>
          <span class="state">{t(`rank.state.${entry.state}`)}</span>
          {#if entry.exam}<span class="opens"><EntityLink kind="exam" id={entry.exam} /></span>{/if}
          {#if entry.opens.length > 0}
            <div class="opens" data-opens>
              <span>{t('rank.opens')}</span>
              <ul class="chips">
                {#each entry.opens.slice(0, OPENS_SHOWN) as ref (ref.kind + ref.id)}
                  <li><EntityLink kind={ref.kind} id={ref.id} /></li>
                {/each}
              </ul>
              {#if entry.opens.length > OPENS_SHOWN}
                <details class="more-opens">
                  <summary>{t('rank.opensMore', { n: entry.opens.length - OPENS_SHOWN })}</summary>
                  <ul class="chips">
                    {#each entry.opens.slice(OPENS_SHOWN) as ref (ref.kind + ref.id)}
                      <li><EntityLink kind={ref.kind} id={ref.id} /></li>
                    {/each}
                  </ul>
                </details>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  </section>
</SimplePage>

<style>
  .plate {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--steel);
  }

  .plate p {
    margin: 0;
  }

  .label {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .rank {
    color: var(--fg);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
  }

  .ladder ol {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ladder li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
  }

  .ladder li[data-state='current'] {
    border-color: var(--accent);
  }

  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ladder .opens {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    flex-basis: 100%;
  }

  .more-opens summary {
    cursor: pointer;
  }

  .ladder .name {
    font-weight: 600;
  }

  .ladder .state,
  .ladder .opens {
    color: var(--fg-dim);
    font-size: var(--text-xs);
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
    font-size: var(--text-lg);
  }

  h2 :global(a) {
    color: inherit;
  }

  @media (max-width: 768px) {
    h2 :global(a) {
      display: inline-flex;
      align-items: center;
      min-height: var(--control-md);
    }
  }

  h3 {
    font-size: var(--text-sm);
  }

  .desc,
  .later,
  .blocked {
    color: var(--fg-dim);
  }

  .checklist {
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
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
    min-height: var(--control-md);
    margin-top: var(--space-3);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--accent);
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
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-md);
  }

  .bar {
    height: var(--bar-thick);
    border-radius: var(--radius-sm);
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
    font-size: var(--text-xs);
  }

  .error {
    color: var(--danger);
  }
</style>
