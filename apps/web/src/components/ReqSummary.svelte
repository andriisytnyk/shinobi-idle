<script lang="ts">
  import type { ReqResult } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import {
    firstUnmetPart,
    firstUnmetRow,
    INLINE_REQ_ROWS,
    reqRows,
    topRequirements,
  } from '../lib/req-rows.ts';
  import Modal from './Modal.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    /** The whole requirement tree: every row, met or not. */
    node: ReqResult;
  }

  let { node }: Props = $props();

  const rows = $derived(reqRows(node).length);
  const parts = $derived(topRequirements(node));
  const metCount = $derived(parts.filter((p) => p.met).length);
  const next = $derived(firstUnmetPart(node));
  const long = $derived(rows > INLINE_REQ_ROWS);
  let open = $state(false);
</script>

<div class="reqs" data-ui="req-summary" data-rows={rows}>
  {#if !long}
    <ReqTree {node} />
  {:else}
    <p class="head">
      <span data-req-count>{t('req.summary', { met: metCount, total: parts.length })}</span>
      <button type="button" class="open" data-req-open onclick={() => (open = true)}
        >{t('req.open')}</button
      >
    </p>
    {#if next && next.req.t === 'any' && reqRows(next).length > INLINE_REQ_ROWS}
      <!-- A long "one of": the count says it is a choice; the first row is the first thing to try, the button lists the rest. -->
      <p class="next" data-req-next>{t('req.anyCount', { n: reqRows(next).length })}</p>
      {#if firstUnmetRow(next)}<ReqTree node={firstUnmetRow(next)!} />{/if}
    {:else if next}
      <ReqTree node={next} />
    {/if}
  {/if}
</div>

{#if open}
  <Modal title={t('req.title')} onClose={() => (open = false)}>
    <div data-req-full><ReqTree {node} /></div>
  </Modal>
{/if}

<style>
  .head,
  .next {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .open {
    min-height: var(--control-xs);
    padding: 0 var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .open:hover {
    background: var(--accent);
    color: var(--ink-900);
  }
</style>
