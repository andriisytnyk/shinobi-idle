<script lang="ts">
  import { formatDuration, formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { dispelPreview, performersOf } from '../lib/squad.ts';
  import { squadUi } from '../lib/squad-ui.svelte.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Modal from './Modal.svelte';

  const content = game.content;

  const performer = $derived(
    game.read((gs) => performersOf(gs, content).find((p) => p.id === squadUi.dispelling) ?? null),
  );
  const preview = $derived(
    performer ? game.read((gs) => dispelPreview(gs, content, performer)) : null,
  );

  function confirm(): void {
    const p = performer;
    const shown = preview;
    squadUi.closeDispel();
    if (!p) return;
    const result = game.dispatch({ type: 'clone.dispel', slot: p.slot });
    if (!result.ok) {
      toasts.push({ key: result.reason, params: refusalParams(result) });
      return;
    }
    const xp = shown?.held?.xp;
    toasts.push(
      xp
        ? { key: 'squad.notice.dispelledGain', params: { n: p.n, xp: formatInt(xp) } }
        : { key: 'squad.notice.dispelled', params: { n: p.n } },
    );
  }
</script>

{#if performer && preview}
  <Modal title={t('squad.dispel.title', { n: performer.n })} onClose={() => squadUi.closeDispel()}>
    <div data-ui="dispel-preview" data-performer={performer.n}>
      {#if preview.empty}
        <p data-dispel-empty>{t('squad.dispel.nothing')}</p>
      {/if}
      {#if preview.held?.xp !== undefined || preview.held?.mastery !== undefined}
        <section data-dispel-knowledge>
          <h3>{t('squad.dispel.knowledge')}</h3>
          <ul>
            {#if preview.held.xp !== undefined}
              <li>{t('squad.dispel.xp', { n: formatInt(preview.held.xp) })}</li>
            {/if}
            {#if preview.held.mastery !== undefined}
              <li>{t('squad.dispel.mastery', { n: formatInt(preview.held.mastery) })}</li>
            {/if}
          </ul>
        </section>
      {/if}
      {#if preview.bag.length > 0}
        <section data-dispel-bag>
          <h3>{t('squad.dispel.bag')}</h3>
          <ul>
            {#each preview.bag as item (item.id)}
              <li>{formatInt(item.n)} × <EntityLink kind="item" id={item.id} /></li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if preview.fatigue}
        <section data-dispel-fatigue>
          <h3>{t('squad.dispel.fatigue')}</h3>
          <p>
            {t('squad.dispel.fatigueValue', {
              time: formatDuration(preview.fatigue.durationMs),
              pct: Math.round(preview.fatigue.slowdown * 100),
            })}
          </p>
        </section>
      {/if}
    </div>
    {#snippet actions()}
      <button type="button" data-dispel-cancel onclick={() => squadUi.closeDispel()}>
        {t('squad.dispel.cancel')}
      </button>
      <button type="button" class="danger" data-dispel-confirm onclick={confirm}>
        {t('squad.dispel.confirm')}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  h3 {
    margin: var(--space-2) 0 var(--space-1);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: 400;
  }

  p,
  ul {
    margin: 0;
  }

  ul {
    padding-inline-start: var(--space-4);
  }
</style>
