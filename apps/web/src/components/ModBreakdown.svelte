<script lang="ts">
  import { content } from '@shinobi/content';
  import { MODIFIER_KEYS } from '@shinobi/content';
  import { getMod, type Modifier } from '@shinobi/core';
  import { isEntityKind } from '../lib/entities.ts';
  import { formatBonus } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import EntityLink from './EntityLink.svelte';

  interface Props {
    /** Modifier keys that feed the figure, e.g. `xp.all` and `xp.skill.tai`. */
    keys: string[];
    /** The figure as shown; clicking it opens the list of its parts. */
    display: string;
    /** What the figure is before any bonus, as text. */
    base?: string;
  }

  let { keys, display, base }: Props = $props();

  let open = $state(false);

  const parts = $derived.by((): Modifier[] =>
    game.read((gs) => keys.flatMap((key) => getMod(gs, key, content, game.rules).parts)),
  );
  const total = $derived(
    game.read((gs) =>
      keys.reduce((acc, key) => acc * getMod(gs, key, content, game.rules).total, 1),
    ),
  );

  /** A flat key counts units (`+5`); the others are shares (`+5%`) or factors. */
  const valueText = (m: Modifier) =>
    m.op === 'mul'
      ? `×${m.value}`
      : MODIFIER_KEYS[m.key]?.flat
        ? `${m.value < 0 ? '−' : '+'}${Math.abs(m.value)}`
        : formatBonus(1 + m.value);
  const sourceKey = (m: Modifier) => (typeof m.source === 'string' ? m.source : null);
</script>

<span class="mod">
  <button type="button" class="figure" aria-expanded={open} onclick={() => (open = !open)}>
    {display}
  </button>
  {#if open}
    <span class="list" role="group" aria-label={t('mod.title')}>
      {#if base !== undefined}
        <span class="line"><span>{t('mod.base')}</span><span>{base}</span></span>
      {/if}
      {#each parts as part, i (i)}
        <span class="line">
          <span class="source">
            {#if typeof part.source !== 'string' && isEntityKind(part.source.kind)}
              <EntityLink kind={part.source.kind} id={part.source.id} />
            {:else}
              {@const key = sourceKey(part)}
              {key !== null && hasKey(key) ? t(key) : key}
            {/if}
          </span>
          <span>{valueText(part)}</span>
        </span>
      {:else}
        <span class="line none">{t('mod.none')}</span>
      {/each}
      {#if parts.length > 0}
        <span class="line total"
          ><span>{t('mod.total')}</span><span
            >{keys.every((k) => MODIFIER_KEYS[k]?.flat)
              ? `+${Math.round((total - 1) * 100) / 100}`
              : formatBonus(total)}</span
          ></span
        >
      {/if}
    </span>
  {/if}
</span>

<style>
  .mod {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .figure {
    padding: 0;
    border: 0;
    border-bottom: 1px dotted var(--fg-dim);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .figure:hover,
  .figure[aria-expanded='true'] {
    border-bottom-color: var(--accent);
    color: var(--accent);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: var(--size-12);
    margin-top: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: var(--font-size-0-85);
  }

  .line {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .none {
    color: var(--fg-dim);
  }

  .total {
    padding-top: var(--space-1);
    border-top: 1px solid var(--line);
    font-weight: 600;
  }

  /* Whole-tap targets of at least 44 px on a phone. */
  @media (max-width: 768px) {
    .figure {
      display: inline-flex;
      align-items: center;
      min-width: var(--control-size);
      min-height: var(--control-size);
    }
  }
</style>
