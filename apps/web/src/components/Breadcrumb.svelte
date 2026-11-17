<script lang="ts">
  import { t } from '../lib/i18n.ts';

  interface Crumb {
    label: string;
    /** The hash the crumb leads to; the last crumb (the page itself) and plain labels have none. */
    href?: string;
  }

  interface Props {
    items: readonly Crumb[];
  }

  let { items }: Props = $props();
</script>

<nav class="crumbs" data-ui="breadcrumb" aria-label={t('crumbs.label')}>
  <ol>
    {#each items as item, i (i)}
      <li aria-current={i === items.length - 1 ? 'page' : undefined}>
        {#if item.href}<a href={item.href}>{item.label}</a>{:else}<span>{item.label}</span>{/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .crumbs {
    margin: 0 0 var(--space-3);
    font-size: var(--text-xs);
  }

  ol {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--fg-dim);
  }

  li + li::before {
    content: '›';
  }

  li[aria-current='page'] {
    color: var(--fg);
  }

  a {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-xs);
    color: var(--accent);
  }
</style>
