<script lang="ts">
  import { localeKey } from '@shinobi/content';
  import { actionInfo, evalReq, type Req } from '@shinobi/core';
  import ActionEmblem from '../components/ActionEmblem.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import Icon from '../components/Icon.svelte';
  import MasteryRing from '../components/MasteryRing.svelte';
  import PinGoal from '../components/PinGoal.svelte';
  import ReqTree from '../components/ReqTree.svelte';
  import SealStrip from '../components/SealStrip.svelte';
  import { t, textOf } from '../lib/i18n.ts';
  import { techniqueGoal } from '../lib/goal.ts';
  import { techniqueRelations } from '../lib/technique-links.ts';
  import { techniqueFigures } from '../lib/technique-figures.ts';
  import { game } from '../lib/store.ts';
  import { practiceView } from '../lib/timing.ts';
  import { entityDesc, entityName } from '../lib/entities.ts';
  import { formatFactor, formatInt, formatSeconds } from '../lib/format.ts';
  import { graduateRank } from '../lib/vocab.ts';

  const content = game.content;

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const tech = $derived(content.techniques.find((x) => x.id === id));
  const ref = $derived({ kind: 'technique', id } as const);
  const desc = $derived(entityDesc(ref));
  const relations = $derived(techniqueRelations(id, content));
  const known = $derived(game.read((gs) => gs.known[id] === true));

  /** What it takes to learn the technique: its skill level, plus the rank for a mentor away from the Academy. */
  const requirements = $derived.by(() =>
    game.read((gs) => {
      if (!tech) return null;
      const of: Req[] = [{ t: 'skill', skill: tech.skill, level: tech.level }];
      if (tech.src === 'N' && tech.mentor === 'other')
        of.push({ t: 'rank', rank: graduateRank(content) ?? '' });
      return evalReq(gs, { t: 'all', of }, content);
    }),
  );

  /** Tags answer enemy traits; show which trait each tag counters. */
  const answers = $derived(
    (tech?.tags ?? []).map((tag) => ({
      tag,
      traits: content.traits.filter((trait) => trait.answer === tag).map((trait) => trait.id),
    })),
  );

  /** The tag's name, and «(проти: » when it has traits to name: the words (and their spaces) are one string, so no markup eats or doubles them. */
  const answerHead = (a: { tag: string; traits: string[] }, i: number): string =>
    `${i > 0 ? ', ' : ''}${t(localeKey('tag', a.tag, 'name'))}${
      a.traits.length > 0 ? ` (${t('technique.counters')} ` : ''
    }`;

  const info = $derived(
    game.read((gs) =>
      tech ? actionInfo(gs, { kind: 'practice', id }, content, game.rules) : null,
    ),
  );

  /** The practice of this technique while it runs: the strip below shows its seals live. */
  const view = $derived(
    game.read((gs) => {
      const slot = gs.slots.findIndex((s) => s.action?.kind === 'practice' && s.action.id === id);
      const now = actionInfo(gs, { kind: 'practice', id }, game.content, game.rules);
      return slot >= 0 && now ? practiceView(gs, slot, game.content, now.intervalMs) : null;
    }),
  );

  /** The fight numbers for the player as he is now, with the factors behind damage and cost. */
  const figures = $derived(
    game.read((gs) =>
      tech && tech.rank !== null
        ? techniqueFigures(gs, tech, content, game.rules, info?.masteryLevel ?? 1)
        : null,
    ),
  );
  const K = content.balance.K;
  const pct = (x: number): number => Math.round(x * 100);

  const stateStatus = $derived(content.statuses.find((x) => x.state === tech?.state));
  const goal = $derived(techniqueGoal(id, content));
</script>

{#snippet factors(rows: readonly { key: string; value: number; base?: boolean }[])}
  <ul class="factors">
    {#each rows as row (row.key)}
      <li>
        <span>{t(row.key)}</span>
        <span class="num"
          >{#if !row.base}&times;&nbsp;{/if}{formatFactor(row.value)}</span
        >
      </li>
    {/each}
  </ul>
{/snippet}

{#if tech}
  <article class="technique" data-technique={id} data-ui="entity-page" data-entity="technique:{id}">
    <header class="scroll" data-ui="entity-header">
      <ActionEmblem kind="technique" {id} rank={tech.rank ?? null} size="lg" />
      <div class="title">
        <p class="kind">
          {t('entity.kind.technique')} · <EntityLink kind="skill" id={tech.skill} />
        </p>
        <h1>{entityName(ref)}</h1>
      </div>
      {#if goal}<span class="pin"><PinGoal kind="technique" {id} variant="button" /></span>{/if}
    </header>

    {#if desc}<p class="desc">{desc}</p>{/if}

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
          <dd>
            <!-- A state is not a status: the status that the state puts on a body names it in its data. -->
            {#if stateStatus}<EntityLink kind="status" id={stateStatus.id} />{:else}{textOf([
                `state.${tech.state}.name`,
              ])}{/if}
          </dd>
        </div>
      {/if}
      {#if answers.length > 0}
        <div>
          <dt>{t('technique.answers')}</dt>
          <dd>
            {#each answers as a, i (a.tag)}{answerHead(
                a,
                i,
              )}{#each a.traits as trait, j (trait)}{j > 0 ? ', ' : ''}<EntityLink
                  kind="trait"
                  id={trait}
                />{/each}{#if a.traits.length > 0})
              {/if}{/each}
          </dd>
        </div>
      {/if}
    </dl>

    {#if tech.sealSeq.length > 0}
      <section data-ui="entity-section">
        <h2>{t('technique.seals')}</h2>
        <SealStrip seals={tech.sealSeq} {view} />
      </section>
    {/if}

    {#if figures}
      <section data-ui="entity-section" data-figures>
        <h2>{t('technique.numbers')}</h2>
        <dl class="figures">
          {#if figures.summon}
            <!-- A summon does no damage itself: its numbers are the bodies it puts on the caster's side. -->
            <div>
              <dt>{t('technique.summon.count')}</dt>
              <dd data-figure="summon-count">
                {t('technique.summon.countValue', {
                  n: figures.summon.count,
                  max: figures.summon.max,
                })}
              </dd>
            </div>
            <div>
              <dt>{t('technique.summon.hp')}</dt>
              <dd data-figure="summon-hp">{pct(figures.summon.hp)}%</dd>
            </div>
            <div>
              <dt>{t('technique.summon.dmg')}</dt>
              <dd data-figure="summon-dmg">{pct(figures.summon.dmg)}%</dd>
            </div>
            <div>
              <dt>{t('technique.summon.threat')}</dt>
              <dd data-figure="summon-threat">{formatFactor(figures.summon.threat)}</dd>
            </div>
            <div>
              <dt>{t('technique.summon.share')}</dt>
              <dd data-figure="summon-share">{pct(figures.summon.share)}%</dd>
            </div>
          {:else}
            <div>
              <dt>{t('technique.damage')}</dt>
              <dd data-figure="damage">
                {figures.damage ? formatInt(figures.numbers.damage) : t('technique.noDamage')}
              </dd>
            </div>
          {/if}
          <div>
            <dt>{t('technique.cast')}</dt>
            <dd data-figure="cast">{formatSeconds(figures.numbers.castMs)}</dd>
          </div>
          <div>
            <dt>{t('technique.cooldown')}</dt>
            <dd data-figure="cooldown">
              {figures.numbers.cooldownMs > 0
                ? formatSeconds(figures.numbers.cooldownMs)
                : t('technique.none')}
            </dd>
          </div>
          <div>
            <dt>
              {t('technique.cost')}: {t(
                figures.numbers.pool === 'stamina' ? 'combat.staminaBar' : 'combat.chakraBar',
              ).toLowerCase()}
            </dt>
            <dd data-figure="cost">
              {figures.numbers.cost > 0 ? formatFactor(figures.numbers.cost) : t('technique.none')}
            </dd>
          </div>
        </dl>
        {#if figures.damage || figures.cost.length > 0}
          <details class="breakdown" data-breakdown>
            <summary>{t('technique.breakdown')}</summary>
            {#if figures.damage}
              <h3>{t('technique.damage')}</h3>
              {@render factors(figures.damage)}
            {/if}
            {#if figures.cost.length > 0}
              <h3>{t('technique.cost')}</h3>
              {@render factors(figures.cost)}
            {/if}
          </details>
        {/if}
      </section>
    {/if}

    {#if info}
      <section data-ui="entity-section" data-mastery>
        <h2>{t('technique.mastery')}</h2>
        <p class="mastery-line">
          <MasteryRing level={info.masteryLevel} progress={info.masteryProgress} />
          <span>{t('technique.masteryLevel', { n: info.masteryLevel, cap: K.masteryCap })}</span>
        </p>
        <p class="dim">{t('technique.gives')}</p>
        <ul class="gives">
          {#if !tech.noDamage && tech.rank !== null}
            <li>{t('technique.gives.damage', { pct: pct(K.masteryDmg) })}</li>
          {/if}
          <li>{t('technique.gives.cost', { pct: pct(K.masteryCost) })}</li>
          {#if tech.sealSeq.length > 0}
            <li>{t('technique.gives.cast', { pct: pct(K.masteryCast) })}</li>
          {/if}
        </ul>
      </section>
    {/if}

    <section data-ui="entity-section">
      <h2>{t('technique.source')}</h2>
      <p>{t(`technique.src.${tech.src}`)}</p>
      <ul class="links">
        {#if relations.academy}<li><EntityLink kind="building" id={relations.academy} /></li>{/if}
        {#if relations.library}
          <li>
            <EntityLink kind="building" id={relations.library.building} />
            {t('technique.libraryLevel', { n: relations.library.level })}
          </li>
        {/if}
      </ul>
    </section>

    {#if relations.carriers.length > 0}
      <section data-ui="entity-section" data-scroll-carriers>
        <h2>{t('technique.scroll')}</h2>
        <ul class="links">
          {#each relations.carriers as carrier (carrier.id)}
            <li><EntityLink kind={carrier.kind} id={carrier.id} /></li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if relations.missions.length > 0}
      <section data-ui="entity-section" data-missions>
        <h2>{t('technique.missions')}</h2>
        <ul class="links">
          {#each relations.missions as mission (mission)}
            <li><EntityLink kind="mission" id={mission} /></li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if requirements}
      <section data-ui="entity-section">
        <h2>{t('technique.requirements')}</h2>
        <ReqTree node={requirements} />
        {#if goal}<p class="pin-caption"><PinGoal kind="technique" {id} variant="link" /></p>{/if}
      </section>
    {/if}
  </article>
{:else}
  <p>{t('route.notFound')}</p>
{/if}

<style>
  .scroll {
    --_border-top: 0.6rem;
    --_border-bottom: 0.6rem;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: var(--border-thin) solid var(--paper-ink);
    border-top: var(--_border-top) solid var(--ink-600);
    border-bottom: var(--_border-bottom) solid var(--ink-600);
    border-radius: var(--radius-sm);
    background: var(--paper);
    color: var(--paper-ink);
  }

  .scroll :global(a) {
    color: var(--paper-ink);
  }

  .title {
    --_flex-basis: 8rem;
    flex: 1 1 var(--_flex-basis);
    min-width: 0;
  }

  /* On a phone the pin button takes its own line under the title. */
  @media (max-width: 768px) {
    .pin {
      flex: 1 0 100%;
    }

    .pin :global(button) {
      width: 100%;
      justify-content: center;
    }
  }

  .kind {
    margin: 0;
    font-size: var(--text-xs);
  }

  h1 {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: 400;
  }

  h2 {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .desc {
    margin: var(--space-3) 0 0;
  }

  .dim {
    margin: 0 0 var(--space-1);
    color: var(--fg-dim);
  }

  .links,
  .gives {
    margin: 0;
    padding-left: var(--space-4);
  }

  .facts {
    --_grid-template-columns: 11rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--_grid-template-columns)), 1fr));
    gap: var(--space-3);
    margin: var(--space-3) 0 0;
  }

  dt {
    color: var(--fg-dim);
    font-size: var(--text-xs);
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

  .figures {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .figures dd {
    font-size: var(--text-lg);
    font-variant-numeric: tabular-nums;
  }

  .breakdown {
    margin-top: var(--space-3);
  }

  .breakdown summary {
    min-height: var(--control-sm);
    color: var(--accent);
    cursor: pointer;
  }

  .breakdown h3 {
    margin: var(--space-2) 0 var(--space-1);
    color: var(--fg-dim);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .factors {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .factors li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    border-top: var(--border-thin) solid var(--line);
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .mastery-line {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-2);
  }

  .pin-caption {
    margin: var(--space-2) 0 0;
  }
</style>
