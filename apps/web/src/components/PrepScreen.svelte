<script lang="ts">
  import { untrack } from 'svelte';
  import {
    evalReq,
    loadoutLimits,
    pouchSlotCount,
    rankIndex,
    startAnalysis,
    stepAnalysis,
    zoneRequirement,
    type Analysis,
    type AnalysisProgress,
    type ReqResult,
  } from '@shinobi/core';
  import { laterInBrowser, runAnalysis } from '../lib/analysis-runner.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { entityName } from '../lib/entities.ts';
  import { formatDuration, formatFactor, formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import {
    currentHand,
    defenceOf,
    defenceTechniques,
    disclosure,
    entriesOf,
    handCandidates,
    hasHand,
    knowledgeOfTarget,
    pouchChoices,
    reasonsOf,
    startCommand,
    suggestFor,
    type PrepTarget,
    type Reason,
  } from '../lib/prep.ts';
  import { game } from '../lib/store.ts';
  import ActionEmblem from './ActionEmblem.svelte';
  import EntityLink from './EntityLink.svelte';
  import NatureLink from './NatureLink.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    target: PrepTarget;
  }

  let { target }: Props = $props();

  const content = game.content;

  const first = $derived(entriesOf(target, content)[0]);
  const isBoss = $derived(content.bosses.some((b) => b.id === first));

  /** What the preparation reads from the state, as one text: it changes when the player or the fight world changes, not on every tick. */
  const inputs = $derived(
    game.read((gs) =>
      JSON.stringify([
        target,
        knowledgeOfTarget(gs, target, content),
        gs.player.rank,
        Object.keys(gs.known).filter((id) => gs.known[id]).length,
        gs.loadouts.active,
        gs.loadouts.auto,
        gs.pouch.slots,
        gs.pouch.medic,
        gs.wounds.stacks,
        gs.bank,
        gs.combat === null,
      ]),
    ),
  );

  const view = $derived.by(() => {
    void inputs;
    return untrack(() =>
      game.read((gs) => {
        const level = knowledgeOfTarget(gs, target, content);
        const rank = rankIndex(content, gs.player.rank);
        return {
          level,
          hasHand: hasHand(gs, content),
          slots: loadoutLimits(rank, content)?.slots ?? 0,
          hand: currentHand(gs, content),
          suggested: suggestFor(gs, target, content),
          candidates: handCandidates(gs, content).map((tech) => tech.id),
          defence: defenceOf(gs, target, content, game.rules),
          passives: defenceTechniques(gs, content).map((tech) => tech.id),
          pouch: gs.pouch.slots.map((s) => ({ ...s })),
          pouchSlots: pouchSlotCount(gs, content),
          choices: pouchChoices(gs, content),
          medic: gs.pouch.medic,
          wounds: gs.wounds.stacks,
          fighting: gs.combat !== null,
        };
      }),
    );
  });
  const level = $derived(view.level);
  const show = $derived(disclosure(level));
  const hand = $derived(view.hand);

  // ----- the forecast, in slices -----

  interface Forecast {
    state: 'idle' | 'running' | 'done' | 'failed';
    progress: AnalysisProgress;
    result: Analysis | null;
  }
  let forecast = $state.raw<Forecast>({
    state: 'idle',
    progress: { done: 0, total: 0, finished: false },
    result: null,
  });

  /** What the forecast depends on: it is run again when the hand, the pouch, the Wounds or the knowledge change. */
  const forecastInputs = $derived(
    game.read((gs) => {
      const cap = content.balance.K.pouchStack;
      return JSON.stringify([
        target,
        knowledgeOfTarget(gs, target, content),
        gs.player.rank,
        Object.keys(gs.known).filter((id) => gs.known[id]).length,
        gs.loadouts.active,
        gs.loadouts.auto,
        // The pouch as the fight sees it: what the bank adds counts, the rest of the bank does not (it changes while the player gathers).
        gs.pouch.slots.map((s) => [
          s.id,
          s.id === '' ? 0 : Math.min(cap, s.n + (gs.bank[s.id] ?? 0)),
        ]),
        gs.pouch.medic,
        gs.wounds.stacks,
      ]);
    }),
  );
  const forecastKey = $derived(show.verdict ? forecastInputs : '');
  $effect(() => {
    if (forecastKey === '') {
      forecast = { state: 'idle', progress: { done: 0, total: 0, finished: false }, result: null };
      return;
    }
    forecast = { state: 'running', progress: { done: 0, total: 0, finished: false }, result: null };
    const analysis = { kind: target.kind, id: target.id };
    return untrack(() =>
      runAnalysis({
        start: () => startAnalysis(game.state, analysis, {}, content, game.rules),
        step: (job, n) => stepAnalysis(job, n, content, game.rules),
        now: () => performance.now(),
        later: laterInBrowser,
        onUpdate(progress, result) {
          forecast = {
            state: progress.finished ? (result ? 'done' : 'failed') : 'running',
            progress,
            result,
          };
        },
        onFail() {
          forecast = { state: 'failed', progress: forecast.progress, result: null };
        },
      }),
    );
  });

  /** The target is not open yet: why, as the requirement the player has to meet (it is shown apart from the verdict). */
  const lockedReq = $derived.by((): ReqResult | null => {
    if (!forecast.result?.sessionBlocked) return null;
    return game.read((gs) => {
      const zone = content.zones.find((z) => z.id === target.id);
      const req =
        target.kind === 'operation'
          ? (content.operations.find((o) => o.id === target.id)?.unlock ?? null)
          : zone
            ? zoneRequirement(zone)
            : null;
      if (!req) return null;
      const result = evalReq(gs, req, content);
      return result.met ? null : result;
    });
  });
  const blocked = $derived(forecast.result?.sessionBlocked ?? null);

  const verdict = $derived(forecast.result?.session?.verdict ?? null);
  const reasons = $derived.by((): Reason[] => {
    const result = forecast.result;
    if (!result || !show.reasons) return [];
    return untrack(() => game.read((gs) => reasonsOf(gs, target, result, hand, content)));
  });

  // ----- commands -----

  let message = $state<string | null>(null);
  const say = (r: { ok: boolean; reason?: string }) => {
    message = r.ok ? null : (r.reason ?? 'error.unknown');
  };

  function toggle(id: string): void {
    const next = hand.includes(id) ? hand.filter((x) => x !== id) : [...hand, id];
    say(game.dispatch({ type: 'loadout.set', techniques: next }));
  }

  function suggest(): void {
    say(
      target.kind === 'zone'
        ? game.dispatch({ type: 'loadout.prepare', encounter: target.id })
        : game.dispatch({ type: 'loadout.set', techniques: view.suggested.techniques }),
    );
  }

  function setPouch(slot: number, item: string): void {
    say(game.dispatch({ type: 'pouch.set', slot, item: item === '' ? null : item }));
  }

  function start(): void {
    const r = game.dispatch(startCommand(target));
    say(r);
    if (r.ok) navigate('#/combat');
  }

  const targetName = $derived(
    first
      ? null
      : hasKey(`operation.${target.id}.name`)
        ? t(`operation.${target.id}.name`)
        : target.id,
  );
  const rankOf = (id: string) => content.techniques.find((x) => x.id === id)?.rank ?? null;
  const defenceParts = $derived(view.defence.parts);
