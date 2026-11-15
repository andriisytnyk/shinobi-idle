<script lang="ts">
  import { game } from '../lib/store.ts';
  import { natureName } from '../lib/vocab.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** A nature of the content. */
    id: string;
  }

  let { id }: Props = $props();

  /** A nature has no page of its own; the skill that carries its name does, when there is one. */
  const hasSkill = $derived(game.content.skills.some((s) => s.id === id));
</script>

{#if hasSkill}<EntityLink kind="skill" {id} />{:else}<span class="nature-name"
    >{natureName(id)}</span
  >{/if}
