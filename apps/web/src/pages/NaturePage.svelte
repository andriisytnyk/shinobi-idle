<script lang="ts">
  import { content, NATURE_IDS, type NatureId } from '@shinobi/content';
  import { natureConsequences, natureSetSummary, natureStatus } from '@shinobi/core';
  import EntityLink from '../components/EntityLink.svelte';
  import Hint from '../components/Hint.svelte';
  import Modal from '../components/Modal.svelte';
  import NatureCard from '../components/NatureCard.svelte';
  import { entityName } from '../lib/entities.ts';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import SimplePage from './SimplePage.svelte';

  /** A choice waiting for the player's confirmation: a nature, or the paper's pick. */
  let pending = $state<NatureId | 'random' | null>(null);
  /** The nature just chosen, shown with its consequences for the team. */
  let result = $state<{ nature: NatureId; first: boolean } | null>(null);
  let error = $state<string | null>(null);

  const status = $derived(game.read((gs) => natureStatus(gs, content)));
  const owned = $derived(game.read((gs) => gs.player.natures));
  const team = $derived(game.read((gs) => gs.team));
  const first = $derived(status.stage === 'test');
  /** Which natures can be chosen right now. */
  const choosable = $derived(
    status.canChoose ? NATURE_IDS.filter((n) => !owned.includes(n)) : ([] as NatureId[]),
  );
  const ordinal = $derived(
    status.stage === 'third' ? 'nature.ordinal.third' : 'nature.ordinal.second',
  );
  const ordinalAcc = $derived(
    status.stage === 'third' ? 'nature.ordinal.thirdAcc' : 'nature.ordinal.secondAcc',
  );
  const summary = $derived(owned.length > 0 ? natureSetSummary(owned, content) : null);
  const cards = $derived(
    game.read((gs) =>
      NATURE_IDS.map((nature) => ({
        nature,
        cons: natureConsequences(nature, gs, content),
        together:
          owned.length > 0 && !owned.includes(nature)
            ? natureSetSummary([...owned, nature], content)
            : null,
      })),
    ),
  );

  const pendingName = $derived(
    pending && pending !== 'random' ? entityName({ kind: 'skill', id: pending }) : '',
  );
  const confirmText = $derived.by(() => {
    if (pending === null) return '';
    if (first) {
      return pending === 'random'
        ? t('nature.confirm.random')
        : t('nature.confirm.choose', { nature: pendingName });
    }
    return pending === 'random'
      ? t('nature.confirm.randomAdd')
      : t('nature.confirm.add', {
          nature: pendingName,
          ordinal: t(ordinalAcc).toLowerCase(),
        });
  });

  function confirm(): void {
    if (pending === null) return;
    const wasFirst = first;
    const outcome = game.dispatch({
      type: wasFirst ? 'nature.choose' : 'nature.add',
      nature: pending,
    });
    pending = null;
    if (!outcome.ok) {
      error = outcome.reason;
      return;
    }
    error = null;
    const nature = game.state.player.natures[game.state.player.natures.length - 1];
    if (nature) result = { nature, first: wasFirst };
  }
</script>

