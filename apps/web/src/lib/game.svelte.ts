import { content as defaultContent, type ContentDb } from '@shinobi/content';
import {
  advance,
  advanceOffline,
  createState,
  defaultRules,
  dispatch as coreDispatch,
  type Command,
  type CommandResult,
  type GameState,
  type Rules,
} from '@shinobi/core';
import {
  buildReport,
  exportSave,
  importSave,
  loadGame,
  newGame,
  saveGame,
  SAVE_KEY,
  type AnbuReport,
  type Clock,
  type KeyValue,
} from './persistence.ts';
import { requestPersistentStorage } from './platform.ts';
import { toastFor, toasts as defaultToasts } from './toasts.svelte.ts';

/** How often the game loop runs. */
export const TICK_MS = 100;
/** How often the save is written. */
export const SAVE_EVERY_MS = 10_000;
/** A gap longer than this between two ticks means the tab slept: catch up through the offline path. */
export const SLEEP_GAP_MS = 5_000;

export type SaveStatus = 'idle' | 'saved' | 'error';

export interface GameDeps {
  content?: ContentDb;
  rules?: Rules;
  clock?: Clock;
  kv?: KeyValue;
  toasts?: Pick<typeof defaultToasts, 'push'>;
}

/**
 * The reactive game store. The state is plain JSON mutated in place by the core; the `version`
 * counter is what the UI subscribes to: reading `state` reads the counter, so anything that uses
 * the state re-runs after every tick.
 */
export function createGame(deps: GameDeps = {}) {
  const content = deps.content ?? defaultContent;
  const rules = deps.rules ?? defaultRules;
  const clock = deps.clock ?? { now: () => 0 };
  const kv = deps.kv ?? null;
  const toasts = deps.toasts ?? defaultToasts;

  let state = $state.raw<GameState>(createState(1, content));
  let version = $state(0);
  let report = $state.raw<AnbuReport | null>(null);
  let ready = $state(false);
  let saveStatus = $state<SaveStatus>('idle');
  let brokenSave = $state(false);

  let lastWall = clock.now();
  let timers: number[] = [];
  let detach: (() => void) | null = null;

  const touch = () => {
    version++;
  };

  /** Turns the events the core queued into toasts and empties the queue. */
  function drainEvents(): void {
    const events = state.events;
    if (events.length === 0) return;
    state.events = [];
    for (const event of events) {
      const spec = toastFor(event);
      if (spec) toasts.push(spec);
    }
  }

  /** One pass of the loop: move the game to the wall clock, through the offline path after a sleep. */
  function tick(): void {
    const now = clock.now();
    const delta = Math.floor(now - lastWall);
    if (delta <= 0) return;
    lastWall += delta;
    if (delta > SLEEP_GAP_MS) {
      const summary = advanceOffline(state, delta, content, rules);
      const next = buildReport(summary);
      if (next) report = next;
    } else {
      advance(state, delta, content, rules);
    }
    drainEvents();
    touch();
  }

  async function save(): Promise<void> {
    if (!kv) return;
    try {
      await saveGame(kv, clock, state);
      saveStatus = 'saved';
    } catch {
      saveStatus = 'error';
    }
  }

  function replaceState(next: GameState): void {
    state = next;
    lastWall = clock.now();
    touch();
  }

  /** Loads the save, catches up, starts the loop and the save triggers. */
  async function start(): Promise<void> {
    try {
      if (!kv) throw new Error('no storage');
      const loaded = await loadGame(kv, clock, content, rules);
      state = loaded.state;
      report = loaded.report;
      brokenSave = loaded.broken;
    } catch {
      // Storage is unavailable (for example a private window): play on without saving.
      state = newGame(clock, content);
      if (kv) saveStatus = 'error';
    }
    lastWall = clock.now();
    ready = true;
    touch();
    void requestPersistentStorage();

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

  function stop(): void {
    for (const id of timers) window.clearInterval(id);
    timers = [];
    detach?.();
    detach = null;
  }

  return {
    get state(): GameState {
      void version;
      return state;
    },
    get version(): number {
      return version;
    },
    get report(): AnbuReport | null {
      return report;
    },
    get ready(): boolean {
      return ready;
    },
    get saveStatus(): SaveStatus {
      return saveStatus;
    },
    /** True when the stored save could not be read at start; it was kept under another key. */
    get brokenSave(): boolean {
      return brokenSave;
    },
    content,
    rules,

    /** Sends a command to the core and refreshes the views. */
    dispatch(command: Command): CommandResult {
      const result = coreDispatch(state, command, content, rules);
      drainEvents();
      touch();
      return result;
    },
    dismissReport(): void {
      report = null;
    },
    tick,
    save,
    start,
    stop,
    /** Replaces the whole state (tests, import). */
    replaceState,
    /** The save as base64 text. */
    exportText(): string {
      return exportSave(state, clock);
    },
    /** Replaces the game with a pasted save. Throws when the text is not a save. */
    async importText(text: string): Promise<void> {
      replaceState(importSave(text, content, rules));
      await save();
    },
    /** Deletes the save and begins a new game. */
    async reset(): Promise<void> {
      if (kv) await kv.del(SAVE_KEY);
      replaceState(newGame(clock, content));
      report = null;
      await save();
    },
  };
}

export type Game = ReturnType<typeof createGame>;
