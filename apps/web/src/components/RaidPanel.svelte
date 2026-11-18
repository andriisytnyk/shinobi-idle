<script lang="ts">
  import { villageRaids, type RaidInfo } from '@shinobi/core';
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import { currencyName, moneyOf, resourceName } from '../lib/vocab.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    /** A compact notice for another page: the state of the raid and the way to the fight, without the defence and the outcome. */
    compact?: boolean;
    /** During the raid fight: only the time left and the packs repelled, for the fight page. */
    progress?: boolean;
  }

  let { compact = false, progress = false }: Props = $props();

  const content = game.content;
  const raids = $derived(game.read((gs) => villageRaids(gs, content)));
  /** The raid fights now going on, by raid id. */
  const fighting = $derived(
    game.read((gs) => gs.slots.flatMap((s) => (s.action?.kind === 'fight' ? [s.action.id] : []))),
  );
  const moneyLabel = currencyName(moneyOf(content));
  const tickMs = content.balance.K.tickMin * 60_000;

  const name = (raid: RaidInfo): string => t(`raid.${raid.id}.name`);
  const percent = (share: number): number => Math.round(share * 100);

  function defend(raid: RaidInfo): void {
    const result = game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: raid.id });
    if (!result.ok) {
      toasts.push({ key: result.reason, params: refusalParams(result) });
      return;
    }
    location.hash = '#/combat';
  }
</script>

{#each raids as raid (raid.id)}
  {#if progress ? raid.phase === 'active' && fighting.includes(raid.id) : !compact || raid.phase !== 'over'}
    <section class="panel raid" data-raid={raid.id} data-phase={raid.phase} data-ui="raid-panel">
      <h2><Icon name="lucide:swords" size={18} /> {name(raid)}</h2>

      {#if raid.phase === 'warned'}
        <p data-raid-state="warned">
          {t('village.raid.warned', { raid: name(raid), time: formatDuration(raid.msLeft) })}
        </p>
        {#if !compact}<p class="ct-muted">{t('village.raid.warned.hint')}</p>{/if}
      {:else if raid.phase === 'active'}
        {#if raid.waiting}
          <p data-raid-state="waiting">{t('village.raid.active.waiting', { raid: name(raid) })}</p>
        {:else}
          <p data-raid-state="active">
            {t('village.raid.active', { raid: name(raid), time: formatDuration(raid.msLeft) })}
          </p>
          {#if !compact}<p class="ct-muted">{t('village.raid.active.hint')}</p>{/if}
        {/if}
        <p class="progress" data-raid-packs>
          {t('village.raid.packs', { done: raid.repelled, total: raid.packs })}
        </p>
        {#if !progress}
          <div class="actions">
            {#if fighting.includes(raid.id)}
              <span class="ct-muted" data-raid-fighting>{t('village.raid.fighting')}</span>
              <a class="ct-button" href="#/combat" data-raid-fight>{t('village.raid.toFight')}</a>
            {:else}
              <button type="button" class="ct-button" data-raid-defend onclick={() => defend(raid)}>
                {t('village.raid.defend')}
              </button>
            {/if}
            <a class="prepare" href="#/combat/prepare/zone/{raid.id}" data-raid-prepare
              >{t('village.raid.prepare')}</a
            >
          </div>
        {/if}
      {:else}
        <p data-raid-state="over"><strong>{t('village.raid.over')}</strong></p>
        <ul class="outcome" data-raid-outcome>
          <li data-raid-repelled>{t('village.raid.over.repelled', { n: raid.repelled })}</li>
          <li data-raid-by-village>{t('village.raid.over.byVillage', { n: raid.byVillage })}</li>
          <li data-raid-breached>{t('village.raid.over.breached', { n: raid.breached })}</li>
          <li data-raid-paid>
            {t('village.raid.over.paid', {
              ryo: formatInt(raid.paid.ryo),
              currency: moneyLabel,
              rep: formatInt(raid.paid.rep),
            })}
          </li>
        </ul>
        {#if raid.damaged.length > 0}
          <p class="ct-muted">{t('village.raid.over.damaged')}</p>
          <ul class="outcome" data-raid-damaged>
            {#each raid.damaged as id (id)}
              <li>
                <EntityLink kind="building" {id} />
                <span class="ct-muted" data-raid-repair={id in raid.repairMs ? 'going' : 'done'}>
                  {#if raid.repairMs[id]}
                    {t('village.raid.over.repairing', {
                      time: formatDuration(raid.repairMs[id] ?? 0),
                    })}
                  {:else}
                    {t('village.raid.over.repaired')}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="ct-muted" data-raid-clean>{t('village.raid.over.clean')}</p>
        {/if}
      {/if}

      {#if !compact && raid.phase !== 'over'}
        <p data-raid-attackers>
          {t('village.raid.attackers')}
          <EntityLink kind="enemy" id={raid.enemy} />
        </p>
        <h3>{t('village.raid.defence')}</h3>
        <ul class="parts" data-raid-defence>
          {#each raid.defence.parts as part (part.t + part.id)}
            <li data-raid-part={part.id}>
              <span class="name">
                {#if part.t === 'building'}
                  <EntityLink kind="building" id={part.id} />
                {:else}
                  {resourceName(part.id)}
                {/if}
              </span>
              <span class="num">
                {part.t === 'building'
                  ? t('village.raid.part.level', { have: formatInt(part.have) })
                  : formatInt(part.have)}
              </span>
              <span class="ct-muted"
                >{t('village.raid.part.points', { points: formatInt(part.points) })}</span
              >
            </li>
          {/each}
        </ul>
        <p data-raid-stops>
          {#if raid.defence.stops > 0}
            {t('village.raid.defence.points', {
              points: formatInt(raid.defence.points),
              perPack: formatInt(raid.defence.perPack),
              stops: Math.min(raid.defence.stops, raid.left),
              total: raid.left,
            })}
          {:else if raid.defence.points > 0}
            {t('village.raid.defence.short', {
              points: formatInt(raid.defence.points),
              perPack: formatInt(raid.defence.perPack),
            })}
          {:else}
            {t('village.raid.defence.none')}
          {/if}
        </p>
        <p class="ct-muted">
          {t('village.raid.reward', {
            ryo: formatInt(raid.reward.ryo),
            currency: moneyLabel,
            rep: formatInt(raid.reward.rep),
            share: percent(raid.autoShare),
          })}
        </p>
        <p class="ct-muted" data-raid-damage>
          {t('village.raid.damage', { time: formatDuration(raid.repair * tickMs) })}
          {#each raid.targets as id, i (id)}{i === 0 ? ' ' : ', '}<EntityLink
              kind="building"
              {id}
            />{/each}.
        </p>
      {/if}
    </section>
  {/if}
{/each}

<style>
  .panel {
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .raid[data-phase='active'] {
    border-color: var(--danger);
  }

  h2,
  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-weight: 400;
  }

  h2 {
    font-size: var(--text-md);
  }

  h3 {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
  }

  p {
    margin: 0 0 var(--space-1);
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .parts,
  .outcome {
    margin: 0 0 var(--space-1);
    padding: 0;
    list-style: none;
  }

  .parts li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    min-height: var(--control-xs);
  }

  .parts .name {
    flex: 1 1 var(--panel-min);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .prepare {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-md);
  }
</style>