<SimplePage title={t('nature.title')}>
  <Hint id="nature" />

  <section class="lead" data-nature-stage={status.stage}>
    {#if status.stage === 'locked'}
      <p>{t('nature.locked')}</p>
    {:else if status.stage === 'test'}
      <p>{t('nature.lead.test')}</p>
    {:else if status.stage === 'full'}
      <p>{t('nature.lead.full')}</p>
    {:else if status.canChoose}
      <p>{t('nature.lead.add', { cc: status.cc, ordinal: t(ordinalAcc) })}</p>
    {:else}
      <p>
        {t('nature.lead.wait', { ordinal: t(ordinal), need: status.needCc ?? 0, cc: status.cc })}
      </p>
    {/if}
    {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
    {#if choosable.length > 0}
      <button type="button" class="random" data-random onclick={() => (pending = 'random')}>
        {t('nature.random')}
      </button>
    {/if}
  </section>

  {#if owned.length > 0}
    <section class="yours" data-yours>
      <h2>{t('nature.yours')}</h2>
      <ul class="owned">
        {#each owned as nature, i (nature)}
          <li data-owned-nature={nature}>
            <EntityLink kind="skill" id={nature} />
            <span class="tag">{t(i === 0 ? 'nature.native' : 'nature.extra')}</span>
          </li>
        {/each}
      </ul>
      {#if team}
        <p class="team" data-team>
          {t('nature.team.rival')}: <EntityLink kind="skill" id={team.rival} /> ·
          {t('nature.team.aya')}: <EntityLink kind="skill" id={team.aya} />
        </p>
      {/if}
      {#if summary}
        <div class="summary" data-summary>
          <h3>{t('nature.summary.title')}</h3>
          <ul>
            <li>
              {t('nature.summary.missions', {
                n: summary.missions.ids.length,
                total: summary.missions.total,
              })}
            </li>
            <li>
              {t('nature.summary.buildings', {
                n: summary.buildings.ids.length,
                total: summary.buildings.total,
              })}
            </li>
            <li>
              {t('nature.summary.cells', {
                n: summary.cells.ids.length,
                total: summary.cells.total,
              })}
            </li>
          </ul>
          <p class="note">{t('nature.summary.note')}</p>
        </div>
      {/if}
    </section>
  {/if}

  <ul class="cards" data-cards>
    {#each cards as card (card.nature)}
      <NatureCard
        nature={card.nature}
        cons={card.cons}
        together={card.together}
        action={choosable.includes(card.nature) ? (first ? 'choose' : 'add') : null}
        onPick={(nature) => (pending = nature)}
      />
    {/each}
  </ul>
</SimplePage>

{#if pending !== null}
  <Modal title={t('nature.confirm.title')} onClose={() => (pending = null)}>
    <p data-confirm>{confirmText}</p>
    {#snippet actions()}
      <button type="button" onclick={() => (pending = null)}>{t('nature.back')}</button>
      <button type="button" class="primary" data-confirm-yes onclick={confirm}>
        {t('nature.confirm.yes')}
      </button>
    {/snippet}
  </Modal>
{/if}

{#if result}
  {@const done = result}
  <Modal
    title={t(done.first ? 'nature.result.title' : 'nature.result.added')}
    onClose={() => (result = null)}
  >
    <div data-result={done.nature}>
      <p class="chosen"><EntityLink kind="skill" id={done.nature} /></p>
      <p>{t(`nature.character.${done.nature}`)}</p>
      <p>{t('nature.result.skill')} <EntityLink kind="skill" id={done.nature} /></p>
      {#if done.first && team}
        <h3>{t('nature.result.team')}</h3>
        <ul>
          <li>
            {t('nature.result.rival')}
            <EntityLink kind="skill" id={team.rival} />
          </li>
          <li>{t('nature.result.aya')} <EntityLink kind="skill" id={team.aya} /></li>
        </ul>
      {/if}
    </div>
    {#snippet actions()}
      <button type="button" class="primary" data-result-ok onclick={() => (result = null)}>
        {t('nature.result.ok')}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .lead p {
    margin: 0 0 var(--space-3);
  }

  .error {
    color: var(--danger);
  }

  .random,
  .primary {
    min-height: var(--control-size);
    padding: var(--space-1) var(--space-4);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  h2,
  h3 {
    margin: var(--space-3) 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-weight: 400;
  }

  h2 {
    font-size: var(--font-size-1-1);
  }

  h3 {
    font-size: var(--font-size-1);
  }

  .yours {
    margin: var(--space-4) 0;
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .owned {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .owned :global(a),
  .team :global(a),
  [data-result] :global(a) {
    color: var(--accent);
    font-weight: 600;
  }

  .tag {
    margin-left: var(--space-1);
    color: var(--fg-dim);
    font-size: var(--font-size-0-85);
  }

  .team {
    margin: var(--space-2) 0;
  }

  .summary ul {
    margin: 0;
    padding-left: var(--space-4);
  }

  .note {
    margin: var(--space-2) 0 0;
    color: var(--fg-dim);
    font-size: var(--font-size-0-85);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--size-19)), 1fr));
    gap: var(--space-3);
    margin: var(--space-4) 0 0;
    padding: 0;
  }

  .chosen {
    font-family: var(--font-heading);
    font-size: var(--font-size-1-3);
  }

  [data-result] p,
  [data-result] ul {
    margin: 0 0 var(--space-2);
  }
</style>
