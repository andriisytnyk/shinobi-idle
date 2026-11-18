<script lang="ts">
  import {
    villageBuildings,
    villageQueue,
    villageResources,
    villageStage,
    villageTreasury,
  } from '@shinobi/core';
  import BuildingCard from '../components/BuildingCard.svelte';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Slot from '../lib/ext/Slot.svelte';
  import Icon from '../components/Icon.svelte';
  import RaidPanel from '../components/RaidPanel.svelte';
  import Stepper from '../components/Stepper.svelte';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { currencyName, held, moneyOf } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import { perHour, resourceIcon, resourceName, ROLE_ORDER } from '../lib/village.ts';
  import SimplePage from './SimplePage.svelte';

  const content = game.content;

  interface Props {
    /** The building the route asked for; its card is scrolled into view. */
    focus?: string | null;
  }

  let { focus = null }: Props = $props();

  const has = $derived(game.read((gs) => gs.village !== null));
  const buildings = $derived(game.read((gs) => villageBuildings(gs, content)));
  const resources = $derived(game.read((gs) => villageResources(gs, content)));
  const treasury = $derived(game.read((gs) => villageTreasury(gs, content)));
  const queue = $derived(game.read((gs) => villageQueue(gs, content)));
  const stage = $derived(game.read((gs) => villageStage(gs, content)));
  const workforce = $derived(game.read((gs) => gs.village?.workforce ?? 0));
  const moneyLabel = currencyName(moneyOf(content));
  const ryo = $derived(game.read((gs) => held(gs, moneyOf(content))));

  const civil = $derived(resources.filter((r) => r.kind === 'civil'));
  const shinobi = $derived(resources.filter((r) => r.kind === 'shinobi'));
  const power = $derived(resources.find((r) => r.kind === 'power'));
  const groups = $derived(
    ROLE_ORDER.map((role) => ({ role, list: buildings.filter((b) => b.role === role) })).filter(
      (g) => g.list.length > 0,
    ),
  );
  const nextCap = $derived(content.balance.K.towerStageMax[1] ?? 0);

  let donation = $state(1);
  const donateInvalid = $derived(donation < 1);
  const donateTooMany = $derived(!donateInvalid && donation > ryo);
  const donateOff = $derived(donateInvalid || donateTooMany);

  function donate(): void {
    if (donateOff) return;
    const result = game.dispatch({ type: 'village.donate', ryo: donation });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }

  function cancel(): void {
    const result = game.dispatch({ type: 'village.cancel' });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }

  function useWorkforce(): void {
    const result = game.dispatch({ type: 'village.workforce' });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }

  // The card the route points at comes into view.
  $effect(() => {
    if (!focus || !has) return;
    document.getElementById(`building-${focus}`)?.scrollIntoView?.({ block: 'start' });
  });
</script>

