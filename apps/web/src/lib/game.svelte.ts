import type { ContentDb, PackManifest } from '@shinobi/content';
import {
  advance,
  advanceOffline,
  createState,
  defaultRules,
  dispatch as coreDispatch,
  revealHint,
  revealOf,
  shownKey,
  type Command,
  type RevealLevel,
  type CommandResult,
  type GameEvent,
  type GameState,
  type Rules,
} from '@shinobi/core';
import {
  BACKUP_KEY,
  BROKEN_SAVE_KEY,
  SAVE_KEY,
  LoadError,
  backupSave,
  buildReport,
  exportSave,
  importSave,
  loadGame,
  newGame,
  readBackup,
  saveGame,
  type AnbuReport,
  type Clock,
  type KeyValue,
  type LoadReason,
} from './persistence.ts';
import type { Signals } from './hints.ts';
import { setActiveContent, setActiveState } from './active.ts';
import { composeBoot } from './boot.ts';
import { deepFreeze } from './freeze.ts';
import { detach as detachData } from './read.ts';
import { requestPersistentStorage } from './platform.ts';
import { setRevealReader, type RevealReader } from './reveal.ts';
import type { TabLock } from './tab-lock.ts';
import { packsToasts, toastFor, toasts as defaultToasts } from './toasts.svelte.ts';

/** How often the game loop runs. */
export const TICK_MS = 100;
/** Commands after which the game is saved at once: what a reload must not undo. */
const SAVE_NOW: ReadonlySet<string> = new Set([
  'nature.choose',
  'nature.add',
  'exam.start',
  'item.use',
  'item.coat',
  'shop.buy',
  'shop.sell',
  'gear.buy',
  'athletics.build',
  'meditation.buy',
]);

/** How often the save is written. */
export const SAVE_EVERY_MS = 10_000;
/** A gap longer than this between two ticks means the tab slept: catch up through the offline path. */
export const SLEEP_GAP_MS = 5_000;

/** A line of the battle log the page keeps: events of the fight, numbered for keyed lists. */
export type LogEvent = Extract<
  GameEvent,
  { type: 'combatLog' | 'enemyDefeated' | 'playerDefeated' }
>;
/** A rule a pack added that failed and was switched off for the session. */
export interface RuleNotice {
  pack: string;
  rule: string;
  reason: string;
}
export interface LogEntry {
  id: number;
  event: LogEvent;
}

/** Lines the battle log keeps. */
export const LOG_LIMIT = 60;

export type SaveStatus = 'idle' | 'saved' | 'error';

/**
 * `loading`: reading the save. `playing`: the loop and autosave run. `blocked`: another tab plays
 * (or took over); this tab neither runs nor saves. `error`: the save could not be read; nothing
 * runs and nothing is written until the player decides.
 */
export type Phase = 'loading' | 'playing' | 'blocked' | 'error';

/** Listeners that UI packs add around commands. `before` may replace the command or return `false` to cancel it. */
export interface CommandHook {
  before?(command: Command): Command | false | void;
  after?(command: Command, result: CommandResult): void;
}

export interface GameDeps {
  /** The composed content of this game; the pack `core` alone when omitted. */
  content?: ContentDb;
  rules?: Rules;
  /** The manifests of the packs the content was composed from. */
  packs?: readonly PackManifest[];
  /** The packs the core left out because they failed to compose. */
  failed?: readonly { pack: string; error: string }[];
  clock?: Clock;
  kv?: KeyValue;
  lock?: TabLock | null;
  toasts?: Pick<typeof defaultToasts, 'push'>;
}

/**
 * The reactive game store. The state is plain JSON mutated in place by the core; the `version`
 * counter is what the UI subscribes to: reading `state` reads the counter, so anything that uses
 * the state re-runs after every tick.
 */
