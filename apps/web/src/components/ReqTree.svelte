<script lang="ts">
  import { natureStatus, pointStatus, type ReqResult } from '@shinobi/core';
  import { humanId, webRef } from '../lib/entities.ts';
  import { currencyName, currencyOf, rankName } from '../lib/vocab.ts';
  import { game } from '../lib/store.ts';
  import { formatInt } from '../lib/format.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { nameShown } from '../lib/reveal.ts';
  import { flagEntity } from '../lib/world.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ReqTree from './ReqTree.svelte';

  interface Props {
    node: ReqResult;
    /** Nesting level; the root of a tree prints no "all of" caption. */
    depth?: number;
    /** The `data-ui` part of each row: the goal panel's rows are `goal-row`. */
    part?: 'req-row' | 'goal-row';
  }

  let { node, depth = 0, part = 'req-row' }: Props = $props();

  const req = $derived(node.req);
  const ref = $derived(webRef(node.ref));
  /** A row about an entity the player has not discovered keeps its place (the player sees that something is asked) but not the id. */
  const shown = $derived(ref !== null && nameShown(ref));
  const isGroup = $derived(req.t === 'all' || req.t === 'any');
  /** Rows with a count to reach show it with a thin bar. */
  const counted = $derived(
    req.t === 'skill' ||
      req.t === 'item' ||
      req.t === 'building' ||
      req.t === 'quest' ||
      req.t === 'currency' ||
      (req.t === 'flag' && node.target > 1),
  );
  const fraction = $derived(
    node.target > 0 ? Math.min(1, Math.max(0, node.current / node.target)) : node.met ? 1 : 0,
  );
  /** The currency a `currency` row counts: the one with the role. */
  const currency = $derived(req.t === 'currency' ? currencyOf(game.content, req.role) : null);
  /** A map flag (a point found, a region open) names the place it is about. */
  const flagRef = $derived(req.t === 'flag' ? flagEntity(req.id) : null);
  /** The place whose point of interest a `point.<place>` flag asks to have found. */
  const pointPlace = $derived(
    req.t === 'flag' && req.id.startsWith('point.')
      ? (game.content.places.find(
          (p) => p.id === (req as { id: string }).id.slice('point.'.length),
        ) ?? null)
      : null,
  );
  /** Its name is printed only once the player knows the point: a hidden or veiled one is «???». */
  const pointName = $derived(
    pointPlace
      ? game.read((gs) =>
          ['open', 'found'].includes(pointStatus(gs, game.content, pointPlace))
            ? t(`place.${pointPlace.id}.name`)
            : t('req.pointHidden'),
        )
      : '',
  );
  /** The vague hint of a point the player cannot name yet: «???» says where to look. A veiled point has its own hint; a hidden one says what the reveal rule asks. */
  const pointHint = $derived(
    pointPlace
      ? game.read((gs) => {
          const status = pointStatus(gs, game.content, pointPlace);
          if (status === 'veiled' && hasKey(`place.${pointPlace.id}.hint`))
            return t(`place.${pointPlace.id}.hint`);
          if (status === 'hidden') {
            // The reveal rule of the point: a survey level of the hex says to survey; a point found alone says to look for where it is named.
            const by = pointPlace.point?.revealedBy;
            return t(by && by.survey === undefined ? 'reveal.hint.named' : 'reveal.hint.explored');
          }
          return null;
        })
      : null,
  );
  /** A skill that is a chakra nature the character does not own: the level alone does not say that the nature is what is missing. */
  const natureLacking = $derived(
    req.t === 'skill' && !node.met
      ? game.read(
          (gs) =>
            game.content.natures.some((n) => n.id === (req as { skill: string }).skill) &&
            !gs.player.natures.includes((req as { skill: string }).skill as never),
        )
      : false,
  );
  /** The link to the nature page is offered only while this nature can really be chosen now (the test, or an extra nature once Chakra Control allows it). */
  const natureChoosable = $derived(
    req.t === 'nature'
      ? game.read((gs) => {
          const status = natureStatus(gs, game.content);
          return status.canChoose && status.free.includes((req as { nature: string }).nature);
        })
      : false,
  );
  const flagText = $derived(
    req.t === 'flag'
      ? hasKey(`req.flag.${req.id}`)
        ? t(`req.flag.${req.id}`)
        : humanId(req.id)
      : '',
  );
