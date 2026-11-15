<script lang="ts">
  import { content, localeKey, NATURE_IDS, type SkillId } from '@shinobi/content';
  import { listSkillActions, nonNativeCastMult, skillUnlockStatus } from '@shinobi/core';
  import ActionTile from '../components/ActionTile.svelte';
  import CoursePanel from '../components/CoursePanel.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import MeditationPanel from '../components/MeditationPanel.svelte';
  import PoolBar from '../components/PoolBar.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import { entityDesc, entityName } from '../lib/entities.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { skillProgress } from '../lib/progress.ts';
  import { game } from '../lib/store.ts';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const skill = $derived(content.skills.find((s) => s.id === id));
  const ref = $derived({ kind: 'skill', id } as const);
  const desc = $derived(entityDesc(ref));
  const unlockKey = $derived(localeKey('skill', id, 'unlock'));
  const progress = $derived(skill ? skillProgress(game.state, skill.id as SkillId) : null);
  const lock = $derived(skill ? skillUnlockStatus(game.state, skill.id, content) : null);
  /** For a nature skill the player owns: whether it is the native one, and the cast penalty still to work off. */
  const natureLine = $derived.by(() => {
    const natures = game.state.player.natures;
    if (!(NATURE_IDS as readonly string[]).includes(id) || !natures.includes(id as never)) {
      return null;
    }
    const K = content.balance.K;
    if (natures[0] === id)
      return { text: 'nature.skillNative', pct: Math.round((K.nativeXp - 1) * 100) };
    const mult = nonNativeCastMult(progress?.level ?? 1, content);
    return { text: 'nature.skillForeign', pct: Math.round((mult - 1) * 100) };
  });
  const actions = $derived(
    skill ? listSkillActions(game.state, skill.id as SkillId, content, game.rules) : [],
  );
</script>

{#if skill && progress}
  <article class="skill-page" data-skill={skill.id}>
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
    {#if hasKey(unlockKey)}<p class="unlock">{t(unlockKey)}</p>{/if}
    {#if natureLine}
      <p class="nature-line" data-nature-line>
        {t(natureLine.text, { pct: natureLine.pct, end: content.balance.K.natures.penaltyEnd })}
      </p>
    {/if}

    <Hint id="skillPage" />

    {#if lock && !lock.met}
      <section class="locked" data-locked>
        <h2><Icon name="lucide:lock" size={18} /> {t('skill.locked')}</h2>
        <ReqTree node={lock} />
        {#if (NATURE_IDS as readonly string[]).includes(id)}
          <p><a class="nature-go" href="#/nature">{t('nature.skillOpen')}</a></p>
        {/if}
      </section>
    {/if}

    {#if id === 'ath'}
      <CoursePanel />
    {:else if actions.length > 0}
      <section>
        <h2>{t('skill.actions')}</h2>
        <ul class="tiles">
          {#each actions as info (info.kind + info.id)}
            <ActionTile {info} />
          {/each}
        </ul>
      </section>
    {:else}
      <p class="placeholder">{t('skill.page.empty')}</p>
    {/if}

    {#if id === 'med'}
      <MeditationPanel />
    {/if}

    <PoolBar skill={skill.id} />
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

  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.1rem;
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

  .nature-line {
    font-weight: 600;
  }

  .nature-go {
    color: var(--accent);
  }

  .unlock,
  .placeholder {
    color: var(--fg-dim);
  }

  .locked {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .locked h2 {
    margin-top: var(--space-1);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
  }
</style>