export function createGame(deps: GameDeps = {}) {
  // The content is data that nobody changes at run time; packs get it too, so it is frozen once.
  const base = deps.content === undefined || deps.rules === undefined ? composeBoot() : null;
  const content = deepFreeze(deps.content ?? base?.content ?? composeBoot().content);
  const rules = deps.rules ?? base?.rules ?? defaultRules;
  const packs = deps.packs ?? content.packs;
  const failed = deps.failed ?? [];
  setActiveContent(content);
  const clock = deps.clock ?? { now: () => 0 };
  const kv = deps.kv ?? null;
  const lock = deps.lock ?? null;
  const toasts = deps.toasts ?? defaultToasts;

  let state = $state.raw<GameState>(createState(1, content));
  setActiveState(() => state);
  let version = $state(0);
  let report = $state.raw<AnbuReport | null>(null);
  let phase = $state<Phase>('loading');
  let saveStatus = $state<SaveStatus>('idle');
  let loadError = $state.raw<{ message: string; raw: string | null; reason: LoadReason } | null>(
    null,
  );
  let hasBackup = $state(false);
  let log = $state.raw<LogEntry[]>([]);
  let logId = 0;
  /** Set when the player has just graduated; the graduation modal clears it. */
  let graduation = $state(false);
  /** One-off happenings of this session that hints wait for (a craft that ran out of ingredients). */
  let signals = $state.raw<Signals>({});

  // The reveal rule for the components: whatever reads it follows the stamp below.
  // Many links on a page ask about the same few entities: answers are kept until the stamp moves.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache that no view reads
  const levels = new Map<string, Map<string, RevealLevel>>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache that no view reads
  const hints = new Map<string, Map<string, string | null>>();
  /** Bumped by whatever may change what is discovered at once: a command, a drained event, a new state. Between such moments answers are kept for a second of game time. */
  let epoch = 0;
  /**
   * What views of the reveal rule subscribe to: it moves only when answers may have changed (a command,
   * a drained event, a new state, a new game second), not on every tick, so a page full of links does
   * not recompute them ten times a second.
   */
  let revealStamp = $state(0);
  let stampedEpoch = -1;
  let stampedSecond = -1;
  /** Called with every update of the game: moves the stamp when the answers may be stale. */
  const restamp = (): void => {
    const second = Math.floor(state.now / 1000);
    if (stampedEpoch !== epoch || stampedSecond !== second) {
      stampedEpoch = epoch;
      stampedSecond = second;
      levels.clear();
      hints.clear();
      revealStamp++;
    }
  };
  const fresh = (): void => {
    void revealStamp;
  };
  function remember<T>(
    cache: Map<string, Map<string, T>>,
    ref: { kind: string; id: string },
    make: () => T,
  ): T {
    let byId = cache.get(ref.kind);
    if (!byId) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache that no view reads
      byId = new Map();
      cache.set(ref.kind, byId);
    }
    let value = byId.get(ref.id);
    if (value === undefined) {
      value = make();
      byId.set(ref.id, value);
    }
    return value;
  }
  const reveal: RevealReader = {
    level(ref) {
      fresh();
      return remember(levels, ref, () => revealOf(state, ref, content, rules));
    },
    hint(ref) {
      fresh();
      return remember(hints, ref, () => revealHint(state, ref, content, rules));
    },
    mark(refs) {
      let changed = false;
      for (const ref of refs) {
        if (state.shown[shownKey(ref)] === true || revealOf(state, ref, content, rules) === 'full')
          continue;
        // Straight to the core, past the hooks of the packs: the mark is bookkeeping, not a player's command.
        if (coreDispatch(state, { type: 'reveal.mark', refs: [ref] }, content, rules).ok)
          changed = true;
      }
      if (changed) {
        epoch++;
        touch();
      }
    },
  };
  setRevealReader(reveal);

  /** Revision of the save this tab last read or wrote; a stored revision above it means a newer save exists. */
  let rev = 0;
  let lastWall = clock.now();
  let timers: number[] = [];
  const commandHooks: CommandHook[] = [];
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain bookkeeping that no view reads
  const eventListeners = new Set<(event: GameEvent) => void>();
  let detach: (() => void) | null = null;

  const touch = () => {
    version++;
    restamp();
  };

  /** A rule of a pack that the core switched off: listed for the session, told once. */
  let ruleNotices = $state.raw<RuleNotice[]>([]);
  function noteRule(pack: string, rule: string, reason: string): boolean {
    if (ruleNotices.some((n) => n.pack === pack && n.rule === rule)) return false;
    ruleNotices = [...ruleNotices, { pack, rule, reason }];
    return true;
  }

  /** Turns the events the core queued into toasts and empties the queue. */
  function drainEvents(): void {
    const events = state.events;
    if (events.length === 0) return;
    // The listeners below may ask the reveal rule about what the event brought: the answers are dropped first.
    epoch++;
    restamp();
    state.events = [];
    for (const listener of eventListeners) for (const event of events) listener(event);
    const lines: LogEntry[] = [];
    let urgent = false;
    for (const event of events) {
      // Changes the player must not lose to a reload are saved at once, not on the next timer.
      if (event.type === 'rankUp' || event.type === 'natureGained') urgent = true;
      if (event.type === 'actionStopped' && event.missing && !signals.craftStopped) {
        signals = { ...signals, craftStopped: true };
      }
      if (event.type === 'travelled' && !signals.travelled) {
        signals = { ...signals, travelled: true };
      }
      if (
        // The log tells what was cast and what hit; the starts, ends and breaks of every action are for the fight view.
        (event.type === 'combatLog' &&
          (event.act === 'hit' ||
            event.act === 'miss' ||
            (event.act === 'cast' &&
              event.side === 'player' &&
              content.techniques.some((x) => x.id === event.tech)))) ||
        event.type === 'enemyDefeated' ||
        event.type === 'playerDefeated'
      ) {
        lines.push({ id: ++logId, event });
      } else if (event.type === 'rankUp' && content.exams.some((e) => e.rank === event.rank)) {
        graduation = true;
      }
      if (event.type === 'ruleDisabled' && !noteRule(event.pack, event.rule, event.reason))
        continue;
      if (event.type === 'packsChanged') for (const p of packsToasts(event)) toasts.push(p);
      const spec = toastFor(event, content);
      if (spec) toasts.push(spec);
    }
    if (lines.length > 0) log = [...log, ...lines].slice(-LOG_LIMIT);
    if (urgent) void save();
  }

  /** One pass of the loop: move the game to the wall clock, through the offline path after a sleep. */
  function tick(): void {
    const now = clock.now();
    const delta = Math.floor(now - lastWall);
    if (delta < 0) {
      // The wall clock went backwards: resume from here instead of stalling until it catches up.
      lastWall = now;
      return;
    }
    if (delta === 0) return;
    lastWall += delta;
    if (delta > SLEEP_GAP_MS) {
      const summary = advanceOffline(state, delta, content, rules);
      for (const r of summary.rulesDisabled ?? []) noteRule(r.pack, r.rule, r.reason);
      const next = buildReport(summary);
      if (next) report = next;
    } else {
      advance(state, delta, content, rules);
    }
    drainEvents();
    touch();
  }

  async function refreshBackupFlag(): Promise<void> {
    try {
      hasBackup = kv ? (await kv.get(BACKUP_KEY)) !== undefined : false;
    } catch {
      hasBackup = false;
    }
  }

  /** Writes the save; a refusal because a newer one is stored hands the game to the other tab. */
  async function writeSave(force: boolean): Promise<void> {
    if (!kv || phase === 'blocked' || phase === 'error') return;
    try {
      const result = await saveGame(kv, clock, state, rev, force);
      if (result.ok) {
        rev = result.rev;
        saveStatus = 'saved';
      } else {
        halt();
        phase = 'blocked';
      }
    } catch {
      saveStatus = 'error';
    }
  }

  /**
   * Saves one after another. Two writes in flight would both carry the same revision, and the
   * second would find the first one's newer revision in the store and take it for another tab.
   */
  let writing: Promise<void> = Promise.resolve();
  function save(force = false): Promise<void> {
    writing = writing.then(() => writeSave(force));
    return writing;
  }

  function begin(): void {
    if (timers.length > 0) return;
    lastWall = clock.now();
    timers.push(
      window.setInterval(tick, TICK_MS),
      window.setInterval(() => void save(), SAVE_EVERY_MS),
    );
    const onHide = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    const onPageHide = () => void save();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    detach = () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }

  /** Stops the loop and every save trigger. */
  function halt(): void {
    for (const id of timers) window.clearInterval(id);
    timers = [];
    detach?.();
    detach = null;
  }

  function replaceState(next: GameState): void {
    state = next;
    epoch++;
    // The game that is given a state is the one that is played: the reveal rule reads from it.
    setRevealReader(reveal);
    log = [];
    graduation = false;
    signals = {};
    lastWall = clock.now();
    touch();
  }

  /** Loads the save; on success the game plays, on failure nothing runs and the error is shown. */
  async function boot(): Promise<void> {
    phase = 'loading';
    loadError = null;
    if (!kv) {
      state = newGame(clock, content);
      epoch++;
      phase = 'playing';
      begin();
      touch();
      return;
    }
    try {
      const loaded = await loadGame(kv, clock, content, rules);
      state = loaded.state;
      epoch++;
      rev = loaded.rev;
      report = loaded.report;
      await refreshBackupFlag();
      phase = 'playing';
      begin();
      touch();
      void requestPersistentStorage();
    } catch (error) {
      halt();
      loadError =
        error instanceof LoadError
          ? { message: error.message, raw: error.raw, reason: error.reason }
          : {
              message: error instanceof Error ? error.message : String(error),
              raw: null,
              reason: 'core' as const,
            };
      phase = 'error';
    }
  }

  const onLost = () => {
    halt();
    phase = 'blocked';
    touch();
  };

  /** Takes the single-tab lock (unless another tab holds it), then loads the save and starts the loop. */
  async function start(): Promise<void> {
    if (lock && !(await lock.acquire(onLost))) {
      phase = 'blocked';
      return;
    }
    await boot();
  }

  return {
    get state(): GameState {
      void version;
      return state;
    },
    /**
     * Reads from the game state through the update counter and returns a copy of what `fn`
     * returns. Components use it inside `$derived`: the core changes its state in place, so a
     * derived value that handed back the same array or object would never reach its readers.
     */
    read<T>(fn: (state: GameState) => T): T {
      void version;
      return detachData(fn(state));
    },
    get version(): number {
      return version;
    },
    get report(): AnbuReport | null {
      return report;
    },
    /** The newest lines of the battle log, oldest first. */
    get combatLog(): LogEntry[] {
      void version;
      return log;
    },
    /** Happenings of this session that hints wait for. */
    get signals(): Signals {
      return signals;
    },
    /** Whether the graduation modal is due. */
    get graduation(): boolean {
      return graduation;
    },
    get phase(): Phase {
      return phase;
    },
    get ready(): boolean {
      return phase === 'playing';
    },
    get saveStatus(): SaveStatus {
      return saveStatus;
    },
    /** Why the save could not be read, and its raw text for export. */
    get loadError() {
      return loadError;
    },
    /** Whether a previous save is kept for «Відновити». */
    get hasBackup(): boolean {
      return hasBackup;
    },
    content,
    rules,
    /** The manifests of the packs this game was composed from, in load order. */
    packs,
    /** The packs the core left out, with the reason. */
    failed,
    /** Rules of packs switched off during this session. */
    get ruleNotices(): readonly RuleNotice[] {
      return ruleNotices;
    },

    /** Sends a command to the core and refreshes the views. */
    dispatch(original: Command): CommandResult {
      let command = original;
      for (const hook of commandHooks) {
        const verdict = hook.before?.(command);
        if (verdict === false) {
          // Said once, here, so that every caller is covered: the tiles, the Now bar, the map, the fight.
          toasts.push({ key: 'error.cancelledByMod', params: {} });
          return { ok: false, reason: 'error.cancelledByMod' };
        }
        if (verdict) command = verdict;
      }
      const result = coreDispatch(state, command, content, rules);
      // After the command: a reveal it caused must not wait for the next update.
      epoch++;
      restamp();
      if (result.ok && command.type === 'action.start' && command.kind === 'fight') log = [];
      drainEvents();
      touch();
      if (result.ok && SAVE_NOW.has(command.type)) void save();
      for (const hook of commandHooks) hook.after?.(command, result);
      return result;
    },
    /** Adds a listener around commands; returns the function that removes it. */
    addCommandHook(hook: CommandHook): () => void {
      commandHooks.push(hook);
      return () => {
        const at = commandHooks.indexOf(hook);
        if (at >= 0) commandHooks.splice(at, 1);
      };
    },
    /** Calls `fn` for every event the core queues, as the queue is drained. */
    onEvent(fn: (event: GameEvent) => void): () => void {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    dismissGraduation(): void {
      graduation = false;
    },
    /** Developer tool: moves game time forward through `advance`, like waiting would. */
    devAdvance(ms: number): void {
      // Time that moves on changes the answers by itself (events, a new second); no time at all is how tests flush what they set by hand.
      if (ms === 0) epoch++;
      advance(state, ms, content, rules);
      drainEvents();
      touch();
    },
    dismissReport(): void {
      report = null;
    },
    tick,
    save: () => save(),
    start,
    /** Stops the loop and saving; releases the tab lock. */
    stop(): void {
      halt();
      lock?.release();
    },
    /** From the «another tab» screen: take the game over here. */
    async takeOver(): Promise<void> {
      if (lock) await lock.takeOver(onLost);
      await boot();
    },
    /** From the error screen: read the save again. */
    retry: boot,
    /** From the error screen, after confirmation: park the unreadable save and begin anew. */
    async startNewAfterError(): Promise<void> {
      if (kv) {
        try {
          if (loadError?.raw) await kv.set(BROKEN_SAVE_KEY, loadError.raw);
          await kv.del(SAVE_KEY);
        } catch {
          // The new game still starts; the first save writes a fresh entry.
        }
      }
      loadError = null;
      state = newGame(clock, content);
      epoch++;
      rev = 0;
      phase = 'playing';
      begin();
      touch();
      await save();
    },
    /** Replaces the whole state (tests). */
    replaceState,
    /** The save as base64 text. */
    exportText(): string {
      return exportSave(state, clock);
    },
    /** Reads pasted save text without changing anything. Throws when it is not a usable save. */
    previewImport(text: string): GameState {
      return importSave(text, content, rules);
    },
    /** Replaces the game with a pasted save, keeping the previous one as the backup. */
    async importText(text: string): Promise<void> {
      const next = importSave(text, content, rules);
      if (kv) await backupSave(kv);
      replaceState(next);
      await save(true);
      await refreshBackupFlag();
    },
    /** Begins a new game, keeping the previous save as the backup. */
    async reset(): Promise<void> {
      if (kv) await backupSave(kv);
      replaceState(newGame(clock, content));
      report = null;
      await save(true);
      await refreshBackupFlag();
    },
    /** Swaps the backup in; the game it replaces becomes the new backup. */
    async restoreBackup(): Promise<boolean> {
      if (!kv) return false;
      const previous = await readBackup(kv, content, rules);
      if (!previous) return false;
      await backupSave(kv);
      replaceState(previous);
      await save(true);
      await refreshBackupFlag();
      return true;
    },
  };
}

export type Game = ReturnType<typeof createGame>;
