<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { entityDesc, entityName } from '../lib/entities.ts';
  import { skillProgress } from '../lib/game.ts';
  import { t } from '../lib/i18n.ts';
  import { content, localeKey, NATURE_IDS, type SkillId } from '@shinobi/content';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const skill = $derived(content.skills.find((s) => s.id === id));
  const ref = $derived({ kind: 'skill', id } as const);
  const desc = $derived(entityDesc(ref));
  const unlockKey = $derived(localeKey('skill', id, 'unlock'));
  const progress = $derived(skill ? skillProgress(skill.id as SkillId) : null);
</script>

{#if skill && progress}
  <article class="skill-page">
    <header class="plate">
      <h1>
        <span
          class="plate-icon"
          style:color={(NATURE_IDS as readonly string[]).includes(id)
            ? `var(--nature-${id})`
            : 'var(--steel)'}><Icon entity={ref} size={32} /></span
        >
        {entityName(ref)}
      </h1>
      <span class="level">{t('level.short', { n: progress.level })}</span>
    </header>
    {#if desc}<p class="lore">{desc}</p>{/if}
    <p class="unlock">{t(unlockKey)}</p>
    <p class="placeholder">{t('skill.page.empty')}</p>
  </article>
{:else}
  <p>{t('route.notFound')}</p>
{/if}

<style>
  .plate {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius);
    background: var(--surface-raised);
    border-left: 6px solid var(--steel);
  }

  h1 {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.6rem;
    font-weight: 400;
  }

  .plate-icon {
    display: inline-flex;
  }

  .level {
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
  }

  .lore {
    font-style: italic;
  }

  .unlock,
  .placeholder {
    color: var(--fg-dim);
  }
</style>
