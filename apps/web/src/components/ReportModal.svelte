<script lang="ts">
  import { actionRef, masteryRef } from '../lib/entities.ts';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { hasSquad, reportSections } from '../lib/squad.ts';
  import { game } from '../lib/store.ts';
  import { currencyName, moneyOf } from '../lib/vocab.ts';
  import type { AnbuReport } from '../lib/persistence.ts';
  import EntityLink from './EntityLink.svelte';
  import Modal from './Modal.svelte';

  interface Props {
    report: AnbuReport;
    onClose: () => void;
  }

  let { report, onClose }: Props = $props();
  const moneyLabel = currencyName(moneyOf(game.content));
  /** The stops by performer; the heads show once there are clones to tell from the character. */
  const sections = $derived(reportSections(report.stopped, report.dispelled ?? []));
  const heads = $derived(game.read((gs) => hasSquad(gs, game.content)));
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

  {#if (report.gained?.items.length ?? 0) > 0 || (report.gained?.currencies.length ?? 0) > 0}
    <h3>{t('report.gained')}</h3>
    <ul data-report-gained>
      {#each report.gained?.currencies ?? [] as row (row.id)}
        <li data-report-currency={row.id}>+{formatInt(row.n)} {currencyName(row.id)}</li>
      {/each}
      {#each report.gained?.items ?? [] as row (row.id)}
        <li data-report-item={row.id}>
          +{formatInt(row.n)} × <EntityLink kind="item" id={row.id} />
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

  {#if report.raids.length > 0}
    <h3>{t('report.raids')}</h3>
    <ul data-report-raids>
      {#each report.raids as row (row.raid)}
        <li data-report-raid={row.raid}>
          {#if row.over}
            {t('report.raid.over', {
              raid: t(`raid.${row.raid}.name`),
              repelled: row.repelled + row.byVillage,
              breached: row.breached,
              ryo: formatInt(row.ryo),
              currency: moneyLabel,
              rep: formatInt(row.rep),
            })}
          {:else}
            {t('report.raid.arrived', { raid: t(`raid.${row.raid}.name`) })}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if report.stopped.length > 0 || (report.dispelled ?? []).length > 0}
    <h3>{t('report.stopped')}</h3>
    {#each sections as section (section.n)}
      <section data-ui="report-performer" data-performer={section.n}>
        {#if heads}
          <h4>{section.clone ? t('squad.clone', { n: section.n }) : t('squad.you')}</h4>
        {/if}
        {#if section.dispelled}
          <p data-report-dispelled={section.dispelled.cause}>
            {t(`report.dispelled.${section.dispelled.cause}`)}{#if section.dispelled.xp > 0}
              {t('report.dispelled.xp', { n: formatInt(section.dispelled.xp) })}{/if}
          </p>
        {/if}
        <ul>
          {#each section.stopped as stop, i (i)}
            {@const ref = actionRef(stop)}
            <li>
              <EntityLink kind={ref.kind} id={ref.id} />: {t(`report.reason.${stop.reason}`)}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
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

  h4 {
    margin: var(--space-2) 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: 600;
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
