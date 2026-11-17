<script lang="ts">
  import { AUTOSURVEY_ID, AUTOSURVEY_KIND } from '@shinobi/core';
  import { autoState } from '../lib/hex-map.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';

  const content = game.content;

  interface Props {
    /** The id of the element that says why the button is disabled. */
    whyId?: string;
  }

  let { whyId }: Props = $props();

  const data = $derived(game.read((gs) => autoState(gs, content)));

  const start = () =>
    void game.dispatch({ type: 'action.start', slot: 0, kind: AUTOSURVEY_KIND, id: AUTOSURVEY_ID });
  const stop = () => void game.dispatch({ type: 'action.stop', slot: data.slot });
</script>

{#if data.slot >= 0}
  <button type="button" class="action stop" data-auto-stop onclick={stop}>
    {t('map.act.autoStop')}
  </button>
{:else}
  <button
    type="button"
    class="action"
    data-auto
    disabled={data.why !== null}
    aria-describedby={data.why ? whyId : undefined}
    onclick={start}
  >
    {t('map.act.auto')}
  </button>
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

  .action:disabled {
    border-color: var(--line);
    background: var(--surface-raised);
    color: var(--fg-dim);
    cursor: not-allowed;
  }
</style>