<SimplePage title={t('village.title')}>
  <div class="village" data-village>
    <Hint id="village" />
    <Slot name="village.header" />
    {#if !has}
      <p class="ct-why" data-village-locked>{t('village.locked')}</p>
    {:else}
      <RaidPanel />

      <section class="panel" data-stage={stage.stage}>
        <h2>{t('village.stage', { n: stage.stage })}</h2>
        <p>{t('village.stage.cap', { n: stage.levelCap })}</p>
        {#if !stage.reached}
          <p class="ct-muted">{t('village.stage.next', { n: nextCap })}</p>
          <ul class="req" data-stage-req>
            <li class:met={stage.rep >= stage.repNeeded}>
              <Icon name="lucide:minus" size={14} />
              <a href="#/missions">{t('village.rep')}</a>
              <span class="num">{formatInt(stage.rep)} / {formatInt(stage.repNeeded)}</span>
            </li>
          </ul>
          <p class="ct-muted">{t('village.rep.source')}</p>
        {:else}
          <p class="ct-muted">{t('village.stage.reached')}</p>
        {/if}
      </section>

      <section class="panel" data-treasury>
        <h2><Icon name="lucide:coins" size={18} /> {t('village.treasury')}</h2>
        <p class="big" data-treasury-amount>{formatInt(treasury.amount)}</p>
        <p class="ct-muted">
          {t('village.treasury.income', {
            n: formatInt(perHour(treasury.perTick)),
            currency: moneyLabel,
          })}
        </p>
        <div class="donate">
          <Stepper
            bind:value={donation}
            max={ryo}
            label={t('village.donate.label', { currency: moneyLabel })}
            onSubmit={donate}
          />
          <button
            type="button"
            class="ct-button"
            data-donate
            disabled={donateOff}
            aria-describedby={donateOff ? 'why-donate' : undefined}
            onclick={donate}
          >
            {t('village.donate')}
          </button>
        </div>
        {#if donateInvalid}
          <p class="ct-why" id="why-donate" data-why="qty">{t('village.donate.invalid')}</p>
        {:else if donateTooMany}
          <p class="ct-why" id="why-donate" data-why="money">
            {t('village.donate.tooMany', { n: formatInt(ryo), currency: moneyLabel })}
          </p>
        {/if}
      </section>

      <section class="panel" data-resources>
        <h2>{t('village.resources')}</h2>
        <ul class="stocks">
          {#each civil as r (r.id)}
            <li data-resource={r.id}>
              <Icon name={resourceIcon(r.id)} size={18} />
              <span class="name">{resourceName(r.id)}</span>
              <span class="num" data-stock
                >{t('village.stock', {
                  have: formatInt(r.amount),
                  cap: formatInt(r.cap ?? 0),
                })}</span
              >
              <span class="ct-muted"
                >{t('village.perHour', { n: formatInt(perHour(r.perTick)) })}</span
              >
            </li>
          {/each}
        </ul>
      </section>

      <section class="panel" data-shinobi>
        <h2>{t('village.shinobi')}</h2>
        <p class="ct-muted">{t('village.shinobi.note')}</p>
        <ul class="stocks">
          {#each shinobi as r (r.id)}
            <li data-resource={r.id}>
              <Icon name={resourceIcon(r.id)} size={18} />
              <span class="name">{resourceName(r.id)}</span>
              <span class="num" data-stock
                >{t('village.stock', {
                  have: formatInt(r.amount),
                  cap: formatInt(r.cap ?? 0),
                })}</span
              >
            </li>
          {/each}
          <li data-resource="robocha_syla">
            <Icon name={resourceIcon('robocha_syla')} size={18} />
            <span class="name">{resourceName('robocha_syla')}</span>
            <span class="num" data-stock>{formatInt(workforce)}</span>
          </li>
          {#if power}
            <li data-resource={power.id}>
              <Icon name="lucide:users" size={18} />
              <span class="name">{resourceName(power.id)}</span>
              <span class="num" data-stock>{formatInt(power.amount)}</span>
              <span class="ct-muted"
                >{t('village.power.income', {
                  n: formatInt(perHour(power.amount)),
                  currency: moneyLabel,
                })}</span
              >
            </li>
          {/if}
        </ul>
      </section>

      <section class="panel" data-queue>
        <h2><Icon name="lucide:hourglass" size={18} /> {t('village.queue')}</h2>
        {#if queue}
          <p data-queue-job>
            {t('village.queue.job', { n: queue.level })}
            <EntityLink kind="building" id={queue.building} />
          </p>
          <p class="ct-muted" data-queue-left>
            {t('village.queue.left', {
              time: formatDuration(queue.msLeft),
              ticks: queue.ticksLeft,
              total: queue.ticksTotal,
            })}
          </p>
          <div class="actions">
            <button type="button" class="ct-button" data-cancel onclick={cancel}>
              {t('village.cancel')}
            </button>
            {#if workforce > 0}
              <button type="button" class="ct-button" data-use-workforce onclick={useWorkforce}>
                {t('village.workforce.use', { n: workforce })}
              </button>
            {/if}
          </div>
        {:else}
          <p class="ct-muted" data-queue-empty>{t('village.queue.empty')}</p>
        {/if}
      </section>

      {#each groups as group (group.role)}
        <section class="ct-section" data-role={group.role}>
          <h2>{t(`village.role.${group.role}`)}</h2>
          <div class="cards">
            {#each group.list as info (info.id)}
              <BuildingCard {info} focused={focus === info.id} />
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</SimplePage>

<style>
  .village {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel {
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .panel h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .panel p {
    margin: 0 0 var(--space-1);
  }

  .big {
    font-size: var(--text-xl);
    font-variant-numeric: tabular-nums;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .req,
  .stocks {
    margin: 0 0 var(--space-1);
    padding: 0;
    list-style: none;
  }

  .req li,
  .stocks li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    min-height: var(--control-xs);
  }

  .req li.met .num {
    color: var(--accent);
  }

  .req li a {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-md);
  }

  .stocks .name {
    flex: 1 1 var(--panel-min);
  }

  .donate,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .cards {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: 1fr;
  }

  @media (min-width: 1100px) {
    .cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
