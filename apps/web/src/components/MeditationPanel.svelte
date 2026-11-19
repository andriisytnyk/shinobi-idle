<script lang="ts">
  import { localeKey } from '@shinobi/content';
  import { listMeditationMods, type MeditationModInfo } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { entityAttr } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import NatureLink from './NatureLink.svelte';
  import Icon from './Icon.svelte';
  import PinGoal from './PinGoal.svelte';

  const content = game.content;

  const practices = $derived([...content.practices].sort((a, b) => a.level - b.level));

  function buy(practice: string, ref: string): void {
    const result = game.dispatch({ type: 'meditation.buy', practice, mod: ref });
    if (!result.ok) toasts.push({ key: result.reason, params: refusalParams(result) });
  }

  /** Why the modifier does not work or cannot be bought, as a key; null when nothing is wrong. */
  const reason = (m: MeditationModInfo): string | null =>
    m.lockedNature !== null ? 'meditation.natureLocked' : null;
</script>

<section class="meditation" data-meditation aria-label={t('meditation.title')}>
  <h2>{t('meditation.title')}</h2>
  <ul class="practices">
    {#each practices as practice (practice.id)}
      {@const entry = game.state.meditation[practice.id]}
      {@const ref = { kind: 'practice', id: practice.id }}
      <li class="practice" data-practice={practice.id} data-entity={entityAttr(ref)}>
        <h3>
          <EntityLink kind="practice" id={practice.id} />
          <span class="pin-end"><PinGoal kind="practice" id={practice.id} /></span>
        </h3>
        <p class="counts">
          <span data-insight>{t('meditation.insight')}: {entry?.insight ?? 0}</span>
          <span data-enlight>{t('meditation.enlight')}: {entry?.enlight ?? 0}</span>
        </p>
        <ul class="mods">
          {#each listMeditationMods(game.state, practice.id, content) as m (m.ref)}
            {@const why = reason(m)}
            <li class="mod" class:active={m.active} class:closed={!m.unlocked} data-mod={m.ref}>
              <p class="text">
                <span class="kind">{t(`meditation.${m.kind}`)}</span>
                {t(localeKey('practice', practice.id, m.ref))}
              </p>
              <p class="meta">
                <span>{t('meditation.level', { n: m.levels, max: m.maxLevels })}</span>
                {#if m.nextCost !== null}
                  <span>{t('meditation.next', { n: m.nextCost })}</span>
                {:else}
                  <span>{t('meditation.maxed')}</span>
                {/if}
                <span class:unmet={!m.unlocked}>{t('meditation.gate', { n: m.unlockMastery })}</span
                >
              </p>
              {#if why}
                <p class="locked" data-locked>
                  <Icon name="lucide:lock" size={14} />
                  {t(why)}
                  {#if m.lockedNature}<NatureLink id={m.lockedNature} />{/if}
                </p>
              {:else if m.active}
                <p class="on"><Icon name="lucide:check" size={14} /> {t('meditation.active')}</p>
              {/if}
              <button type="button" disabled={!m.canBuy} onclick={() => buy(practice.id, m.ref)}>
                {t('meditation.buy')}
              </button>
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>
</section>

<style>
  .meditation {
    margin-top: var(--space-6);
  }

  h2 {
    margin: 0 0 var(--space-2);
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  h3 {
    display: flex;
    align-items: center;
    margin: 0;
    font-size: var(--text-sm);
  }

  .pin-end {
    margin-left: auto;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .practices {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .practice {
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  .counts {
    display: flex;
    gap: var(--space-4);
    margin: var(--space-1) 0 var(--space-3);
    font-variant-numeric: tabular-nums;
  }

  .mods {
    --_grid-template-columns: 15rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--_grid-template-columns), 1fr));
    gap: var(--space-2);
  }

  .mod {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
  }

  .mod.active {
    border-color: var(--success);
  }

  .mod.closed .text {
    color: var(--fg-dim);
  }

  .mod p {
    margin: 0;
  }

  .kind {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .unmet {
    color: var(--danger, var(--fg-dim));
  }

  .locked,
  .on {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
  }

  .locked {
    color: var(--fg-dim);
  }

  .on {
    color: var(--success);
  }

  button {
    min-height: var(--control-md);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    border-color: var(--line);
    background: var(--line);
    color: var(--fg-dim);
    cursor: not-allowed;
  }
</style>
