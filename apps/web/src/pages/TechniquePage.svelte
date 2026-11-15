<script lang="ts">
  import { content, localeKey, TRAIT_ANSWER } from '@shinobi/content';
  import { actionInfo, evalReq, type Req } from '@shinobi/core';
  import ActionTile from '../components/ActionTile.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import Icon from '../components/Icon.svelte';
  import RankStamp from '../components/RankStamp.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import SealStrip from '../components/SealStrip.svelte';
  import { t } from '../lib/i18n.ts';
  import { techniqueGoal } from '../lib/goal.ts';
  import { techniqueRelations } from '../lib/technique-links.ts';
  import { game } from '../lib/store.ts';
  import { entityName } from '../lib/entities.ts';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const tech = $derived(content.techniques.find((x) => x.id === id));
  const ref = $derived({ kind: 'technique', id } as const);
  const relations = $derived(techniqueRelations(id, content));
  const known = $derived(game.state.known[id] === true);

  /** What it takes to learn the technique: its skill level, plus the rank for a mentor away from the Academy. */
  const requirements = $derived.by(() => {
    if (!tech) return null;
    const of: Req[] = [{ t: 'skill', skill: tech.skill, level: tech.level }];
    if (tech.src === 'N' && tech.mentor === 'other') of.push({ t: 'rank', rank: 'genin' });
    return evalReq(game.state, { t: 'all', of }, content);
  });

  /** Tags answer enemy traits; show which trait each tag counters. */
  const answers = $derived(
    (tech?.tags ?? []).map((tag) => ({
      tag,
      traits: (Object.entries(TRAIT_ANSWER) as [keyof typeof TRAIT_ANSWER, string][])
        .filter(([, answer]) => answer === tag)
        .map(([trait]) => trait),
    })),
  );

  const info = $derived(
    tech ? actionInfo(game.state, { kind: 'practice', id }, content, game.rules) : null,
  );

  const goal = $derived(techniqueGoal(id, content));
  const pinned = $derived(game.state.goal?.kind === 'technique' && game.state.goal.id === id);

  function togglePin(): void {
    if (pinned) game.dispatch({ type: 'goal.clear' });
    else if (goal) game.dispatch({ type: 'goal.set', ref: { kind: 'technique', id } });
  }
</script>

{#if tech}
  <article class="technique" data-technique={id}>
    <header class="scroll">
      <span class="icon"><Icon entity={ref} size={40} /></span>
      <div class="title">
        <p class="kind">
          {t('entity.kind.technique')} · <EntityLink kind="skill" id={tech.skill} />
        </p>
        <h1>{entityName(ref)}</h1>
      </div>
      {#if tech.rank}<RankStamp rank={tech.rank} />{/if}
    </header>

    <dl class="facts">
      <div>
        <dt>{t('technique.role')}</dt>
        <dd>{t(localeKey('role', tech.role, 'name'))}</dd>
      </div>
      <div>
        <dt>{t('technique.status')}</dt>
        <dd data-status={known ? 'known' : 'unknown'}>
          <Icon name={known ? 'lucide:check' : 'lucide:lock'} size={14} />
          {t(known ? 'technique.known' : 'technique.unknown')}
        </dd>
      </div>
      {#if tech.state}
        <div>
          <dt>{t('technique.effect')}</dt>
          <dd><EntityLink kind="status" id={tech.state} /></dd>
        </div>
      {/if}
      {#if answers.length > 0}
        <div>
          <dt>{t('technique.answers')}</dt>
          <dd>
            {#each answers as a, i (a.tag)}
              {#if i > 0},
              {/if}{t(localeKey('tag', a.tag, 'name'))}{#if a.traits.length > 0}
                ({t('technique.counters')}
                {#each a.traits as trait, j (trait)}{#if j > 0},
                  {/if}<EntityLink kind="trait" id={trait} />{/each}){/if}
            {/each}
          </dd>
        </div>
      {/if}
    </dl>

    {#if tech.sealSeq.length > 0}
      <section>
        <h2>{t('technique.seals')}</h2>
        <SealStrip seals={tech.sealSeq} />
      </section>
    {/if}

    <section>
      <h2>{t('technique.source')}</h2>
      <p>{t(`technique.src.${tech.src}`)}</p>
      <ul class="links">
        {#if relations.academy}<li><EntityLink kind="building" id="core:academy" /></li>{/if}
        {#if relations.library !== null}
          <li>
            <EntityLink kind="building" id="core:library" />
            {t('technique.libraryLevel', { n: relations.library })}
          </li>
        {/if}
        {#each relations.carriers as carrier (carrier.id)}
          <li><EntityLink kind={carrier.kind} id={carrier.id} /></li>
        {/each}
      </ul>
    </section>

    {#if relations.missions.length > 0}
      <section data-missions>
        <h2>{t('technique.missions')}</h2>
        <ul class="links">
          {#each relations.missions as mission (mission)}
            <li><EntityLink kind="mission" id={mission} /></li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if requirements}
      <section>
        <h2>{t('technique.requirements')}</h2>
        <ReqTree node={requirements} />
      </section>
    {/if}

    {#if info}
      <section>
        <h2>{t('technique.mastery')}</h2>
        <ul class="tile-host"><ActionTile {info} /></ul>
      </section>
    {/if}

    {#if goal}
      <button type="button" class="pin" aria-pressed={pinned} onclick={togglePin}>
        {t(pinned ? 'technique.unpin' : 'technique.pin')}
      </button>
    {/if}
  </article>
{:else}
  <p>{t('route.notFound')}</p>
{/if}

<style>
  .scroll {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--paper-ink);
    border-top: 0.6rem solid var(--ink-600);
    border-bottom: 0.6rem solid var(--ink-600);
    border-radius: var(--radius-sm);
    background: var(--paper);
    color: var(--paper-ink);
  }

  .scroll :global(a) {
    color: var(--paper-ink);
  }

  .icon {
    display: inline-flex;
  }

  .title {
    flex: 1;
  }

  .kind {
    margin: 0;
    font-size: 0.85rem;
  }

  h1 {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 1.4rem;
    font-weight: 400;
  }

  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: 1.1rem;
    font-weight: 400;
  }

  .links {
    margin: 0;
    padding-left: var(--space-4);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-3);
    margin: var(--space-3) 0 0;
  }

  dt {
    color: var(--fg-dim);
    font-size: 0.8rem;
  }

  dd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
  }

  dd[data-status='known'] {
    color: var(--success);
  }

  .tile-host {
    max-width: 20rem;
    margin: 0;
    padding: 0;
  }

  .pin {
    min-height: 2.75rem;
    margin-top: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .pin[aria-pressed='true'] {
    background: var(--accent);
    color: var(--ink-900);
  }
</style>
