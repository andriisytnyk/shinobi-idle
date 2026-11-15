<script lang="ts">
  import { evalReq, shopEntries } from '@shinobi/core';
  import { blockOf, itemSource } from '../lib/crafts.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import BuildingNeed from './BuildingNeed.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  const content = game.content;

  interface Props {
    item: string;
    need: number;
    have: number;
  }

  let { item, need, have }: Props = $props();

  const missing = $derived(have < need);
  const source = $derived(itemSource(item, content));
  /** A shop good that the village has not yet opened says which building it waits for. */
  const locked = $derived(
    game.read((gs) => {
      const entry = shopEntries(content).find((s) => s.item === item);
      const block = entry ? blockOf(evalReq(gs, entry.req, content)) : null;
      return block?.kind === 'building' ? block : null;
    }),
  );
</script>

<li
  class="input"
  class:missing
  data-input={item}
  data-missing={missing}
  data-ui="ingredient-row"
  data-entity="item:{item}"
>
  <Icon entity={{ kind: 'item', id: item }} size={18} />
  <span class="name"><EntityLink kind="item" id={item} /></span>
  <span class="count" aria-label={t('craft.haveNeed', { have, need })}
    >{formatInt(have)}/{formatInt(need)}</span
  >
  {#if missing}
    <a class="source" href={source.href} data-source={source.kind}>{t(source.labelKey)}</a>
    {#if locked}<span class="locked" data-input-locked
        ><BuildingNeed id={locked.id} level={locked.n} /></span
      >{/if}
  {/if}
</li>

<style>
  .input {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    color: var(--steel);
  }

  .name {
    color: var(--fg);
  }

  .count {
    font-variant-numeric: tabular-nums;
  }

  .missing .count {
    color: var(--danger);
    font-weight: 700;
  }

  .missing .name {
    text-decoration: underline dotted var(--danger);
  }

  .source {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-md);
    font-size: var(--text-xs);
  }

  @media (min-width: 769px) {
    .source {
      min-height: 0;
    }
  }
</style>
