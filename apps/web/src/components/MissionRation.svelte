<script lang="ts">
  import { formatBonus, formatInt } from '../lib/format.ts';
  import { rationItems } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  /** Every ration of the content with what the player holds of it and whether it is armed. */
  const rations = $derived(
    game.read((gs) => rationItems(gs, game.content).map((r) => ({ ...r, armed: r.charges >= 1 }))),
  );

  function arm(id: string): void {
    const result = game.dispatch({ type: 'item.use', id });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }
</script>

{#if rations.length > 0}
  <section class="ration" data-ration aria-label={t('mission.ration.title')}>
    <h2>{t('mission.ration.title')}</h2>
    {#each rations as r (r.id)}
      <div class="row" data-ration-item={r.id} data-armed={r.armed}>
        <Icon entity={{ kind: 'item', id: r.id }} size={18} />
        <span class="what">
          <EntityLink kind="item" id={r.id} />
          <span class="dim">
            {t('mission.ration.effect', {
              pct: formatBonus(1 + r.duration),
              n: r.missions,
            })}
          </span>
        </span>
        {#if r.armed}
          <span class="state" data-ration-armed>{t('mission.ration.armed')}</span>
        {:else}
          <span class="dim" data-ration-have
            >{t('mission.ration.have', { n: formatInt(r.have) })}</span
          >
          <button
            type="button"
            class="ct-button"
            data-ration-arm
            disabled={r.have < 1}
            aria-describedby={r.have < 1 ? `why-ration-${r.id}` : undefined}
            onclick={() => arm(r.id)}
          >
            {t('mission.ration.arm')}
          </button>
        {/if}
      </div>
      {#if !r.armed && r.have < 1}
        <p class="ct-why" id="why-ration-{r.id}" data-why="error.noItem">{t('error.noItem')}</p>
      {/if}
    {/each}
    <p class="ct-note" data-consumed-note>{t('mission.consumed.note')}</p>
  </section>
{/if}

<style>
  .ration {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .row[data-armed='true'] {
    border-color: var(--accent);
  }

  .what {
    display: flex;
    flex: 1 1 var(--panel-min);
    flex-direction: column;
    min-width: 0;
  }

  .dim {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .state {
    color: var(--accent);
    font-weight: 600;
  }

  p {
    margin: 0;
  }
</style>
