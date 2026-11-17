<script lang="ts">
  import { untrack } from 'svelte';
  import type { Analysis } from '@shinobi/core';
  import { laterInBrowser, runAnalysis } from '../analysis-runner.ts';
  import type { UiApi } from '../ext/types.ts';

  /*
   * «Симулятор бою», the Bingo book's part: what the battle analysis says of this enemy for the
   * character as they are now. Run on demand (a book page holds many entries), in slices, through
   * `api` only.
   */

  interface Props {
    api: UiApi;
    ctx: { enemy: string; level: number };
  }

  let { api, ctx }: Props = $props();

  /** The zone that holds the enemy: the analysis is of a target, not of an entry. */
  const zone = untrack(() => api.content.zones.find((z) => z.enemy === ctx.enemy)?.id ?? null);

  let phase = $state<'idle' | 'running' | 'done' | 'failed'>('idle');
  let result = $state.raw<Analysis | null>(null);
  let stop: (() => void) | null = null;

  function run(): void {
    if (zone === null) return;
    phase = 'running';
    stop = runAnalysis({
      start: () =>
        api.core.startAnalysis(api.read(), { kind: 'zone', id: zone }, {}, api.content, api.rules),
      step: (job, n) => api.core.stepAnalysis(job, n, api.content, api.rules),
      now: () => performance.now(),
      later: laterInBrowser,
      onUpdate(progress, out) {
        if (!progress.finished) return;
        result = out;
        phase = out ? 'done' : 'failed';
      },
      onFail() {
        phase = 'failed';
      },
    });
  }

  $effect(() => () => stop?.());

  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  const seconds = (ms: number): string => `${Math.round(ms / 100) / 10}`;
</script>

{#if zone !== null && ctx.level >= 1}
  <div class="sim" data-sim="bingo">
    <h4>{api.t('x.simulator.title')}</h4>
    {#if phase === 'idle'}
      <button type="button" onclick={run}>{api.t('x.simulator.calc')}</button>
    {:else if phase === 'running'}
      <p class="note">{api.t('x.simulator.running')}</p>
    {:else if phase === 'failed' || !result}
      <p class="note">{api.t('x.simulator.failed')}</p>
    {:else}
      <ul>
        <li data-sim-first>
          {api.t('x.simulator.first')}:
          {api.t('x.simulator.interval', {
            p: pct(result.fresh.winRate),
            lo: pct(result.fresh.winRateCi.lo),
            hi: pct(result.fresh.winRateCi.hi),
            n: result.fresh.winRateCi.n,
          })}
        </li>
        {#if result.fresh.meanWinMs > 0}
          <li>{api.t('x.simulator.winTime', { n: seconds(result.fresh.meanWinMs) })}</li>
        {/if}
        <li>
          {api.t('x.simulator.woundsHour', { n: Math.round(result.fresh.woundsPerHour * 10) / 10 })}
        </li>
      </ul>
    {/if}
  </div>
{/if}

<style>
  .sim {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-top: var(--space-2);
    border-top: var(--border-thin) solid var(--line);
  }

  h4 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: 400;
  }

  ul {
    margin: 0;
    padding-left: var(--space-4);
    font-size: var(--text-sm);
  }

  .note {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  button {
    align-self: flex-start;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
</style>
