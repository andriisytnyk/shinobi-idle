<script lang="ts">
  import { actionRef, masteryRef } from '../lib/entities.ts';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import type { AnbuReport } from '../lib/persistence.ts';
  import EntityLink from './EntityLink.svelte';
  import Modal from './Modal.svelte';

  interface Props {
    report: AnbuReport;
    onClose: () => void;
  }

  let { report, onClose }: Props = $props();
</script>

<Modal title={t('report.title')} paper {onClose}>
  <p>{t('report.away', { time: formatDuration(report.requestedMs) })}</p>
  {#if report.capped}
    <p class="note">{t('report.capped', { time: formatDuration(report.simulatedMs) })}</p>
  {/if}

  {#if report.skills.length > 0}
    <h3>{t('report.skills')}</h3>
    <ul>
      {#each report.skills as row (row.skill)}
        <li>
          <EntityLink kind="skill" id={row.skill} />:
          {t('report.xp', { n: formatInt(row.xp) })}{#if row.levels > 0}, {t('report.levels', {
              n: row.levels,
            })}{/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if report.mastery.length > 0}
    <h3>{t('report.mastery')}</h3>
    <ul>
      {#each report.mastery as row (row.key)}
        {@const ref = masteryRef(row.key, game.content)}
        <li><EntityLink kind={ref.kind} id={ref.id} />: {t('report.levels', { n: row.levels })}</li>
      {/each}
    </ul>
  {/if}

  {#if report.techniques.length > 0}
    <h3>{t('report.techniques')}</h3>
    <ul>
      {#each report.techniques as id (id)}
        <li><EntityLink kind="technique" {id} /></li>
      {/each}
    </ul>
  {/if}

  {#if report.stopped.length > 0}
    <h3>{t('report.stopped')}</h3>
    <ul>
      {#each report.stopped as stop, i (i)}
        {@const ref = actionRef(stop)}
        <li><EntityLink kind={ref.kind} id={ref.id} />: {t(`report.reason.${stop.reason}`)}</li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  p {
    margin: 0 0 var(--space-2);
  }

  .note {
    font-style: italic;
  }

  h3 {
    margin: var(--space-3) 0 var(--space-1);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: 400;
  }

  ul {
    margin: 0;
    padding-left: var(--space-4);
  }

  /* Links on the paper take the ink colour, not the accent that suits the dark theme. */
  :global(.paper) li :global(a) {
    color: var(--paper-ink);
    font-weight: 600;
    text-decoration: underline;
  }
</style>
