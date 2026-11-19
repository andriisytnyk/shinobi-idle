<script lang="ts">
  import { AUTOSURVEY_ID, AUTOSURVEY_KIND } from '@shinobi/core';
  import { autoState } from '../lib/hex-map.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import StartSplit from './StartSplit.svelte';

  const content = game.content;

  interface Props {
    /** The id of the element that says why the button is disabled. */
    whyId?: string;
  }

  let { whyId }: Props = $props();

  const data = $derived(game.read((gs) => autoState(gs, content)));

  const stop = () => void game.dispatch({ type: 'action.stop', slot: data.slot });
</script>

{#if data.slot >= 0}
  <button type="button" class="action stop" data-auto-stop onclick={stop}>
    {t('map.act.autoStop')}
  </button>
{:else}
  <StartSplit
    kind={AUTOSURVEY_KIND}
    id={AUTOSURVEY_ID}
    label="map.act.auto"
    disabled={data.why !== null}
    describedBy={data.why ? whyId : undefined}
    mark="auto"
  />
{/if}

<style>
  .action {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .action.stop {
    background: var(--surface-raised);
    color: var(--fg);
  }
</style>
