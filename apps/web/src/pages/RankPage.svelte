<script lang="ts">
  import {
    evalReq,
    examFor,
    hasRenownRank,
    renownLadder,
    renownOf,
    writtenPassed,
  } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import { entityDesc } from '../lib/entities.ts';
  import { formatDuration } from '../lib/format.ts';
  import { senseiTestInfo } from '../lib/exam-test.ts';
  import { examOperations, perksOf, rankEntries } from '../lib/rank-ladder.ts';
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

  /** A two-part exam (the Chunin one): the written test, then the rest of the exam, then the rank. */
  const written = $derived(game.read((gs) => (exam ? writtenPassed(gs, exam) : false)));
  const rest = $derived(
    game.read((gs) => (exam?.then && written ? evalReq(gs, exam.then, content) : null)),
  );
  /** The operations that are the rest of the exam, with where each stands. */
  const stages = $derived(
    game.read((gs) =>
      exam
        ? examOperations(content, exam).map((op) => ({
            id: op.id,
            open: op.unlock ? evalReq(gs, op.unlock, content).met : true,
            cleared: gs.flags[op.clearFlag] !== undefined,
            running: gs.slots.some((s) => s.action?.id === op.id),
          }))
        : [],
    ),
  );
  /** What the rank of the shown exam gives besides what it unlocks. */
  const perks = $derived(exam ? perksOf(content, exam.rank) : []);
  /** An exam that ends the story has a final screen that can be read again. */
  const last = $derived(exam?.finale === true);
  const ready = $derived(written ? (rest?.met ?? false) : (checklist?.met ?? false));
  const takeKey = $derived(
    !exam?.then ? 'rank.take' : written ? 'rank.confer' : 'rank.takeWritten',
  );

  /** The Renown ranks in order: held, the next one (its reward shown as far as the reveal rule of each thing allows), and those further on (name and threshold only). */
  const academy = $derived(content.playerRanks.find((r) => r.id === rank)?.academy === true);
  const renown = $derived(
    game.read((gs) => {
      const have = renownOf(gs, content);
      let nextSeen = false;
      return {
        have,
        rows: renownLadder(content).map((rank) => {
          const held = hasRenownRank(gs, rank.id);
          const state = held ? 'held' : nextSeen ? 'ahead' : 'next';
          if (!held) nextSeen = true;
          return { rank, state };
        }),
      };
    }),
  );
  /** The discount a modifier of a rank gives, in whole percents. */
  const discount = (value: number): number => Math.round(Math.abs(value) * 100);

  let error = $state<string | null>(null);

  /** Starts an operation of the exam: the action kind that holds it is looked up in the rules. */
  function runStage(id: string): void {
    const kind = Object.entries(game.rules.actionKinds).find(([, k]) => k.has(id, content))?.[0];
    if (kind === undefined) return;
    const result = game.dispatch({ type: 'action.start', slot: 0, kind, id });
    error = result.ok ? null : result.reason;
  }

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

      {#if perks.length > 0}
        <h3>{t('rank.gives')}</h3>
        <ul class="perks" data-perks>
          {#each perks as perk (perk.kind)}
            <li>{t(`rank.perk.${perk.kind}`, { n: perk.n })}</li>
          {/each}
        </ul>
      {/if}

      {#if passed}
        <p class="done" data-passed>
          <Icon name="lucide:check" size={16} />
          {t('rank.passed')}
        </p>
        <p class="later">{t(last ? 'rank.lastDone' : 'rank.later')}</p>
        {#if last}
          <button type="button" class="take" data-finale-open onclick={() => game.showFinale()}>
            {t('rank.finale')}
          </button>
        {/if}
      {:else}
        <h3>{t('rank.checklist')}</h3>
        {#if checklist}
          <div class="checklist" data-checklist><ReqTree node={checklist} /></div>
        {/if}

        {#if written}
          <p class="done" data-written>
            <Icon name="lucide:check" size={16} />
            {t('rank.writtenDone')}
          </p>
          <h3>{t('rank.then')}</h3>
          {#if rest}
            <div class="checklist" data-then><ReqTree node={rest} /></div>
          {/if}
          {#if stages.length > 0}
            <h3>{t('rank.stages')}</h3>
            <ul class="stages" data-stages>
              {#each stages as stage (stage.id)}
                <li
                  data-stage={stage.id}
                  data-state={stage.cleared ? 'cleared' : stage.open ? 'open' : 'locked'}
                >
                  <span class="stage-name">{t(`operation.${stage.id}.name`)}</span>
                  <span class="stage-state"
                    >{t(
                      stage.cleared
                        ? 'rank.stageCleared'
                        : stage.running
                          ? 'rank.stageRunning'
                          : stage.open
                            ? 'rank.stageOpen'
                            : 'rank.stageLocked',
                    )}</span
                  >
                  {#if stage.open && !stage.running}
                    <button type="button" class="secondary" onclick={() => runStage(stage.id)}>
                      {t(stage.cleared ? 'rank.stageAgain' : 'rank.stageStart')}
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}

        {#if test}
          <div class="test" data-test>
            <h3>
              {t(written ? 'rank.conferring' : exam?.then ? 'rank.writtenTest' : 'rank.test')}
            </h3>
            <p>
              {t(
                written
                  ? 'rank.conferRunning'
                  : exam?.then
                    ? 'rank.writtenRunning'
                    : 'rank.testRunning',
              )}
            </p>
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
          <button type="button" class="take" disabled={!ready} onclick={take}>
            {t(takeKey)}
          </button>
          {#if !ready}<p class="blocked">
              {t(written ? 'rank.conferBlocked' : 'rank.takeBlocked')}
            </p>{/if}
          {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
        {/if}
      {/if}
    </section>
  {/if}

  {#if renown.rows.length > 0 && !academy}
    <section class="ladder renown" data-renown>
      <h2>{t('rank.renown.title')}</h2>
      <p class="label" data-renown-now>{t('rank.renown.now', { n: renown.have })}</p>
      <ol>
        {#each renown.rows as { rank, state } (rank.id)}
          <li data-renown-row={rank.id} data-state={state}>
            <span class="name">{t(`renownRank.${rank.id}.name`)}</span>
            <span class="state">
              {state === 'held' ? t('rank.renown.held') : t('rank.renown.at', { n: rank.renown })}
            </span>
            {#if state === 'held'}
              <p class="desc" data-renown-desc>{t(`renownRank.${rank.id}.desc`)}</p>
            {:else if state === 'next'}
              <div class="opens" data-renown-reward>
                <span>{t('rank.renown.reward')}</span>
                <ul class="chips">
                  {#each rank.rewards.items as item (item.item)}
                    <li><EntityLink kind="item" id={item.item} offered /> × {item.n}</li>
                  {/each}
                  {#each rank.rewards.opens as ref (ref.kind + ref.id)}
                    <li><EntityLink kind={ref.kind} id={ref.id} /></li>
                  {/each}
                  {#if rank.rewards.scroll}
                    <li>{t('rank.renown.scroll', { n: rank.rewards.scroll.library })}</li>
                  {/if}
                  {#each rank.rewards.mods.filter((m) => m.key === 'shop.price') as m (m.key)}
                    <li>{t('rank.renown.discount', { n: discount(m.value) })}</li>
                  {/each}
                </ul>
              </div>
            {:else}
              <p class="desc" data-renown-locked>{t('rank.renown.locked')}</p>
            {/if}
          </li>
        {/each}
      </ol>
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

  .ladder li[data-state='current'],
  .ladder li[data-state='next'] {
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

  .renown .desc {
    flex-basis: 100%;
    margin: 0;
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

  .perks {
    margin: 0;
    padding-left: var(--space-4);
  }

  .stages {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stages li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
  }

  .stages li[data-state='cleared'] {
    border-color: var(--success);
  }

  .stage-name {
    font-weight: 600;
  }

  .stage-state {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .stages .secondary {
    margin-top: 0;
    margin-left: auto;
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
