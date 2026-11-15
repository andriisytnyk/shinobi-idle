<script lang="ts">
  import type { ReqResult } from '@shinobi/core';
  import { webRef } from '../lib/entities.ts';
  import { formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    node: ReqResult;
    /** Nesting level; the root of a tree prints no "all of" caption. */
    depth?: number;
  }

  let { node, depth = 0 }: Props = $props();

  const req = $derived(node.req);
  const ref = $derived(webRef(node.ref));
  const isGroup = $derived(req.t === 'all' || req.t === 'any');
  /** Rows with a count to reach show it with a thin bar. */
  const counted = $derived(
    req.t === 'skill' ||
      req.t === 'item' ||
      req.t === 'building' ||
      req.t === 'quest' ||
      (req.t === 'flag' && node.target > 1),
  );
  const fraction = $derived(
    node.target > 0 ? Math.min(1, Math.max(0, node.current / node.target)) : node.met ? 1 : 0,
  );
  const flagText = $derived(
    req.t === 'flag' ? (hasKey(`req.flag.${req.id}`) ? t(`req.flag.${req.id}`) : req.id) : '',
  );
</script>

{#if isGroup}
  <div class="group" data-met={node.met}>
    {#if req.t === 'any' || depth > 0}
      <p class="caption">{t(req.t === 'any' ? 'req.any' : 'req.all')}</p>
    {/if}
    <ul class="rows">
      {#each node.children as child, i (i)}
        <li><ReqTree node={child} depth={depth + 1} /></li>
      {/each}
    </ul>
  </div>
{:else}
  <div class="row" class:met={node.met} data-met={node.met}>
    <span class="mark"><Icon name={node.met ? 'lucide:check' : 'lucide:minus'} size={14} /></span>
    <span class="label">
      {#if req.t === 'skill'}
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} />{/if}
        <span class="detail">{t('req.level', { n: req.level })}</span>
      {:else if req.t === 'technique'}
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} />{/if}
        <span class="detail">{t(node.met ? 'req.known' : 'req.unknown')}</span>
      {:else if req.t === 'nature'}
        <span class="detail">{t('req.nature')}</span>
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} />{/if}
      {:else if req.t === 'item'}
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} />{/if}
      {:else if req.t === 'rank'}
        {t('req.rank', { rank: t(`rank.${req.rank}`) })}
      {:else if req.t === 'flag'}
        {flagText}
      {:else if ref}
        <EntityLink kind={ref.kind} id={ref.id} />
      {:else}
        {t(`req.type.${req.t}`)}
      {/if}
    </span>
    {#if counted}
      <span class="count"
        >{formatInt(Math.min(node.current, node.target))}/{formatInt(node.target)}</span
      >
      <span class="bar" aria-hidden="true"
        ><span class="fill" style:width="{fraction * 100}%"></span></span
      >
    {/if}
  </div>
{/if}

<style>
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rows :global(.group) {
    margin-left: var(--space-3);
    padding-left: var(--space-2);
    border-left: 1px solid var(--line);
  }

  .caption {
    margin: var(--space-1) 0;
    color: var(--fg-dim);
    font-size: 0.8rem;
  }

  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'mark label count'
      '. bar bar';
    align-items: center;
    column-gap: var(--space-2);
    padding: var(--space-1) 0;
    color: var(--fg-dim);
  }

  .row.met {
    color: var(--fg);
  }

  .mark {
    grid-area: mark;
    display: inline-flex;
    color: var(--fg-dim);
  }

  .met .mark {
    color: var(--success);
  }

  .label {
    grid-area: label;
    min-width: 0;
  }

  .label :global(a) {
    color: var(--fg);
    font-weight: 600;
  }

  .detail {
    margin-left: var(--space-1);
    color: var(--fg-dim);
    font-size: 0.85rem;
  }

  .count {
    grid-area: count;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }

  .bar {
    grid-area: bar;
    height: 3px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .met .fill {
    background: var(--success);
  }
</style>
