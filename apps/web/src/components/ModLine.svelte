<script lang="ts">
  import type { Mod } from '@shinobi/content';
  import { modParts } from '../lib/points.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    mod: Mod;
  }

  let { mod }: Props = $props();

  const parts = $derived(modParts(mod));
</script>

{parts.label}
{#if parts.skill !== null}<EntityLink kind="skill" id={parts.skill} />{/if}
{parts.value}