</script>

{#if isGroup}
  <div class="group" data-met={node.met}>
    {#if req.t === 'any' || depth > 0}
      <p class="caption">{t(req.t === 'any' ? 'req.any' : 'req.all')}</p>
    {/if}
    <ul class="rows">
      {#each node.children as child, i (i)}
        <li><ReqTree node={child} depth={depth + 1} {part} /></li>
      {/each}
    </ul>
  </div>
{:else}
  <div
    class="row"
    class:met={node.met}
    data-met={node.met}
    data-ui={part}
    data-entity={ref && shown ? `${ref.kind}:${ref.id}` : undefined}
  >
    <span class="mark"><Icon name={node.met ? 'lucide:check' : 'lucide:minus'} size={14} /></span>
    <span class="label">
      {#if req.t === 'skill'}
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} offered />{/if}
        <span class="detail">{t('req.level', { n: req.level })}</span>
        {#if natureLacking}<span class="detail" data-nature-lacking>{t('req.needNature')}</span
          >{/if}
      {:else if req.t === 'technique'}
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} offered />{/if}
        <span class="detail">{t(node.met ? 'req.known' : 'req.unknown')}</span>
      {:else if req.t === 'nature'}
        <span class="detail">{t('req.nature')}</span>
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} offered />{/if}
        {#if !node.met && natureChoosable}<a class="detail-link" href="#/nature"
            >{t('req.natureLink')}</a
          >{/if}
      {:else if req.t === 'item'}
        {#if ref}<EntityLink kind={ref.kind} id={ref.id} offered />{/if}
      {:else if req.t === 'currency'}
        {currency === null ? t(`req.type.currency`) : currencyName(currency)}
      {:else if req.t === 'rank'}
        {t('req.rank', { rank: rankName(req.rank) })}
      {:else if req.t === 'flag' && pointPlace}
        <span data-point-req>{t('req.pointFound', { name: pointName })}</span>
        {#if pointHint}<span class="detail" data-point-req-hint>{pointHint}</span>{/if}
      {:else if req.t === 'flag' && flagRef}
        <EntityLink kind={flagRef.kind} id={flagRef.id} offered />
        <span class="detail">{t(flagRef.kind === 'poi' ? 'req.poiFound' : 'req.regionOpen')}</span>
      {:else if req.t === 'flag'}
        {flagText}
      {:else if ref}
        <EntityLink kind={ref.kind} id={ref.id} offered />
      {:else}
        {t(`req.type.${req.t}`)}
      {/if}
    </span>
    {#if counted}
      <span class="count"
        >{formatInt(Math.min(node.current, node.target))}/{formatInt(node.target)}</span
      >
      <span class="bar" aria-hidden="true"
        ><span class="fill" style:width="{fraction * 100}%"></span></span
      >
    {/if}
  </div>
{/if}

<style>
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rows :global(.group) {
    margin-left: var(--space-3);
    padding-left: var(--space-2);
    border-left: var(--border-thin) solid var(--line);
  }

  .caption {
    margin: var(--space-1) 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'mark label count'
      '. bar bar';
    align-items: center;
    column-gap: var(--space-2);
    padding: var(--space-1) 0;
    color: var(--fg-dim);
  }

  .row.met {
    color: var(--fg);
  }

  .mark {
    grid-area: mark;
    display: inline-flex;
    color: var(--fg-dim);
  }

  .met .mark {
    color: var(--success);
  }

  .label {
    grid-area: label;
    min-width: 0;
  }

  .label :global(a) {
    color: var(--fg);
    font-weight: 600;
  }

  .detail {
    margin-left: var(--space-1);
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .detail-link {
    margin-left: var(--space-2);
    color: var(--accent);
    font-size: var(--text-xs);
  }

  .count {
    grid-area: count;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .bar {
    grid-area: bar;
    height: var(--bar-thin);
    border-radius: var(--radius-xs);
    background: var(--line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .met .fill {
    background: var(--success);
  }
</style>
