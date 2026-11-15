<script lang="ts">
  import { teammateName } from '../lib/vocab.ts';
  import { t } from '../lib/i18n.ts';
  import type { MissionNow } from '../lib/missions.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    now: MissionNow;
  }

  let { now }: Props = $props();

  const self = $derived(now.who === 'self');
</script>

<span class="mission" data-now-mission={now.id}>
  <span class="stage" data-now-stage>
    {t('mission.now.stage', { n: now.stage + 1, total: now.stages })}
  </span>
  <span class="head" data-now-head>
    {#if now.head.combat}
      <a href="#/combat" data-now-combat>
        {#if now.head.labelKey}{t(now.head.labelKey)}{:else}{t('mission.now.fight')}{/if}
      </a>
    {:else if now.head.labelKey}
      {t(now.head.labelKey)}
    {/if}
    {#each now.head.refs as ref (`${ref.kind}:${ref.id}`)}
      <EntityLink kind={ref.kind} id={ref.id} />
    {/each}
  </span>
  <span class="who" data-now-who={now.who}>
    {#if self}{t('mission.who.self')}{:else}{t('mission.who.mate', {
        name: teammateName(now.who),
      })}{/if}
  </span>
  {#if now.queued}
    <span class="warn" data-now-queued>{t('mission.now.queued')}</span>
  {/if}
  {#if now.failed > 0}
    <span class="warn" data-now-failed>
      {#if now.combat}
        {t('mission.now.defeats', { n: now.failed, max: now.maxDefeats })}
      {:else}
        {t('mission.now.failed', { n: now.failed })}
      {/if}
    </span>
  {/if}
</span>

<style>
  .mission {
    display: flex;
    flex: 1 0 100%;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .stage {
    color: var(--heading);
    font-weight: 600;
  }

  .head :global(a) {
    color: var(--fg);
  }

  .warn {
    color: var(--danger);
    font-weight: 600;
  }
</style>
