<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { holderRef } from '../lib/missions.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** The key of the refusal text. */
    reason: string;
    /** The action that holds the slot, as core names it in a refusal; none when core names no holder. */
    by?: { kind: string; id: string } | null;
  }

  let { reason, by = null }: Props = $props();

  const holder = $derived(by ? holderRef(by) : null);
</script>

{t(reason)}
{#if holder}
  {t('mission.busyBy')}
  {#if holder.ref}
    <EntityLink kind={holder.ref.kind} id={holder.ref.id} />
  {:else}
    <a href="#/combat">{t('mission.busyCombat')}</a>
  {/if}
{/if}
