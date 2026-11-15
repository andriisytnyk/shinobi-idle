<script lang="ts">
  import { content } from '@shinobi/content';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** Ids of the seals in casting order. */
    seals: readonly string[];
  }

  let { seals }: Props = $props();

  const glyphOf = (id: string) => content.seals.find((s) => s.id === id)?.glyph ?? '?';
</script>

<ol class="strip">
  {#each seals as id, i (i)}
    <li class="seal">
      <span class="glyph" lang="ja">{glyphOf(id)}</span>
      <span class="name"><EntityLink kind="seal" {id} /></span>
    </li>
  {/each}
</ol>

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .seal {
    --_min-width: 4rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    min-width: var(--_min-width);
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }

  .glyph {
    color: var(--accent);
    font-family: var(--font-kanji);
    font-size: var(--text-display);
    line-height: 1;
  }

  .name {
    font-size: var(--text-xs);
  }
</style>
