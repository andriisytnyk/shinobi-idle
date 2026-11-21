<script lang="ts">
  import { localeKey, type SkillId } from '@shinobi/content';
  import {
    actionInfo,
    builtObstacles,
    COURSE_ID,
    COURSE_KIND,
    evalReq,
    listCourse,
    type CourseSlotInfo,
    type ObstacleOption,
  } from '@shinobi/core';
  import { formatInt, formatSeconds, formatXp } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import { entityAttr } from '../lib/reveal.ts';
  import { game } from '../lib/store.ts';
  import { currencyName, moneyOf } from '../lib/vocab.ts';
  import { refusalParams, toasts } from '../lib/toasts.svelte.ts';
  import StartSplit from './StartSplit.svelte';
  import ActionEmblem from './ActionEmblem.svelte';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import PinGoal from './PinGoal.svelte';
  import ReqTree from './ReqTree.svelte';

  const content = game.content;

  interface Props {
    /** The skill whose page shows the course. */
    skill: string;
  }

  let { skill }: Props = $props();

  const K = content.balance.K;
  const slots = $derived(game.read((gs) => listCourse(gs, content, game.rules)));
  const built = $derived(game.read((gs) => builtObstacles(gs, content)));
  const total = $derived(slots.length);
  const info = $derived(
    game.read((gs) => actionInfo(gs, { kind: COURSE_KIND, id: COURSE_ID }, content, game.rules)),
  );
  const slotIndex = $derived(
    game.read((gs) => gs.slots.findIndex((s) => s.action?.kind === COURSE_KIND)),
  );
  const running = $derived(slotIndex >= 0);
  const pillar = $derived(built.length >= K.athletics.pillarCount);

  /** The two halves of an obstacle text: its bonus and its penalty. */
  function halves(id: string): [string, string] {
    const [bonus = '', penalty = ''] = t(localeKey('obstacle', id, 'desc')).split(' / ');
    return [bonus, penalty];
  }

  /** What an obstacle needs: the Athletics level of its slot and its own requirement. */
  function needs(slot: CourseSlotInfo, id: string) {
    const obstacle = content.obstacles.find((o) => o.id === id);
    if (!obstacle) return null;
    const parts = [{ t: 'skill', skill: skill as SkillId, level: slot.level } as const];
    const own = obstacle.req;
    const tree = evalReq(game.state, { t: 'all', of: own ? [...parts, own] : [...parts] }, content);
    return tree.met ? null : tree;
  }

  /** The price as the card shows it: the currency and the amount. */
  const priceText = (cost: number): string =>
    t('course.price', { n: formatInt(cost), currency: currencyName(moneyOf(content)) });

  /** The text of a refusal; the one about ryo names the price of the obstacle. */
  const pathReason = (reason: string): string =>
    reason === 'error.notEnoughRyo' ? 'course.notEnoughRyo' : reason;
  const blockedText = (reason: string, cost: number): string =>
    t(pathReason(reason), { price: priceText(cost) });

  function report(
    result: {
      ok: boolean;
      reason?: string;
      params?: Record<string, string | number>;
    },
    cost: number,
  ): void {
    if (!result.ok && result.reason)
      toasts.push({
        key: pathReason(result.reason),
        params: { price: priceText(cost), ...refusalParams(result) },
      });
  }

  const build = (slot: number, option: ObstacleOption) =>
    report(game.dispatch({ type: 'athletics.build', slot, obstacle: option.id }), option.cost);

  const label = (slot: CourseSlotInfo, option: ObstacleOption): string =>
    t(slot.built !== null && !option.built ? 'course.replace' : 'course.build');
</script>

