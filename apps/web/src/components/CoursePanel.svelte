<script lang="ts">
  import { content, localeKey } from '@shinobi/content';
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
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import EntityLink from './EntityLink.svelte';
  import Icon from './Icon.svelte';
  import ModBreakdown from './ModBreakdown.svelte';
  import ReqTree from './ReqTree.svelte';

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
    const parts = [{ t: 'skill', skill: 'ath', level: slot.level } as const];
    const own = obstacle.req;
    const tree = evalReq(game.state, { t: 'all', of: own ? [...parts, own] : [...parts] }, content);
    return tree.met ? null : tree;
  }

  function report(result: { ok: boolean; reason?: string }): void {
    if (!result.ok && result.reason) toasts.push({ key: result.reason, params: {} });
  }

  const build = (slot: number, obstacle: string) =>
    report(game.dispatch({ type: 'athletics.build', slot, obstacle }));

  function toggle(): void {
    report(
      running
        ? game.dispatch({ type: 'action.stop', slot: slotIndex })
        : game.dispatch({ type: 'action.start', slot: 0, kind: COURSE_KIND, id: COURSE_ID }),
    );
  }

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
              keys={['xp.all', 'xp.skill.ath']}
              display={t('tile.xphValue', { n: formatXp(info.xpPerHour) })}
            />
          {:else}—{/if}
        </dd>
      </div>
    </dl>
    {#if built.length === 0}
      <p class="hint" data-course-empty>{t('course.empty')}</p>
    {/if}
    <button
      type="button"
      class="action"
      class:stop={running}
      disabled={!running && !info?.available}
      onclick={toggle}
    >
      {t(running ? 'tile.stop' : 'course.run')}
    </button>
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
            <li class="option" class:built={option.built} data-obstacle={option.id}>
              <p class="name">
                <EntityLink kind="obstacle" id={option.id} />
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
                </div>
              {/if}
              {#if !option.built}
                <p class="price">
                  {option.cost === 0
                    ? t('course.free')
                    : t('course.price', { n: formatInt(option.cost) })}
                </p>
                <button
                  type="button"
                  class="action"
                  disabled={option.blocked !== null}
                  title={option.blocked && !missing ? t(option.blocked) : undefined}
                  onclick={() => build(slot.slot, option.id)}
                >
                  {label(slot, option)}
                </button>
                {#if option.blocked === 'error.notEnoughRyo'}
                  <p class="note">{t(option.blocked)}</p>
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
    font-size: 1.1rem;
    font-weight: 400;
  }

  h3 {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    color: var(--heading);
    font-size: 1rem;
    font-weight: 600;
  }

  .lvl {
    color: var(--fg-dim);
    font-size: 0.85rem;
    font-weight: 400;
  }

  .run,
  .option {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
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
    font-size: 0.8rem;
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
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
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

  .mark {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--success);
    font-size: 0.85rem;
    font-weight: 400;
  }

  .tag {
    color: var(--fg-dim);
    font-size: 0.8rem;
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
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font: inherit;
    cursor: pointer;
  }

  .action.stop {
    background: none;
    color: var(--accent);
  }

  .action:disabled {
    border-color: var(--line);
    background: var(--line);
    color: var(--fg-dim);
    cursor: not-allowed;
  }
</style>