</script>

<section class="prep" data-prep={target.kind} data-level={level}>
  <header class="head">
    <h2>
      {#if first}<EntityLink kind={isBoss ? 'boss' : 'enemy'} id={first} />{:else}{targetName}{/if}
    </h2>
    <p class="know" data-know>
      {t('prep.know', { n: level })}
      <a href="#/combat/bingo">{t('prep.bingoLink')}</a>
    </p>
  </header>

  <section class="block" data-ui="prep-hand">
    <h3>{t('prep.hand')}</h3>
    {#if !view.hasHand}
      <p class="note">{t('prep.studentHand')}</p>
    {:else}
      <p class="note">{t('prep.handSlots', { n: hand.length, max: view.slots })}</p>
    {/if}
    <ul class="slots">
      {#each hand as id (id)}
        <li class="slot" data-slot-technique>
          <ActionEmblem kind="technique" {id} rank={rankOf(id)} size="sm" />
          <EntityLink kind="technique" {id} />
          {#if view.hasHand && !view.fighting}
            <button type="button" class="small" onclick={() => toggle(id)}
              >{t('prep.remove')}</button
            >
          {/if}
        </li>
      {/each}
      {#if view.hasHand}
        {#each { length: Math.max(0, view.slots - hand.length) } as _, i (i)}
          <li class="slot empty">{t('prep.emptySlot')}</li>
        {/each}
      {/if}
    </ul>
    {#if view.hasHand && !view.fighting}
      {@const spare = view.candidates.filter((id) => !hand.includes(id))}
      {#if spare.length > 0}
        <h4>{t('prep.spare')}</h4>
        <ul class="slots">
          {#each spare as id (id)}
            <li class="slot">
              <ActionEmblem kind="technique" {id} rank={rankOf(id)} size="sm" />
              <EntityLink kind="technique" {id} />
              <button type="button" class="small" onclick={() => toggle(id)}>{t('prep.add')}</button
              >
            </li>
          {/each}
        </ul>
      {/if}
      <div class="row">
        <button type="button" class="suggest" onclick={suggest}>{t('prep.suggest')}</button>
        <span class="note">{t(level >= 1 ? 'prep.suggestNote' : 'prep.suggestBlind')}</span>
      </div>
    {/if}
  </section>

  <section class="block" data-ui="prep-defence">
    <h3>{t('prep.defence')}</h3>
    <p class="note">{t('prep.defenceNote')}</p>
    {#if view.passives.length === 0}
      <p class="note">{t('prep.defenceNone')}</p>
    {/if}
    <ul class="parts">
      {#each defenceParts as p (p.source + (p.id ?? ''))}
        <li class="part" data-part={p.source}>
          <span class="part-name">
            {#if p.source === 'technique' && p.id}
              <EntityLink kind="technique" id={p.id} />
            {:else}
              {t(`prep.part.${p.source}`)}
            {/if}
          </span>
          <span class="part-value"
            >{p.value >= 0 ? '+' : '−'}{formatFactor(Math.abs(Math.round(p.value * 10) / 10))}</span
          >
          {#if p.source === 'technique' && p.effectiveLevel !== undefined}
            <span class="part-detail">
              {t('prep.effectiveLevel', { n: Math.round(p.effectiveLevel) })}
              {#if view.defence.against !== null}
                {t('prep.againstLevel', {
                  n: view.defence.against,
                })}{#if p.levelAdj !== undefined && Math.abs(p.levelAdj) >= 0.05}, {t(
                    'prep.levelAdj',
                    {
                      n: `${p.levelAdj >= 0 ? '+' : '−'}${formatFactor(Math.abs(Math.round(p.levelAdj * 10) / 10))}`,
                    },
                  )}{/if}
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="total" data-evasion-total>
      {t('prep.evasionTotal', { n: formatFactor(Math.round(view.defence.total * 10) / 10) })}
    </p>
    {#if view.defence.against === null}<p class="note">{t('prep.defenceBlind')}</p>{/if}
  </section>

  <section class="block" data-prep-pouch>
    <h3>{t('prep.pouch')}</h3>
    {#if view.pouchSlots === 0}
      <p class="note">{t('prep.noPouch')}</p>
    {:else}
      <ul class="slots">
        {#each view.pouch as slot, i (i)}
          <li class="slot" data-pouch-slot={i}>
            {#if view.fighting}
              {#if slot.id !== ''}<EntityLink kind="item" id={slot.id} /> ×{formatInt(
                  slot.n,
                )}{:else}{t('prep.emptySlot')}{/if}
            {:else}
              <select
                aria-label={t('prep.pouchSlot', { n: i + 1 })}
                value={slot.id}
                onchange={(e) => setPouch(i, e.currentTarget.value)}
              >
                <option value="">{t('prep.emptySlot')}</option>
                {#each view.choices as id (id)}
                  <option
                    value={id}
                    disabled={id !== slot.id && view.pouch.some((s) => s.id === id)}
                    >{entityName({ kind: 'item', id })}</option
                  >
                {/each}
              </select>
              {#if slot.id !== ''}<span class="note">×{formatInt(slot.n)}</span>{/if}
            {/if}
          </li>
        {/each}
      </ul>
      <p class="note">{t('prep.pouchNote')}</p>
    {/if}
  </section>

  <section
    class="block verdict"
    data-ui="prep-verdict"
    data-verdict={verdict ?? undefined}
    data-forecast={forecast.state}
  >
    <h3>{t('prep.verdict')}</h3>
    {#if !show.verdict}
      <p class="unknown" data-unknown>{t('prep.unknown')}</p>
      <p class="note">{t('prep.unknownHint')}</p>
    {:else if forecast.state === 'running' || forecast.state === 'idle'}
      <p class="note" data-running>{t('prep.computing')}</p>
      <progress
        class="progress"
        aria-label={t('prep.computing')}
        value={forecast.progress.done}
        max={Math.max(1, forecast.progress.total)}
      ></progress>
    {:else if forecast.state === 'failed' || !forecast.result}
      <p class="note">{t('prep.forecastFailed')}</p>
    {:else if blocked}
      <p class="note" data-locked>{t('prep.locked')}</p>
    {:else if verdict}
      <p class="verdict-word" data-verdict-word={verdict}>{t(`prep.verdict.${verdict}`)}</p>
      <p class="note">{t(`prep.verdictNote.${verdict}`)}</p>
      {#if !show.reasons}<p class="note">{t('prep.reasonsHidden')}</p>{/if}
    {/if}
    {#if show.reasons && reasons.length > 0 && !blocked}
      <h4>{t('prep.reasons')}</h4>
      <ul class="reasons">
        {#each reasons as r, i (i)}
          <li class="reason" data-reason={r.kind}>
            {#if r.kind === 'trait'}
              {t('prep.reason.trait')} <EntityLink kind="trait" id={r.trait} />
            {:else if r.kind === 'allAnswered'}
              {t('prep.reason.allAnswered')}
            {:else if r.kind === 'hiddenTraits'}
              {t('prep.reason.hiddenTraits', { n: r.count })}
            {:else if r.kind === 'nature'}
              {t('prep.reason.nature')}
              <NatureLink id={r.nature} />.
              {#if r.strong > 0}{t('prep.reason.natureStrong', { n: r.strong })}{/if}
              {#if r.weak > 0}{t('prep.reason.natureWeak', { n: r.weak })}{/if}
              {#if r.strong === 0 && r.weak === 0}{t('prep.reason.natureNeutral')}{/if}
            {:else if r.kind === 'supply'}
              {t('prep.reason.supply')}
              <EntityLink kind="item" id={r.item} />
              {t('prep.reason.supplyLasts', {
                time: formatDuration(r.lastsMinutes * 60_000),
              })}{#if r.then}{t('prep.reason.supplyThen', {
                  verdict: t(`prep.verdict.${r.then}`),
                })}{/if}
            {:else if r.kind === 'wounds'}
              {t('prep.reason.wounds', { n: r.stacks })}
            {:else if r.kind === 'blocked'}
              {t(r.key)}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <Slot name="prep.verdict" ctx={{ target, level, hand, suggested: view.suggested.techniques }} />
  </section>

  {#if blocked}
    <section class="block" data-prep-locked>
      <h3>{t('prep.lockedNeeds')}</h3>
      {#if lockedReq}
        <ReqTree node={lockedReq} />
      {:else}
        <p class="note">{t(blocked)}</p>
      {/if}
    </section>
  {/if}

  {#if message}<p class="message" role="status">{t(message)}</p>{/if}

  <div class="go">
    <button type="button" class="start" disabled={view.fighting} onclick={start}
      >{t('combat.start')}</button
    >
    <a href="#/combat">{t('prep.back')}</a>
  </div>

  <Slot name="prep.footer" ctx={{ target, level, hand, suggested: view.suggested.techniques }} />
</section>

<style>
  .prep {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  h2,
  h3,
  h4 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-weight: 400;
  }

  h2 {
    font-size: var(--text-xl);
  }

  h3 {
    font-size: var(--text-md);
  }

  h4 {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
  }

  h2 :global(a) {
    color: inherit;
  }

  .know,
  .note {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .slots,
  .parts,
  .reasons {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .slot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-md);
  }

  .slot.empty {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .slot :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .part {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
  }

  .part-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .part-detail {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .total {
    margin: 0;
    font-weight: 600;
  }

  .verdict-word {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
  }

  .verdict[data-verdict='stable'] .verdict-word {
    color: var(--success);
  }

  .verdict[data-verdict='risky'] .verdict-word {
    color: var(--accent);
  }

  .verdict[data-verdict='hopeless'] .verdict-word {
    color: var(--danger);
  }

  .unknown {
    margin: 0;
    font-weight: 600;
  }

  .progress {
    width: 100%;
    height: var(--bar-md);
  }

  .reason {
    padding-left: var(--space-3);
    border-left: var(--border-thick) solid var(--line);
  }

  .message {
    margin: 0;
    color: var(--danger);
  }

  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }

  button {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  button.small {
    min-height: var(--control-sm);
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
  }

  button.start,
  button.suggest {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--ink-900);
    font-weight: 600;
  }

  button:disabled {
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg-dim);
    cursor: not-allowed;
  }

  select {
    min-height: var(--control-md);
    max-width: 100%;
    font: inherit;
  }
</style>
