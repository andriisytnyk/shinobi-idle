<script lang="ts">
  import type { BuildingInfo } from '@shinobi/core';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import {
    costLines,
    effectLines,
    missionsGiving,
    perHour,
    resourceName,
    whyOff,
  } from '../lib/village.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    info: BuildingInfo;
    /** On the building's own page the name is a heading, not a link. */
    page?: boolean;
    /** The card the route asked for. */
    focused?: boolean;
  }

  let { info, page = false, focused = false }: Props = $props();

  const now = $derived(effectLines(info.effectsNow));
  const next = $derived(effectLines(info.effectsNext));
  const produced = $derived(Object.entries(info.perTick).filter(([, n]) => n > 0));
  /** What a producer makes per tick once the next level is built (deposits count from then on). */
  const nextPerTick = $derived(game.content.balance.K.prod * (info.level + 1 + info.deposits));
  const costs = $derived(costLines(info));
  const why = $derived(whyOff(info));
  const missions = $derived(why?.shinobi ? missionsGiving(why.shinobi) : []);
  /** A shop or defence building has no bonus to list. */
  const plain = $derived(
    now.length === 0 && next.length === 0 && Object.keys(info.perTick).length === 0,
  );
  const unlockLevels = $derived([...new Set(info.unlocks.map((u) => u.level))]);

  function build(): void {
    if (!info.build.ok) return;
    const result = game.dispatch({ type: 'village.build', building: info.id });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

<section
  class="card"
  class:focused
  id="building-{info.id}"
  data-building={info.id}
  data-ui="building-card"
  data-entity="building:{info.id}"
  data-level={info.level}
  data-focused={focused}
>
  <header>
    <span class="icon"><Icon entity={{ kind: 'building', id: info.id }} size={32} /></span>
    <h3>
      {#if page}<span data-name>{t(`building.${info.id}.name`)}</span>{:else}<EntityLink
          kind="building"
          id={info.id}
        />{/if}
    </h3>
    <span class="level" data-level-text
      >{t('village.level', { n: info.level, max: info.maxLevel })}</span
    >
    {#if info.building}<span class="busy" data-busy>{t('village.building')}</span>{/if}
  </header>

  {#if !plain || info.nextLevel === null}
    <dl class="facts">
      <div>
        <dt>{t('village.now')}</dt>
        <dd>
          {#if now.length === 0 && produced.length === 0}
            <span class="ct-muted">{t('village.nothing')}</span>
          {/if}
          {#each now as line (line)}<p>{line}</p>{/each}
          {#if produced.length > 0}
            <p data-produces>
              {t('village.produces')}
              {#each produced as [id, n], i (id)}{i > 0 ? ', ' : ' '}{resourceName(id)}
                {formatInt(perHour(n))}{/each}
            </p>
          {/if}
        </dd>
      </div>
      {#if info.nextLevel !== null && (next.length > 0 || Object.keys(info.perTick).length > 0)}
        <div>
          <dt>{t('village.next')}</dt>
          <dd>
            {#each next as line (line)}<p>{line}</p>{/each}
            {#if next.length === 0 && Object.keys(info.perTick).length > 0}
              <p data-produces-next>
                {t('village.produces')}
                {#each Object.keys(info.perTick) as id, i (id)}{i > 0 ? ', ' : ' '}{resourceName(
                    id,
                  )}
                  {formatInt(perHour(nextPerTick))}{/each}
              </p>
            {/if}
          </dd>
        </div>
      {:else if info.nextLevel === null}
        <p class="ct-muted" data-max>{t('village.max')}</p>
      {/if}
    </dl>
  {/if}

  {#if info.unlocks.length > 0}
    <div class="unlocks" data-unlocks>
      <p class="label">{t('village.unlocks')}</p>
      <ul>
        {#each unlockLevels as level (level)}
          <li data-unlock-level={level} class:open={info.level >= level}>
            <span class="lv">{t('village.unlock.level', { n: level })}</span>
            {#each info.unlocks.filter((u) => u.level === level) as u (u.ref + (u.tier ?? ''))}
              <span class="chip">
                {#if u.kind === 'gear'}
                  <EntityLink kind="gear" id={u.ref} />
                  <span class="ct-muted">{t('village.unlock.tier', { tier: u.tier ?? '' })}</span>
                {:else}
                  <EntityLink kind="item" id={u.ref} />
                {/if}
              </span>
            {/each}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if info.nextLevel !== null && info.cost}
    <div class="cost" data-cost>
      <p class="label">{t('village.cost')}</p>
      <ul>
        {#each costs as need (need.kind + (need.id ?? ''))}
          <li class:short={!need.met} data-need={need.kind}>
            <span
              >{need.kind === 'treasury'
                ? t('village.cost.treasury')
                : resourceName(need.id ?? '')}</span
            >
            <span class="num">{formatInt(need.current)} / {formatInt(need.target)}</span>
          </li>
        {/each}
      </ul>
      <p class="ct-muted">
        {t('village.cost.time', { n: game.content.balance.K.buildTicks[info.nextLevel - 1] ?? 1 })}
      </p>
    </div>
    <button
      type="button"
      class="ct-button"
      data-build={info.id}
      disabled={!info.build.ok}
      aria-describedby={why ? `why-${info.id}` : undefined}
      onclick={build}
    >
      {t('village.build')}
    </button>
    {#if why}
      <div class="why">
        <p class="ct-why" id="why-{info.id}" data-why={why.reason}>{why.text}</p>
        {#if why.shinobi}
          {#if missions.length > 0}
            <ul class="missions">
              {#each missions as id (id)}
                <li><EntityLink kind="mission" {id} /></li>
              {/each}
            </ul>
          {:else}
            <p class="ct-muted">{t('village.why.noMissions')}</p>
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .card.focused {
    border-color: var(--accent);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  h3 {
    flex: 1 1 var(--panel-min);
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .level,
  .busy {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .busy {
    color: var(--accent);
  }

  .facts {
    display: grid;
    gap: var(--space-2);
    margin: 0;
  }

  dt,
  .label {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  dd {
    margin: 0;
  }

  dd p {
    margin: 0;
  }

  .unlocks ul,
  .cost ul,
  .missions {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .unlocks li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--space-3);
    color: var(--fg-dim);
  }

  .unlocks li.open {
    color: var(--fg);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .cost li {
    --_max-width: 20rem;
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    max-width: var(--_max-width);
  }

  .cost li.short .num {
    color: var(--danger);
    font-weight: 700;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .ct-button {
    align-self: flex-start;
  }

  .why {
    font-size: var(--text-xs);
  }
</style>
