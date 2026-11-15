<script lang="ts">
  import { content } from '@shinobi/content';
  import { itemSource } from '../lib/crafts.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    item: string;
    need: number;
    have: number;
  }

  let { item, need, have }: Props = $props();

  const missing = $derived(have < need);
  const source = $derived(itemSource(item, content));
</script>

<li class="input" class:missing data-input={item} data-missing={missing}>
  <Icon entity={{ kind: 'item', id: item }} size={18} />
  <span class="name"><EntityLink kind="item" id={item} /></span>
  <span class="count" aria-label={t('craft.haveNeed', { have, need })}
    >{formatInt(have)}/{formatInt(need)}</span
  >
  {#if missing}
    <a class="source" href={source.href} data-source={source.kind}>{t(source.labelKey)}</a>
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
    min-height: 2.75rem;
    font-size: 0.85rem;
  }

  @media (min-width: 769px) {
    .source {
      min-height: 0;
    }
  }
</style>
