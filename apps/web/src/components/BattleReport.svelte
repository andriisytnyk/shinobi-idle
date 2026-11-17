<script lang="ts">
  import { entryOf, fightTarget, type TargetReport } from '@shinobi/core';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { nameShown } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';

  const content = game.content;

  interface Row {
    key: string;
    /** The enemy or boss the target is of, when it has one entry. */
    entry: { kind: 'enemy' | 'boss'; id: string } | null;
    operation: boolean;
    report: TargetReport;
  }

  const kindOf = (id: string): 'enemy' | 'boss' =>
    content.bosses.some((b) => b.id === id) ? 'boss' : 'enemy';

  /** Targets with real fights behind them: what the analysis plays is never in the report. */
  const rows = $derived(
    game.read((gs) =>
      Object.entries(gs.report).flatMap(([key, report]): Row[] => {
        if (report.fights < 1) return [];
        const found = fightTarget(content, key);
        const id = found?.enemy.id ?? (entryOf(content, key) ? key : null);
        const operation = content.operations.some((o) => o.id === key);
        if (id === null && !operation) return [];
        return [{ key, entry: id ? { kind: kindOf(id), id } : null, operation, report }];
      }),
    ),
  );

  const techniqueIds = new Set(content.techniques.map((x) => x.id));
  const damageRows = (r: TargetReport) =>
    Object.entries(r.damage)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
  const maxDamage = (r: TargetReport): number => Math.max(1, ...Object.values(r.damage));
  const usesRows = (r: TargetReport) => Object.entries(r.uses).sort((a, b) => b[1] - a[1]);
  const traitOf = (source: string): string | null =>
    source.startsWith('trait:') ? source.slice('trait:'.length) : null;
  const nameOfOp = (key: string) =>
    hasKey(`operation.${key}.name`) ? t(`operation.${key}.name`) : key;
</script>

<section class="report" data-battle-report>
  <p class="intro">{t('battle.intro')}</p>
  {#if rows.length === 0}
    <p class="empty" data-empty>{t('battle.empty')}</p>
  {/if}
  <ul class="rows">
    {#each rows as row (row.key)}
      {@const r = row.report}
      <li class="row" data-report-row>
        <h3>
          {#if row.entry && nameShown(row.entry)}<EntityLink
              kind={row.entry.kind}
              id={row.entry.id}
            />{:else if row.operation}{nameOfOp(row.key)}{:else}{t('battle.unknownTarget')}{/if}
        </h3>
        <p class="totals" data-totals>
          {t('battle.totals', {
            fights: formatInt(r.fights),
            wins: formatInt(r.wins),
            losses: formatInt(r.losses),
            timeouts: formatInt(r.timeouts),
          })}
          {#if r.wins > 0}
            · {t('battle.winTime', { time: formatDuration(r.winMs / r.wins) })}
          {/if}
        </p>

        {#if r.defeats.length > 0}
          <h4>{t('battle.defeats')}</h4>
          <ul class="list" data-defeats>
            {#each r.defeats as d, i (i)}
              <li>
                {t('battle.defeat')}
                {#if nameShown({ kind: kindOf(d.enemy), id: d.enemy })}<EntityLink
                    kind={kindOf(d.enemy)}
                    id={d.enemy}
                  />{:else}???{/if}
                {t('battle.defeatAt', { time: formatDuration(d.tMs) })}
                {t('battle.defeatLeft', {
                  chakra: Math.round(d.chakra),
                  stamina: Math.round(d.stamina),
                })}
              </li>
            {/each}
          </ul>
        {/if}

        {#if usesRows(r).length > 0 || r.basic > 0}
          <h4>{t('battle.techniques')}</h4>
          <ul class="list" data-uses>
            {#each usesRows(r) as [id, n] (id)}
              <li><EntityLink kind="technique" {id} /> <span class="n">×{formatInt(n)}</span></li>
            {/each}
            {#if r.basic > 0}<li>
                {t('battle.basic')} <span class="n">×{formatInt(r.basic)}</span>
              </li>{/if}
          </ul>
        {/if}

        {#if damageRows(r).length > 0}
          <h4>{t('battle.damage')}</h4>
          <ul class="list" data-damage>
            {#each damageRows(r) as [source, n] (source)}
              <li class="dmg-row">
                <span class="src">
                  {#if techniqueIds.has(source)}<EntityLink kind="technique" id={source} />
                  {:else if source === 'basic'}{t('battle.basic')}
                  {:else if traitOf(source)}<EntityLink kind="trait" id={traitOf(source) ?? ''} />
                  {:else}{t('battle.otherSource')}{/if}
                </span>
                <span class="n">{formatInt(n)}</span>
                <progress class="bar" value={n} max={maxDamage(r)} aria-hidden="true"></progress>
              </li>
            {/each}
          </ul>
          <p class="note">{t('battle.taken', { n: formatInt(r.taken) })}</p>
        {/if}

        {#if Object.keys(r.combos).length > 0}
          <h4>{t('battle.combos')}</h4>
          <ul class="list" data-combos>
            {#each Object.entries(r.combos) as [id, n] (id)}
              <li><EntityLink kind="combo" {id} /> <span class="n">×{formatInt(n)}</span></li>
            {/each}
          </ul>
        {/if}

        {#if r.wounds > 0}
          <p class="note">{t('battle.wounds', { n: formatInt(r.wounds) })}</p>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .report {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .intro,
  .note,
  .empty,
  .totals {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .rows {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--tile-min), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  h3,
  h4 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-weight: 400;
  }

  h3 {
    font-size: var(--text-md);
  }

  h3 :global(a) {
    color: inherit;
  }

  h4 {
    font-size: var(--text-sm);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  .list :global(a) {
    color: var(--accent);
  }

  .n {
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
  }

  .dmg-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0 var(--space-2);
  }

  .bar {
    grid-column: 1 / -1;
    width: 100%;
    height: var(--bar-thin);
  }
</style>
