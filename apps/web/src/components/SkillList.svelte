<script lang="ts">
  import { content, localeKey, SKILL_GROUPS, type SkillGroup } from '@shinobi/content';
  import { skillUnlockStatus } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { tryUi } from '../lib/ext/runtime.svelte.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { markerOf } from '../lib/nav.ts';
  import { nextStep } from '../lib/next-step.ts';
  import { skillProgress } from '../lib/progress.ts';
  import { currentRoute } from '../lib/router.svelte.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';

  const NATURE_SKILLS: readonly string[] = ['katon', 'futon', 'raiton', 'doton', 'suiton'];

  let collapsed = $state<Partial<Record<SkillGroup, boolean>>>({});

  const ui = tryUi();
  const route = $derived(currentRoute());
  const native = $derived(game.read((gs) => gs.player.natures[0] ?? null));
  const markedSkill = $derived(
    game.read((gs) => markerOf(nextStep(gs, content)?.target ?? null, ui?.registry ?? null).skill),
  );
  const activeSkill = $derived(
    route.page === 'entity' && route.ref.kind === 'skill' ? route.ref.id : null,
  );

  /** Groups come from the content, in the order the style document lists them. */
  const groups = $derived(
    game.read((gs) =>
      SKILL_GROUPS.map((id) => ({
        id,
        skills: content.skills
          .filter((s) => s.group === id)
          .map((skill) => ({
            skill,
            lock: skillUnlockStatus(gs, skill.id, content),
            progress: skillProgress(gs, skill.id),
          }))
          .filter((row) => !(settings.hideLocked && row.lock && !row.lock.met)),
      })).filter((g) => g.skills.length > 0),
    ),
  );

  const toggle = (id: SkillGroup) => {
    collapsed[id] = !collapsed[id];
  };
</script>

<div class="skill-list">
  {#each groups as group (group.id)}
    <section class="group">
      <button
        type="button"
        class="group-head"
        aria-expanded={!collapsed[group.id]}
        onclick={() => toggle(group.id)}
      >
        <span class="chevron" class:open={!collapsed[group.id]}
          ><Icon name="lucide:chevron-right" size={14} /></span
        >
        {t(localeKey('group', group.id, 'name'))}
      </button>
      {#if !collapsed[group.id]}
        <ul>
          {#each group.skills as { skill, lock, progress } (skill.id)}
            {@const locked = lock !== null && !lock.met}
            <li
              class="skill"
              class:active={activeSkill === skill.id}
              class:locked
              data-skill={skill.id}
              data-ui="skill-row"
              data-entity="skill:{skill.id}"
              style:--skill-color={NATURE_SKILLS.includes(skill.id)
                ? `var(--nature-${skill.id})`
                : 'var(--steel)'}
            >
              <span class="skill-icon"
                ><Icon entity={{ kind: 'skill', id: skill.id }} size={18} /></span
              >
              <span class="skill-name"
                ><EntityLink kind="skill" id={skill.id} />{#if markedSkill === skill.id}<span
                    class="marker"
                    data-marker
                    role="img"
                    aria-label={t('nav.next')}
                  ></span>{/if}{#if native === skill.id}<span class="native" data-native
                    >{t('skill.native')}</span
                  >{/if}</span
              >
              {#if locked}
                <span class="skill-level" role="img" aria-label={t('skill.locked')}
                  ><Icon name="lucide:lock" size={14} /></span
                >
                <span class="condition" data-lock>
                  {#if lock}<ReqTree node={lock} />{/if}
                </span>
              {:else}
                <span class="skill-level">{t('level.short', { n: progress.level })}</span>
                <span class="xp-bar" aria-hidden="true">
                  <span class="xp-fill" style:width="{progress.fraction * 100}%"></span>
                </span>
              {/if}
              <Slot name="sidebar.skill" ctx={{ skill: skill.id }} />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</div>

<style>
  .skill-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-2);
    border: 0;
    background: none;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-align: left;
    cursor: pointer;
  }

  .chevron {
    display: inline-flex;
    transition: transform var(--duration-fast);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .skill {
    --_grid-template-columns: 1.5rem;
    position: relative;
    display: grid;
    grid-template-columns: var(--_grid-template-columns) 1fr auto;
    grid-template-areas:
      'icon name level'
      'bar bar bar';
    align-items: center;
    column-gap: var(--space-2);
    min-height: var(--control-md);
    padding: var(--space-2);
    border-left: var(--border-heavy) solid transparent;
    border-radius: var(--radius-sm);
  }

  .skill:hover {
    background: var(--surface-raised);
  }

  .skill.active {
    border-left-color: var(--accent);
    background: var(--surface-raised);
  }

  .skill.locked {
    color: var(--fg-dim);
  }

  .skill-icon {
    grid-area: icon;
    display: inline-flex;
    color: var(--skill-color);
  }

  .locked .skill-icon {
    opacity: 0.5;
  }

  .skill-name {
    grid-area: name;
  }

  /* The whole row is the click target of the entity link. */
  .skill :global(> .skill-name a)::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .skill-level {
    grid-area: level;
    display: inline-flex;
    color: var(--fg-dim);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .condition {
    grid-area: bar;
    position: relative;
    z-index: var(--z-raised);
    font-size: var(--text-xs);
  }

  .xp-bar {
    grid-area: bar;
    height: var(--bar-thin);
    margin-top: var(--space-1);
    border-radius: var(--radius-xs);
    background: var(--line);
    overflow: hidden;
  }

  .xp-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .native {
    margin-left: var(--space-2);
    padding: 0 var(--space-1);
    border: var(--border-thin) solid var(--skill-color);
    border-radius: var(--radius-sm);
    color: var(--fg-dim);
    font-size: var(--text-2xs);
  }

  .marker {
    display: inline-block;
    width: var(--icon-xs);
    height: var(--icon-xs);
    margin-left: var(--space-2);
    border-radius: 50%;
    background: var(--accent);
  }
</style>
