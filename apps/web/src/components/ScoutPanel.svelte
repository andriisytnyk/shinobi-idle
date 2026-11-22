<script lang="ts">
  import type { SkillId } from '@shinobi/content';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { skillProgress } from '../lib/progress.ts';
  import { game } from '../lib/store.ts';
  import MapStage from './MapStage.svelte';

  interface Props {
    /** The skill whose page shows the panel. */
    skill: string;
  }

  let { skill }: Props = $props();

  /** The experience of the skill, as a thin bar over the map. */
  const xp = $derived(
    game.read((gs) => ({
      xp: gs.skills[skill as SkillId]?.xp ?? 0,
      fraction: skillProgress(gs, skill as SkillId).fraction,
    })),
  );
</script>

<section class="scout-panel" data-scout-panel>
  <div class="xp" data-scout-xp>
    <span class="label">{t('scout.xp')} {formatInt(Math.floor(xp.xp))}</span>
    <div
      class="bar"
      role="progressbar"
      aria-label={t('scout.xp')}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(xp.fraction * 100)}
    >
      <span class="fill" style:width="{xp.fraction * 100}%"></span>
    </div>
    <span class="pct">{Math.round(xp.fraction * 100)}%</span>
  </div>
  <MapStage hint={null} />
</section>

<style>
  .scout-panel {
    /* The skill header and the status row take room above the map: it is a little lower than on the map page. */
    --_map-stage-h: max(22rem, calc(100dvh - 31rem));
    margin: var(--space-2) 0;
  }

  .xp {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    color: var(--fg-dim);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .bar {
    flex: 1;
    height: var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
</style>
