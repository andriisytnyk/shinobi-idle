<script lang="ts">
  import { localeKey } from '@shinobi/content';
  import { actionInfo, listSkillActions, nonNativeCastMult, skillUnlockStatus } from '@shinobi/core';
  import ActionTile from '../components/ActionTile.svelte';
  import GearLine from '../components/GearLine.svelte';
  import HerbTile from '../components/HerbTile.svelte';
  import Hint from '../components/Hint.svelte';
  import Icon from '../components/Icon.svelte';
  import PoolBar from '../components/PoolBar.svelte';
  import RecipeTile from '../components/RecipeTile.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import PanelHost from '../lib/ext/PanelHost.svelte';
  import { tryUi } from '../lib/ext/runtime.svelte.ts';
  import Slot from '../lib/ext/Slot.svelte';
  import { entityDesc, entityName } from '../lib/entities.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { skillProgress } from '../lib/progress.ts';
  import { isNature, natureColor } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';

  const content = game.content;
  const ui = tryUi();

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const skill = $derived(content.skills.find((s) => s.id === id));
  const ref = $derived({ kind: 'skill', id } as const);
  /** The panel and hint that the activity of the skill has in the UI packs; none: the generic action tiles. */
  const panel = $derived(ui?.registry.skillPanel(skill?.activity ?? ''));
  const desc = $derived(entityDesc(ref));
  const unlockKey = $derived(localeKey('skill', id, 'unlock'));
  const progress = $derived(game.read((gs) => (skill ? skillProgress(gs, skill.id) : null)));
  const lock = $derived(
    game.read((gs) => (skill ? skillUnlockStatus(gs, skill.id, content) : null)),
  );
  /** For a nature skill the player owns: whether it is the native one, and the cast penalty still to work off. */
  const natureLine = $derived.by(() =>
    game.read((gs) => {
      const natures = gs.player.natures;
      if (!isNature(content, id) || !natures.includes(id)) return null;
      const K = content.balance.K;
      if (natures[0] === id)
        return { text: 'nature.skillNative', pct: Math.round((K.nativeXp - 1) * 100) };
      const mult = nonNativeCastMult(progress?.level ?? 1, content);
      return { text: 'nature.skillForeign', pct: Math.round((mult - 1) * 100) };
    }),
  );
  const gear = $derived(content.gear.filter((g) => g.skill === id));
  const actions = $derived(
    game.read((gs) => {
      if (!skill) return [];
      const listed = listSkillActions(gs, skill.id, content, game.rules);
      if (listed.length > 0 || skill.activity !== 'recipe') return listed;
      // The core lists the recipes of the skills it names itself; the recipes of a skill that a pack adds
      // with the recipe activity are the ones whose data names the skill.
      return content.recipes
        .filter((r) => r.skill === skill.id)
        .flatMap((r) => {
          const info = actionInfo(gs, { kind: 'craft', id: r.id }, content, game.rules);
          return info ? [info] : [];
        });
    }),
  );
</script>

{#if skill && progress}
  <article
    class="skill-page"
    data-skill={skill.id}
    data-ui="entity-page"
    data-entity="skill:{skill.id}"
  >
    <header class="plate" data-ui="entity-header">
      <h1>
        <span
          class="plate-icon"
          style:color={isNature(content, id) ? natureColor(content, id) : 'var(--steel)'}
          ><Icon entity={ref} size={32} /></span
        >
        {entityName(ref)}
      </h1>
      <span class="level">{t('level.short', { n: progress.level })}</span>
    </header>
    <Slot name="skill.header" ctx={{ skill: skill.id }} />

    {#if desc}<p class="lore">{desc}</p>{/if}
    {#if hasKey(unlockKey)}<p class="unlock">{t(unlockKey)}</p>{/if}
    {#if natureLine}
      <p class="nature-line" data-nature-line>
        {t(natureLine.text, { pct: natureLine.pct, end: content.balance.K.natures.penaltyEnd })}
      </p>
    {/if}

    <Hint id={panel?.hint ?? 'skillPage'} />

    {#if lock && !lock.met}
      <section data-ui="entity-section" class="locked" data-locked>
        <h2><Icon name="lucide:lock" size={18} /> {t('skill.locked')}</h2>
        <ReqTree node={lock} />
        {#if isNature(content, id)}
          <p><a class="nature-go" href="#/nature">{t('nature.skillOpen')}</a></p>
        {/if}
      </section>
    {/if}

    {#if panel?.mount && panel.place === 'replace'}
      <PanelHost owner={panel.key} packId={panel.packId} mount={panel.mount} ctx={{ skill: id }} />
    {:else if actions.length > 0}
      <section data-ui="entity-section">
        <h2>{t('skill.actions')}</h2>
        <ul class="tiles">
          {#each actions as info (info.kind + info.id)}
            {#if info.kind === 'gather'}
              <HerbTile {info} />
            {:else if info.kind === 'craft'}
              <RecipeTile {info} />
            {:else}
              <ActionTile {info} />
            {/if}
          {/each}
        </ul>
      </section>
    {:else}
      <p class="placeholder">{t('skill.page.empty')}</p>
    {/if}

    {#if panel?.mount && panel.place !== 'replace'}
      <PanelHost owner={panel.key} packId={panel.packId} mount={panel.mount} ctx={{ skill: id }} />
    {/if}

    {#if gear.length > 0}
      <section data-ui="entity-section" data-gear-section>
        <h2>{t('skill.gear')}</h2>
        {#each gear as line (line.id)}
          <GearLine {line} compact />
        {/each}
      </section>
    {/if}

    <PoolBar skill={skill.id} />
    <Slot name="skill.footer" ctx={{ skill: skill.id }} />
  </article>
{:else}
  <p>{t('route.notFound')}</p>
{/if}

<style>
  .plate {
    --_border-left: 6px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    border-left: var(--_border-left) solid var(--steel);
  }

  h1 {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: 400;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
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
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
  }

  .locked h2 {
    margin-top: var(--space-1);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-min), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
  }
</style>