<section class="course" data-course aria-label={t('course.title')}>
  <h2>{t('course.title')}</h2>

  <div class="run" class:running data-course-run>
    <dl class="facts">
      <div>
        <dt>{t('course.built')}</dt>
        <dd>{t('course.builtCount', { n: built.length, total })}</dd>
      </div>
      <div>
        <dt>{t('course.lap')}</dt>
        <dd>{info ? formatSeconds(info.intervalMs) : '—'}</dd>
      </div>
      <div>
        <dt>{t('tile.xph')}</dt>
        <dd>
          {#if info}
            <ModBreakdown
              keys={['xp.all', `xp.skill.${skill}`]}
              display={t('tile.xphValue', { n: formatXp(info.xpPerHour) })}
            />
          {:else}—{/if}
        </dd>
      </div>
      <div data-ui="action-mastery">
        <dt>{t('tile.mxph')}</dt>
        <dd>
          {#if info}
            <ModBreakdown
              keys={['mastery.xp.all', `mastery.xp.skill.${skill}`]}
              display={t('tile.mxphValue', { n: formatXp(info.masteryPerHour) })}
            />
          {:else}—{/if}
        </dd>
      </div>
    </dl>
    {#if built.length === 0}
      <p class="hint" data-course-empty>{t('course.empty')}</p>
    {/if}
    <div class="ct-actions">
      <StartSplit
        kind={COURSE_KIND}
        id={COURSE_ID}
        label="course.run"
        disabled={!info?.available}
      />
    </div>
  </div>

  <p class="pillar" class:active={pillar} data-pillar={pillar}>
    <Icon name={pillar ? 'lucide:check' : 'lucide:lock'} size={14} />
    {t('course.pillar', {
      n: built.length,
      count: K.athletics.pillarCount,
      pct: K.athletics.pillarXp * 100,
    })}
  </p>

  <ol class="slots">
    {#each slots as slot (slot.slot)}
      <li class="slot" class:closed={!slot.open} data-slot={slot.slot}>
        <h3>
          {t('course.slot', { n: slot.slot })}
          <span class="lvl">{t('course.slotLevel', { n: slot.level })}</span>
        </h3>
        <ul class="options">
          {#each slot.options as option (option.id)}
            {@const [bonus, penalty] = halves(option.id)}
            {@const missing = needs(slot, option.id)}
            {@const ref = { kind: 'obstacle', id: option.id }}
            <li
              class="option"
              class:built={option.built}
              data-obstacle={option.id}
              data-entity={entityAttr(ref)}
            >
              <p class="name">
                <ActionEmblem kind="obstacle" id={option.id} {skill} size="sm" />
                <EntityLink kind="obstacle" id={option.id} />
                <span class="pin-end"
                  ><PinGoal kind="obstacle" id={option.id} always={missing !== null} /></span
                >
                {#if option.built}
                  <span class="mark"
                    ><Icon name="lucide:check" size={14} /> {t('course.builtMark')}</span
                  >
                {/if}
              </p>
              <p class="bonus"><span class="tag">{t('course.bonus')}</span> {bonus}</p>
              <p class="penalty"><span class="tag">{t('course.penalty')}</span> {penalty}</p>
              {#if missing}
                <div class="req" data-req>
                  <p class="locked-label">
                    <Icon name="lucide:lock" size={14} />
                    {t('tile.locked')}
                  </p>
                  <ReqTree node={missing} />
                  <p class="pin-caption">
                    <PinGoal kind="obstacle" id={option.id} variant="link" />
                  </p>
                </div>
              {/if}
              {#if !option.built}
                <p class="price">
                  {option.cost === 0
                    ? t('course.free')
                    : t('course.price', {
                        n: formatInt(option.cost),
                        currency: currencyName(moneyOf(content)),
                      })}
                </p>
                <button
                  type="button"
                  class="action"
                  disabled={option.blocked !== null}
                  title={option.blocked && !missing
                    ? blockedText(option.blocked, option.cost)
                    : undefined}
                  onclick={() => build(slot.slot, option)}
                >
                  {label(slot, option)}
                </button>
                {#if option.blocked === 'error.notEnoughRyo'}
                  <p class="note">{blockedText(option.blocked, option.cost)}</p>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ol>
</section>

<style>
  .course {
    margin-top: var(--space-4);
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
    align-items: baseline;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    color: var(--heading);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .lvl {
    color: var(--fg-dim);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .run,
  .option {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  .run.running,
  .option.built {
    border-color: var(--accent);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: 0;
  }

  dt {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .hint,
  .note {
    margin: 0;
    color: var(--fg-dim);
  }

  .pillar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    color: var(--fg-dim);
  }

  .pillar.active {
    color: var(--success);
  }

  .slots {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .slot.closed h3 {
    color: var(--fg-dim);
  }

  .options {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-min), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .option p {
    margin: 0;
  }

  .name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
  }

  .pin-end {
    margin-left: auto;
  }

  .pin-caption {
    margin: var(--space-1) 0 0;
  }

  .mark {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--success);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .tag {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .penalty {
    color: var(--fg-dim);
  }

  .locked-label {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--fg-dim);
  }

  .price {
    font-variant-numeric: tabular-nums;
  }

  .action {
    min-height: var(--control-md);
    padding: var(--space-2) var(--space-3);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    cursor: pointer;
  }

  .action:disabled {
    border-color: var(--line);
    background: var(--line);
    color: var(--fg-dim);
    cursor: not-allowed;
  }
</style>
