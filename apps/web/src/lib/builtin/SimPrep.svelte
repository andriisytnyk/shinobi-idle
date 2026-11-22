<script lang="ts">
  import { untrack } from 'svelte';
  import type { Analysis } from '@shinobi/core';
  import { laterInBrowser, runAnalysis } from '../analysis-runner.ts';
  import type { PrepCtx } from '../ext/slots.ts';
  import type { UiApi } from '../ext/types.ts';

  /*
   * «Симулятор бою», the preparation screen's part: the first fight's chance of a win and the
   * session's, with their intervals; wins, ryo and XP per hour; the current hand next to the
   * suggested one. It reads the game through `api` only, and runs the forecasts in slices.
   */

  interface Props {
    api: UiApi;
    ctx: PrepCtx;
  }

  let { api, ctx: context }: Props = $props();
  // The widget starts again when its context changes (the slot host remounts it), so the context is read once.
  const ctx = untrack(() => context);

  interface Column {
    which: 'now' | 'suggested';
    state: 'waiting' | 'running' | 'done' | 'failed';
    result: Analysis | null;
  }

  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));
  const compare = !same(ctx.hand, ctx.suggested) && ctx.suggested.length > 0;
  const known = ctx.level >= 1;

  let columns = $state<Column[]>([
    { which: 'now', state: 'waiting', result: null },
    ...(compare ? [{ which: 'suggested' as const, state: 'waiting' as const, result: null }] : []),
  ]);

  /*
   * What the forecast really depends on, as one text: the hand and the suggestion (the context), the
   * pouch as the fight would see it (with what the bank adds), the Wounds, the rank, how many techniques
   * are known and the levels of the skills. The game state changes on every tick; this text does not, so
   * the effect below runs again only when the character does change, and a tick never cancels a forecast.
   */
  const digest = $derived(
    api.read((gs) => {
      const cap = api.content.balance.K.pouchStack;
      return JSON.stringify([
        ctx.target,
        ctx.hand,
        ctx.suggested,
        gs.player.rank,
        gs.wounds.stacks,
        Object.keys(gs.known).filter((id) => gs.known[id]).length,
        gs.loadouts.active,
        gs.loadouts.cloneRole,
        gs.loadouts.targetPriority,
        gs.pouch.slots.map((slot) => [
          slot.id,
          slot.id === '' ? 0 : Math.min(cap, slot.n + (gs.bank[slot.id] ?? 0)),
        ]),
        Object.keys(gs.skills).map((k) => api.core.skillLevel(gs, k, api.content)),
      ]);
    }),
  );

  $effect(() => {
    void digest;
    if (!known) return;
    return untrack(restart);
  });

  /** Starts the forecasts again from the character as they are now; returns the way to stop them. */
  function restart(): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    for (const column of columns) {
      column.state = 'waiting';
      column.result = null;
    }
    const state = api.read();
    const run = (at: number): void => {
      const column = columns[at];
      if (!column || cancelled) return;
      column.state = 'running';
      const opts = column.which === 'suggested' ? { loadout: [...ctx.suggested] } : {};
      stop = runAnalysis({
        start: () => api.core.startAnalysis(state, ctx.target, opts, api.content, api.rules),
        step: (job, n) => api.core.stepAnalysis(job, n, api.content, api.rules),
        now: () => performance.now(),
        later: laterInBrowser,
        onUpdate(progress, result) {
          if (!progress.finished) return;
          column.state = result ? 'done' : 'failed';
          column.result = result;
          run(at + 1);
        },
        onFail() {
          column.state = 'failed';
        },
      });
    };
    run(0);
    return () => {
      cancelled = true;
      stop?.();
    };
  }

  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  const num = (x: number): string => (Math.round(x * 10) / 10).toLocaleString('uk');
  const sum = (r: Partial<Record<string, number>>): number =>
    Object.values(r).reduce<number>((n, v) => n + (v ?? 0), 0);
  const money = (x: number | 'unknown'): string => (x === 'unknown' ? '—' : num(x));
  const title = (which: Column['which']) => api.t(`x.simulator.col.${which}`);
</script>

<section class="sim" data-sim="prep">
  <h3>{api.t('x.simulator.title')}</h3>
  {#if !known}
    <p class="note">{api.t('x.simulator.unknown')}</p>
  {:else}
    {#if !compare}<p class="note">{api.t('x.simulator.sameHand')}</p>{/if}
    <div class="table" role="table" style:--_cols={columns.length}>
      <div class="row head" role="row">
        <span role="columnheader"></span>
        {#each columns as c (c.which)}<span role="columnheader">{title(c.which)}</span>{/each}
      </div>
      {#snippet line(label: string, cell: (a: Analysis) => string)}
        <div class="row" role="row">
          <span class="label" role="rowheader">{label}</span>
          {#each columns as c (c.which)}
            <span class="cell" role="cell" data-state={c.state}>
              {#if c.state === 'done' && c.result}{cell(
                  c.result,
                )}{:else if c.state === 'failed'}—{:else}…{/if}
            </span>
          {/each}
        </div>
      {/snippet}
      {@render line(api.t('x.simulator.first'), (a) =>
        api.t('x.simulator.interval', {
          p: pct(a.fresh.winRate),
          lo: pct(a.fresh.winRateCi.lo),
          hi: pct(a.fresh.winRateCi.hi),
          n: a.fresh.winRateCi.n,
        }),
      )}
      {@render line(api.t('x.simulator.session'), (a) =>
        a.session
          ? api.t('x.simulator.interval', {
              p: pct(a.session.winRate.median),
              lo: pct(a.session.winRateCi.lo),
              hi: pct(a.session.winRateCi.hi),
              n: a.session.winRateCi.n,
            })
          : '—',
      )}
      {@render line(api.t('x.simulator.wins'), (a) =>
        a.session ? num(a.session.winsPerHour.mean) : '—',
      )}
      {@render line(api.t('x.simulator.money'), (a) =>
        a.session ? money(a.session.ryoPerHour) : '—',
      )}
      {@render line(api.t('x.simulator.xp'), (a) =>
        a.session ? num(sum(a.session.xpPerHour)) : '—',
      )}
      {@render line(api.t('x.simulator.wounds'), (a) =>
        a.session ? num(a.session.woundsPerHour) : '—',
      )}
    </div>
    <p class="note">{api.t('x.simulator.note')}</p>
  {/if}
</section>

<style>
  .sim {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  h3 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .note {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .table {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) repeat(var(--_cols, 1), minmax(0, 1fr));
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: var(--border-thin) solid var(--line);
    font-size: var(--text-sm);
  }

  .head {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .label {
    color: var(--fg-dim);
  }

  .cell {
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
</style>
