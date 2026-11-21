<script lang="ts">
  import { answersTrait, bingoView, BINGO_MAX, isPassive, type BingoView } from '@shinobi/core';
  import Slot from '../lib/ext/Slot.svelte';
  import { formatInt } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { entityAttr, idAttr, nameShown } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';
  import { currencyName, currencyOf, held } from '../lib/vocab.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';

  const content = game.content;
  const study = currencyOf(content, 'study') ?? '';

  interface Entry {
    kind: 'enemy' | 'boss';
    view: BingoView;
    /** Known techniques that answer each trait of the view, by trait. */
    answers: Record<string, string[]>;
  }

  /** The entries the book shows: enemies and bosses whose name the player may read; the others are only counted. */
  const book = $derived(
    game.read((gs) => {
      const all = [
        ...content.enemies.map((e) => ({ kind: 'enemy' as const, id: e.id })),
        ...content.bosses.map((b) => ({ kind: 'boss' as const, id: b.id })),
      ];
      const mine = content.techniques.filter(
        (tech) => gs.known[tech.id] === true && !isPassive(tech),
      );
      const entries: Entry[] = [];
      let unknown = 0;
      for (const ref of all) {
        const view = bingoView(gs, ref.id, content);
        if (!view) continue;
        // An entry is in the book once it is met; a name the map has shown also gets a page, to study it.
        if (view.level < 1 && !nameShown(ref)) {
          unknown++;
          continue;
        }
        const answers: Record<string, string[]> = {};
        for (const trait of [...view.traits, ...(view.hiddenTraits ?? [])]) {
          answers[trait] = mine
            .filter((tech) => answersTrait(tech, trait, content))
            .map((x) => x.id);
        }
        entries.push({ kind: ref.kind, view, answers });
      }
      return { entries, unknown, intel: held(gs, study) };
    }),
  );

  let message = $state<string | null>(null);
  function learn(enemy: string): void {
    const r = game.dispatch({ type: 'bingo.study', enemy });
    message = r.ok ? null : (r.reason ?? 'error.unknown');
  }

  const levels = [1, 2, 3] as const;
</script>

<section class="book" data-bingo>
  <p class="intro">{t('bingo.intro')}</p>

  <ol class="legend" aria-label={t('bingo.levels')}>
    {#each levels as n (n)}
      <li><strong>{t('bingo.level', { n })}.</strong> {t(`bingo.levelDesc.${n}`)}</li>
    {/each}
  </ol>
  <p class="balance">
    <Icon entity={{ kind: 'currency', id: study }} size={16} />
    {currencyName(study)}: <span data-study-balance>{formatInt(book.intel)}</span>
  </p>
  {#if message}<p class="message" role="status">{t(message)}</p>{/if}

  {#if book.entries.length === 0}
    <p class="empty">{t('bingo.empty')}</p>
  {/if}

  <ul class="entries">
    {#each book.entries as { kind, view, answers } (view.id)}
      <li
        class="entry"
        data-ui="bingo-entry"
        data-entity={entityAttr({ kind, id: view.id })}
        data-level={view.level}
      >
        <header class="head">
          <Icon entity={{ kind, id: view.id }} size={28} />
          <div class="who">
            <h3><EntityLink {kind} id={view.id} /></h3>
            <span class="level" data-level-tag
              >{t('bingo.level', { n: view.level })} / {BINGO_MAX}</span
            >
          </div>
        </header>
        <p class="stats">
          {t('bingo.stats', { seen: view.seen, wins: view.wins, losses: view.losses })}
          {#if view.winsToStudied > 0 && view.level >= 1}
            · {t('bingo.toStudied', { n: view.winsToStudied })}
          {/if}
        </p>

        {#if view.level < 1}
          <p class="note">{t('bingo.notMet')}</p>
        {/if}

        {#if view.level >= 1}
          <h4>{t('bingo.traits')}</h4>
          {#if view.traits.length === 0 && (view.hiddenTraits ?? []).length === 0}
            <p class="note">{t('bingo.noTraits')}</p>
          {/if}
          <ul class="traits">
            {#each [...view.traits, ...(view.hiddenTraits ?? [])] as trait (trait)}
              <li data-trait>
                <EntityLink kind="trait" id={trait} />
                <span class="answer">
                  {#if (answers[trait] ?? []).length === 0}{t('bingo.noAnswer')}{:else}{t(
                      'bingo.answers',
                    )}
                    {#each answers[trait] ?? [] as id, i (id)}{#if i > 0},
                      {/if}<EntityLink kind="technique" {id} />{/each}{/if}
                </span>
              </li>
            {/each}
          </ul>
          {#if view.hiddenTraits === null}<p class="note">{t('bingo.moreTraits')}</p>{/if}
        {/if}

        {#if view.carries}
          <p class="line">{t('bingo.carries')} <EntityLink kind="technique" id={view.carries} /></p>
        {/if}
        {#if view.drops}
          <h4>{t('bingo.drops')}</h4>
          {#if view.drops.length === 0}<p class="note">{t('bingo.noDrops')}</p>{/if}
          <ul class="drops">
            {#each view.drops as d (d.item)}
              <li data-drop>
                <EntityLink kind="item" id={d.item} />
                {#if d.chance !== null}<span class="note"
                    >{t('bingo.chance', { n: Math.round(d.chance * 1000) / 10 })}</span
                  >{/if}
              </li>
            {/each}
          </ul>
          {#if view.level < 3}<p class="note">{t('bingo.rareHidden')}</p>{/if}
        {/if}
        {#if view.bounty}
          <p class="line" data-bounty>
            {t('bingo.bounty', {
              first: formatInt(view.bounty.first),
              paid: formatInt(view.bounty.paid),
            })}
          </p>
        {/if}

        <div class="study">
          {#if view.level >= BINGO_MAX}
            <span class="note">{t('error.bingoMax')}</span>
          {:else if view.level === 1}
            <span class="note">{t('error.bingoNeedsFight')}</span>
          {:else}
            <button
              type="button"
              disabled={!view.canStudy}
              onclick={() => learn(view.id)}
              data-study={idAttr(kind, view.id)}
              >{t('bingo.study', {
                n: formatInt(view.studyCost),
                currency: currencyName(study),
              })}</button
            >
          {/if}
        </div>
        <Slot name="bingo.entry" ctx={{ enemy: view.id, level: view.level }} />
      </li>
    {/each}
  </ul>
  {#if book.unknown > 0}
    <p class="note" data-unknown-entries>{t('bingo.unknownEntries', { n: book.unknown })}</p>
  {/if}
</section>

<style>
  .book {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .intro,
  .note,
  .stats,
  .balance,
  .empty {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .legend {
    margin: 0;
    padding-left: var(--space-5);
    font-size: var(--text-sm);
  }

  .entries {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--tile-min)), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .entry {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .who {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--steel);
  }

  h3,
  h4 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-weight: 400;
  }

  h3 {
    min-width: 0;
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  h3 :global(a) {
    color: inherit;
  }

  h4 {
    font-size: var(--text-sm);
  }

  .level {
    color: var(--accent);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .traits,
  .drops {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .answer {
    display: block;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .line {
    margin: 0;
    font-size: var(--text-sm);
  }

  .entry :global(a) {
    color: var(--accent);
  }

  .message {
    margin: 0;
    color: var(--danger);
  }

  button {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-4);
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
    background: var(--surface-raised);
    color: var(--fg-dim);
    cursor: not-allowed;
  }
</style>
