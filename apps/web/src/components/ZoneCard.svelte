<script lang="ts">
  import { bingoView, targetOf } from '@shinobi/core';
  import { forecasts, forecastKeyOf } from '../lib/card-forecast.svelte.ts';
  import { entityName } from '../lib/entities.ts';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { entityAttr, idAttr, nameShown } from '../lib/reveal.ts';
  import { natureName } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import StartSplit from './StartSplit.svelte';

  interface Props {
    zone: {
      id: string;
      enemy: string;
      kind: 'enemy' | 'boss';
      available: boolean;
      cl: number;
      hp: number;
    };
    /** The zone's own label of the start button. */
    startLabel?: string;
    /** Opens the preparation (a sheet over the list); without it the button is a link to the preparation page. */
    onPrepare?: (zoneId: string) => void;
  }

  let { zone, startLabel = 'combat.zoneStart', onPrepare }: Props = $props();

  const content = game.content;
  const target = $derived({ kind: 'zone' as const, id: zone.id });

  const facts = $derived(
    game.read((gs) => {
      const view = bingoView(gs, zone.enemy, content);
      const level = view?.level ?? 0;
      return {
        level,
        nature: level >= 1 ? (targetOf(gs, zone.enemy, content)?.nature ?? null) : null,
        drops: view?.drops ?? null,
        key: zone.available ? forecastKeyOf(gs, target, content) : '',
      };
    }),
  );

  const forecast = $derived(facts.key === '' ? null : (forecasts.done[facts.key] ?? null));

  /** The forecast is asked for when the card comes into view (at once where there is no observer). */
  function lazy(node: HTMLElement): { destroy(): void } {
    const ask = () => forecasts.request(facts.key, target);
    if (typeof IntersectionObserver === 'undefined') {
      ask();
      return { destroy() {} };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        ask();
        // The key may change later (a new hand): the card asks again while it stays in view.
        visible = true;
      } else visible = false;
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  let visible = $state(false);
  $effect(() => {
    if (visible && facts.key !== '') forecasts.request(facts.key, target);
  });

  const xpLine = $derived(
    forecast
      ? Object.entries(forecast.xpPerHour)
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(
            ([skill, n]) =>
              `${entityName({ kind: 'skill', id: skill })} ${formatInt(Math.round(n))}`,
          )
          .join(', ')
      : '',
  );

  const prepareHref = $derived(`#/combat/prepare/zone/${zone.id}`);
  const ref = $derived({ kind: zone.kind, id: zone.enemy });
</script>

<li
  class="ct-tile card"
  class:locked={!zone.available}
  data-ui="zone-card"
  data-zone={zone.id}
  data-enemy={idAttr(zone.kind, zone.enemy)}
  data-entity={entityAttr(ref)}
  use:lazy
>
  <div class="ct-top">
    <span class="ct-icon emblem"><Icon entity={ref} size={32} /></span>
    <div class="ct-head">
      <h4 class="ct-name"><EntityLink kind={zone.kind} id={zone.enemy} /></h4>
    </div>
  </div>

  <p class="meta" data-card-meta>
    {#if nameShown(ref)}
      {t('combat.cardLevel', { n: zone.cl })} · {t('combat.hp', { n: formatInt(zone.hp) })}
      {#if facts.nature}· {natureName(facts.nature)}{/if}
    {:else}
      ???
    {/if}
  </p>

  {#if zone.available}
    <p
      class="line"
      data-card-verdict={forecast
        ? (forecast.verdict ?? 'none')
        : facts.key === ''
          ? 'unknown'
          : 'wait'}
    >
      <span class="dim">{t('combat.card.verdict')}</span>
      {#if facts.key === ''}
        {t('combat.card.unknown')}
      {:else if !forecast}
        {t('combat.card.counting')}
      {:else if forecast.verdict}
        <b class="v-{forecast.verdict}">{t(`prep.verdict.${forecast.verdict}`)}</b>
      {:else}
        {t('combat.card.unknown')}
      {/if}
    </p>
    <p class="line" data-card-rewards>
      <span class="dim">{t('combat.card.rewards')}</span>
      {#if forecast && (forecast.ryoPerHour !== null || xpLine)}
        {#if forecast.ryoPerHour !== null}{t('combat.card.ryoHour', {
            n: formatInt(Math.round(forecast.ryoPerHour)),
          })}{/if}{#if xpLine}{forecast.ryoPerHour !== null ? ' · ' : ''}{t('combat.card.xpHour', {
            what: xpLine,
          })}{/if}
      {:else}
        ???
      {/if}
    </p>
    <p class="line" data-card-loot>
      <span class="dim">{t('combat.card.loot')}</span>
      {#if facts.drops === null}
        ???
      {:else if facts.drops.length === 0}
        —
      {:else}
        {#each facts.drops as drop, i (drop.item)}{i > 0 ? ', ' : ''}<EntityLink
            kind="item"
            id={drop.item}
          />{#if drop.chance !== null}
            {Math.round(drop.chance * 100)}%{/if}{/each}
      {/if}
    </p>
  {:else}
    <p class="line why" id="why-zone-{zone.id}" data-card-locked>
      <Icon name="lucide:lock" size={14} />
      {t('combat.card.locked')}
    </p>
  {/if}
  <p class="line know" data-card-know>
    {t('combat.card.know', { n: facts.level })}
  </p>

  <div class="ct-actions buttons">
    {#if onPrepare}
      <button
        type="button"
        class="ct-action stop prepare"
        data-prepare
        onclick={() => onPrepare(zone.id)}>{t('combat.prepare')}</button
      >
    {:else}
      <a class="ct-action stop prepare" data-prepare href={prepareHref}>{t('combat.prepare')}</a>
    {/if}
    <StartSplit
      kind="fight"
      id={zone.id}
      label={startLabel}
      disabled={!zone.available}
      describedBy={zone.available ? undefined : `why-zone-${zone.id}`}
    />
  </div>
</li>

<style>
  .card {
    font-size: var(--text-xs);
  }

  .card.locked {
    opacity: 0.85;
  }

  .emblem {
    flex: none;
  }

  .meta,
  .line {
    margin: 0;
  }

  .meta,
  .dim,
  .know {
    color: var(--fg-dim);
  }

  .why {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--fg-dim);
  }

  .v-stable {
    color: var(--success);
  }

  .v-risky {
    color: var(--accent);
  }

  .v-hopeless {
    color: var(--danger);
  }

  .buttons {
    flex-wrap: wrap;
  }

  .prepare {
    display: inline-flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    box-sizing: border-box;
  }
</style>
