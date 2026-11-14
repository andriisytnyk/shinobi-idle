<script lang="ts">
  import { content, localeKey, SKILL_GROUPS, type SkillGroup } from '@shinobi/content';
  import { skillProgress } from '../lib/game.ts';
  import { t } from '../lib/i18n.ts';
  import { currentRoute } from '../lib/router.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  const NATURE_SKILLS: readonly string[] = ['katon', 'futon', 'raiton', 'doton', 'suiton'];

  // Groups come from the content, in the order the style document lists them.
  const groups = SKILL_GROUPS.map((id) => ({
    id,
    skills: content.skills.filter((s) => s.group === id),
  })).filter((g) => g.skills.length > 0);

  let collapsed = $state<Partial<Record<SkillGroup, boolean>>>({});

  const route = $derived(currentRoute());
  const activeSkill = $derived(
    route.page === 'entity' && route.ref.kind === 'skill' ? route.ref.id : null,
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
          {#each group.skills as skill (skill.id)}
            {@const progress = skillProgress(skill.id)}
            <li
              class="skill"
              class:active={activeSkill === skill.id}
              class:nature={NATURE_SKILLS.includes(skill.id)}
              style:--skill-color={NATURE_SKILLS.includes(skill.id)
                ? `var(--nature-${skill.id})`
                : 'var(--steel)'}
            >
              <span class="skill-icon"
                ><Icon entity={{ kind: 'skill', id: skill.id }} size={18} /></span
              >
              <span class="skill-name"><EntityLink kind="skill" id={skill.id} /></span>
              <span class="skill-level">{t('level.short', { n: progress.level })}</span>
              <span class="xp-bar" aria-hidden="true">
                <span class="xp-fill" style:width="{progress.fraction * 100}%"></span>
              </span>
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
    padding: var(--space-1) var(--space-2);
    border: 0;
    background: none;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    text-align: left;
    cursor: pointer;
  }

  .chevron {
    display: inline-flex;
    transition: transform 0.15s;
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
    position: relative;
    display: grid;
    grid-template-columns: 1.5rem 1fr auto;
    grid-template-areas:
      'icon name level'
      'bar bar bar';
    align-items: center;
    column-gap: var(--space-2);
    padding: var(--space-2);
    border-left: 3px solid transparent;
    border-radius: var(--radius-sm);
  }

  .skill:hover {
    background: var(--surface-raised);
  }

  .skill.active {
    border-left-color: var(--accent);
    background: var(--surface-raised);
  }

  .skill-icon {
    grid-area: icon;
    display: inline-flex;
    color: var(--skill-color);
  }

  .skill-name {
    grid-area: name;
  }

  /* The whole row is the click target of the entity link. */
  .skill :global(a)::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .skill-level {
    grid-area: level;
    color: var(--fg-dim);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }

  .xp-bar {
    grid-area: bar;
    height: 3px;
    margin-top: var(--space-1);
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }

  .xp-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
</style>
