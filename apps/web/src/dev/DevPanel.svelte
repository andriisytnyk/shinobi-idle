<script lang="ts">
  import { deserialize, levelCap, slotCount } from '@shinobi/core';
  import { fallbackText, hasKey, t } from '../lib/i18n.ts';
  import { formatDuration } from '../lib/format.ts';
  import { game } from '../lib/store.ts';
  import { cloneTechniques } from './clones.ts';
  import { runDev, type DevCommand, type DevResult } from './commands.ts';
  import Pick from './Pick.svelte';
  import { loadFixtures, type Fixture } from './saves.ts';
  import { dt } from './texts.ts';

  const content = game.content;

  /** A readable name of an entity: its text when it has one, else its humanised id. */
  function nameOf(kind: string, id: string): string {
    const key = `${kind}.${id}.name`;
    return hasKey(key) ? t(key) : fallbackText(`x.${id.slice(id.lastIndexOf(':') + 1)}`);
  }
  const list = <T extends { id: string }>(kind: string, rows: readonly T[]) =>
    rows.map((r) => ({ id: r.id, name: nameOf(kind, r.id) }));

  const skills = list('skill', content.skills);
  const items = list('item', content.items);
  const currencies = list('currency', content.currencies);
  const techniques = list('technique', content.techniques);
  const quests = list('quest', content.quests);
  const ranks = list('rank', content.playerRanks);
  const cells = list('cell', content.cells);
  const foes = [...list('enemy', content.enemies), ...list('boss', content.bosses)];
  const raids = list('raid', content.raids);
  const clones = cloneTechniques(content).map((id) => ({ id, name: nameOf('technique', id) }));
  /** Mastery keys: the techniques, and whatever the game already holds a mastery of. */
  const masteryKeys = $derived.by(() => {
    const known = new Set(content.techniques.map((x) => x.id));
    const extra = game.read((gs) => Object.keys(gs.mastery)).filter((k) => !known.has(k));
    return [...techniques, ...extra.map((id) => ({ id, name: fallbackText(`x.${id}`) }))];
  });

  let open = $state(false);
  let message = $state('');
  let failed = $state(false);

  let skill = $state(skills[0]?.id ?? '');
  let skillLevel = $state(10);
  let masteryKey = $state('');
  let masteryLevel = $state(10);
  let item = $state(items[0]?.id ?? '');
  let itemCount = $state(10);
  let currency = $state(currencies[0]?.id ?? '');
  let currencyCount = $state(1000);
  let technique = $state(techniques[0]?.id ?? '');
  let quest = $state(quests[0]?.id ?? '');
  let flag = $state('');
  let rank = $state(ranks[0]?.id ?? '');
  let performer = $state(0);
  let cell = $state(cells[0]?.id ?? '');
  let foe = $state(foes[0]?.id ?? '');
  let bingo = $state(3);
  let raid = $state(raids[0]?.id ?? '');
  let cloneTech = $state(clones[0]?.id ?? '');
  let customMin = $state(30);
  let dump = $state('');
  let pasted = $state('');
  let fixtures = $state.raw<Fixture[]>([]);
  let fixture = $state('');

  const cap = levelCap(content);
  const speeds = [1, 10, 60, 600];
  const steps = [
    { text: 'dev.min1', ms: 60_000 },
    { text: 'dev.min10', ms: 600_000 },
    { text: 'dev.hour1', ms: 3_600_000 },
    { text: 'dev.hour8', ms: 28_800_000 },
  ];
  const performers = $derived(
    Array.from({ length: game.read((gs) => slotCount(gs, content)) }, (_, slot) => ({
      slot,
      label: slot === 0 ? dt('dev.performerSelf') : dt('dev.performerClone', { n: slot }),
    })),
  );

  /** Runs a developer command on the live game and shows what came of it. */
  function run(command: DevCommand): void {
    const done: { verdict: DevResult } = { verdict: { ok: true } };
    game.devApply((state, c, rules) => {
      done.verdict = runDev(state, c, rules, command);
    });
    const { verdict } = done;
    failed = !verdict.ok;
    message = verdict.ok ? dt('dev.ok') : dt('dev.refused', { reason: dt(verdict.reason) });
  }

  async function showFixtures(): Promise<void> {
    if (fixtures.length > 0) return;
    fixtures = await loadFixtures();
    fixture = fixtures[0]?.id ?? '';
  }

  async function jump(): Promise<void> {
    const picked = fixtures.find((f) => f.id === fixture);
    if (!picked) return;
    try {
      game.replaceState(deserialize(picked.save, game.content, game.rules));
      await game.save();
      failed = false;
      message = dt('dev.ok');
    } catch (error) {
      failed = true;
      message = dt('dev.refused', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function importPasted(): Promise<void> {
    try {
      await game.importText(pasted.trim());
      failed = false;
      message = dt('dev.ok');
    } catch (error) {
      failed = true;
      message = dt('dev.refused', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function newGame(): Promise<void> {
    if (!confirm(dt('dev.newGameConfirm'))) return;
    await game.reset();
    failed = false;
    message = dt('dev.ok');
  }
</script>

<button type="button" class="opener" data-dev-open onclick={() => (open = !open)}>
  {dt('dev.open')}
</button>

{#if open}
  <aside class="panel" data-dev-panel aria-label={dt('dev.title')}>
    <header>
      <h2>{dt('dev.title')}</h2>
      <button type="button" data-dev-close onclick={() => (open = false)}>{dt('dev.close')}</button>
    </header>
    <p class="warn">{dt('dev.warn')}</p>
    <p class="status" class:bad={failed} role="status" data-dev-message>{message}</p>

    <details open>
      <summary>{dt('dev.time')}</summary>
      <p class="dim">{dt('dev.now', { time: formatDuration(game.state.now) })}</p>
      <div class="row">
        {#each steps as step (step.ms)}
          <button
            type="button"
            data-advance={step.ms}
            onclick={() => run({ type: 'time.advance', ms: step.ms })}
          >
            {dt(step.text)}
          </button>
        {/each}
      </div>
      <div class="row">
        <label class="field"
          ><span>{dt('dev.customMin')}</span><input
            type="number"
            min="0"
            bind:value={customMin}
          /></label
        >
        <button
          type="button"
          data-advance-custom
          onclick={() => run({ type: 'time.advance', ms: Math.round(customMin * 60_000) })}
        >
          {dt('dev.advance')}
        </button>
      </div>
      <p class="dim">{dt('dev.speed')}</p>
      <div class="row">
        {#each speeds as n (n)}
          <button
            type="button"
            data-speed={n}
            class:on={game.devSpeed === n}
            aria-pressed={game.devSpeed === n}
            onclick={() => (game.devSpeed = n)}
          >
            ×{n}
          </button>
        {/each}
      </div>
    </details>

    <details>
      <summary>{dt('dev.skills')}</summary>
      <div class="row">
        <Pick label={dt('dev.skill')} options={skills} bind:value={skill} />
        <label class="field"
          ><span>{dt('dev.level')}</span><input
            type="number"
            min="0"
            max={cap}
            bind:value={skillLevel}
          /></label
        >
      </div>
      <div class="row">
        <button
          type="button"
          data-skill-set
          onclick={() => run({ type: 'skill.setLevel', skill, level: skillLevel })}
          >{dt('dev.setLevel')}</button
        >
        <button
          type="button"
          data-skill-cap
          onclick={() => run({ type: 'skill.setLevel', skill, level: cap })}
          >{dt('dev.toCap')}</button
        >
      </div>
      <div class="row">
        <Pick label={dt('dev.mastery')} options={masteryKeys} bind:value={masteryKey} />
        <label class="field"
          ><span>{dt('dev.level')}</span><input
            type="number"
            min="0"
            bind:value={masteryLevel}
          /></label
        >
      </div>
      <div class="row">
        <button
          type="button"
          data-mastery-set
          onclick={() => run({ type: 'mastery.set', key: masteryKey, level: masteryLevel })}
          >{dt('dev.masterySet')}</button
        >
        <button
          type="button"
          data-mastery-clear
          onclick={() => run({ type: 'mastery.set', key: masteryKey, level: 0 })}
          >{dt('dev.masteryClear')}</button
        >
      </div>
      <div class="row">
        <button type="button" data-pool-50 onclick={() => run({ type: 'pool.set', skill, pct: 50 })}
          >{dt('dev.pool50')}</button
        >
        <button
          type="button"
          data-pool-100
          onclick={() => run({ type: 'pool.set', skill, pct: 100 })}>{dt('dev.pool100')}</button
        >
      </div>
    </details>

    <details>
      <summary>{dt('dev.items')}</summary>
      <div class="row">
        <Pick label={dt('dev.item')} options={items} bind:value={item} />
        <label class="field"
          ><span>{dt('dev.count')}</span><input
            type="number"
            min="1"
            bind:value={itemCount}
          /></label
        >
      </div>
      <div class="row">
        <button
          type="button"
          data-item-give
          onclick={() => run({ type: 'item.grant', id: item, n: itemCount })}
          >{dt('dev.give')}</button
        >
      </div>
      <div class="row">
        <Pick label={dt('dev.currency')} options={currencies} bind:value={currency} />
        <label class="field"
          ><span>{dt('dev.count')}</span><input
            type="number"
            min="1"
            bind:value={currencyCount}
          /></label
        >
      </div>
      <div class="row">
        <button
          type="button"
          data-currency-give
          onclick={() => run({ type: 'currency.grant', id: currency, n: currencyCount })}
          >{dt('dev.give')}</button
        >
      </div>
      <div class="row">
        <Pick label={dt('dev.technique')} options={techniques} bind:value={technique} />
      </div>
      <div class="row">
        <button
          type="button"
          data-technique-learn
          onclick={() => run({ type: 'technique.learn', id: technique })}>{dt('dev.learn')}</button
        >
        <button
          type="button"
          data-scroll-read
          onclick={() => run({ type: 'scroll.read', technique })}>{dt('dev.scroll')}</button
        >
      </div>
    </details>

    <details>
      <summary>{dt('dev.story')}</summary>
      <div class="row"><Pick label={dt('dev.quest')} options={quests} bind:value={quest} /></div>
      <div class="row">
        <button
          type="button"
          data-quest-step
          onclick={() => run({ type: 'story.completeStep', quest })}
          >{dt('dev.completeStep')}</button
        >
      </div>
      <div class="row">
        <label class="field wide"
          ><span>{dt('dev.flag')}</span><input type="text" bind:value={flag} /></label
        >
        <button type="button" data-flag-set onclick={() => run({ type: 'story.flag', id: flag })}
          >{dt('dev.flagSet')}</button
        >
        <button
          type="button"
          data-flag-clear
          onclick={() => run({ type: 'story.flag', id: flag, value: null })}
          >{dt('dev.flagClear')}</button
        >
      </div>
      <div class="row"><Pick label={dt('dev.rank')} options={ranks} bind:value={rank} /></div>
      <div class="row">
        <button type="button" data-rank-set onclick={() => run({ type: 'rank.set', rank })}
          >{dt('dev.rankSet')}</button
        >
        <button type="button" data-exam-ready onclick={() => run({ type: 'exam.ready', rank })}
          >{dt('dev.examReady')}</button
        >
      </div>
    </details>

    <details>
      <summary>{dt('dev.map')}</summary>
      <div class="row">
        <button type="button" data-map-survey onclick={() => run({ type: 'map.surveyAll' })}
          >{dt('dev.surveyAll')}</button
        >
        <button type="button" data-map-points onclick={() => run({ type: 'map.revealPoints' })}
          >{dt('dev.revealPoints')}</button
        >
      </div>
      <div class="row">
        <label class="field"
          ><span>{dt('dev.performer')}</span>
          <select bind:value={performer}>
            {#each performers as p (p.slot)}<option value={p.slot}>{p.label}</option>{/each}
          </select>
        </label>
        <Pick label={dt('dev.cell')} options={cells} bind:value={cell} />
      </div>
      <div class="row">
        <button
          type="button"
          data-map-teleport
          onclick={() => run({ type: 'map.teleport', slot: performer, hex: cell })}
          >{dt('dev.teleport')}</button
        >
      </div>
    </details>

    <details>
      <summary>{dt('dev.fights')}</summary>
      <div class="row">
        <Pick label={dt('dev.enemy')} options={foes} bind:value={foe} />
        <label class="field"
          ><span>{dt('dev.bingo')}</span><input
            type="number"
            min="0"
            max="3"
            bind:value={bingo}
          /></label
        >
      </div>
      <div class="row">
        <button
          type="button"
          data-bingo-set
          onclick={() => run({ type: 'fight.bingo', enemy: foe, level: bingo })}
          >{dt('dev.bingoSet')}</button
        >
      </div>
      <div class="row">
        <button type="button" data-fight-win onclick={() => run({ type: 'fight.win' })}
          >{dt('dev.win')}</button
        >
        <button type="button" data-fight-lose onclick={() => run({ type: 'fight.lose' })}
          >{dt('dev.lose')}</button
        >
      </div>
      <div class="row"><Pick label={dt('dev.raid')} options={raids} bind:value={raid} /></div>
      <div class="row">
        <button type="button" data-raid-spawn onclick={() => run({ type: 'raid.spawn', raid })}
          >{dt('dev.raidSpawn')}</button
        >
      </div>
    </details>

    <details>
      <summary>{dt('dev.clones')}</summary>
      <p class="dim">{dt('dev.cloneNote')}</p>
      <div class="row">
        <Pick label={dt('dev.technique')} options={clones} bind:value={cloneTech} />
      </div>
      <div class="row">
        <button
          type="button"
          data-clone-create
          onclick={() => run({ type: 'clone.create', technique: cloneTech })}
          >{dt('dev.cloneCreate')}</button
        >
        <button type="button" data-clone-fatigue onclick={() => run({ type: 'clone.clearFatigue' })}
          >{dt('dev.clearFatigue')}</button
        >
      </div>
    </details>

    <details ontoggle={showFixtures}>
      <summary>{dt('dev.saves')}</summary>
      <div class="row">
        <button type="button" data-save-export onclick={() => (dump = game.exportText())}
          >{dt('dev.export')}</button
        >
        <button type="button" data-new-game onclick={newGame}>{dt('dev.newGame')}</button>
      </div>
      {#if dump}<textarea readonly rows="5" aria-label={dt('dev.export')} value={dump}
        ></textarea>{/if}
      <textarea
        rows="3"
        aria-label={dt('dev.importLabel')}
        placeholder={dt('dev.importLabel')}
        bind:value={pasted}></textarea>
      <div class="row">
        <button type="button" data-save-import onclick={importPasted}>{dt('dev.import')}</button>
      </div>
      <div class="row">
        <Pick
          label={dt('dev.fixture')}
          options={fixtures.map((f) => ({ id: f.id, name: f.label }))}
          bind:value={fixture}
        />
      </div>
      <div class="row">
        <button type="button" data-save-jump onclick={jump}>{dt('dev.jump')}</button>
      </div>
    </details>
  </aside>
{/if}

<style>
  .opener {
    position: fixed;
    left: var(--space-2);
    bottom: calc(var(--now-live, var(--now-height)) + var(--space-2));
    z-index: var(--z-toast);
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) dashed var(--danger);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--danger);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
  }

  @media (max-width: 768px) {
    .opener {
      bottom: calc(var(--now-live, var(--now-height)) + var(--tabbar-height) + var(--space-2));
    }
  }

  .panel {
    position: fixed;
    inset: 0 0 0 auto;
    z-index: calc(var(--z-toast) + 1);
    width: min(var(--modal-width), 100%);
    overflow-y: auto;
    padding: var(--space-3);
    border-left: var(--border-thin) dashed var(--danger);
    background: var(--surface);
    color: var(--fg);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-md);
  }

  p {
    margin: var(--space-1) 0;
  }

  .warn,
  .dim {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .status {
    min-height: var(--control-sm);
    font-size: var(--text-xs);
  }

  .status.bad {
    color: var(--danger);
  }

  details {
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
  }

  summary {
    display: flex;
    align-items: center;
    min-height: var(--control-md);
    font-weight: 600;
    cursor: pointer;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .field {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .field.wide {
    flex: 1 1 var(--toast-width);
  }

  input,
  select,
  textarea {
    min-height: var(--control-md);
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }

  input[type='number'] {
    width: calc(var(--control-md) * 3);
  }

  textarea {
    width: 100%;
    margin-top: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  button {
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  button.on {
    border-color: var(--danger);
    color: var(--danger);
  }
</style>
