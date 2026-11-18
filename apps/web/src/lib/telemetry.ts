import type { ContentDb } from '@shinobi/content';
import {
  foldEvents,
  newTelemetry,
  noteOffline,
  observeState,
  parseTelemetry,
  serializeTelemetry,
  sessionBeat,
  sessionStart,
  snapshotForTelemetry,
  type GameEvent,
  type GameState,
  type OfflineSummary,
  type TelemetryRecord,
  type TelemetrySnapshot,
} from '@shinobi/core';
import type { Clock, KeyValue } from './persistence.ts';

/**
 * Local telemetry of the web layer: keeps the record next to the save, folds the game into it and
 * produces the file for export. It reads the wall clock (through `clock`) for session and
 * milestone times, which the core never does. Nothing here touches the network: the record leaves
 * the device only when the player exports the file.
 */

/** Its own key, apart from the save: clearing or losing one does not touch the other. */
export const TELEMETRY_KEY = 'telemetry';

/** The `format` field of the exported file. */
export const TELEMETRY_FORMAT = 'shinobi-telemetry';

export interface TelemetryDeps {
  clock: Clock;
  kv: KeyValue | null;
  content: ContentDb;
  /** Whether recording is on; read at every step, so the toggle works at once. */
  enabled: () => boolean;
}

export interface TelemetryFile {
  format: typeof TELEMETRY_FORMAT;
  /** Real time of the export. */
  exportedAt: number;
  /** Where the game stood at the export, and what it was made with. */
  game: {
    now: number;
    rank: string;
    stateVersion: number;
    packs: { id: string; version: string }[];
  };
  record: TelemetryRecord;
}

export function createTelemetry(deps: TelemetryDeps) {
  const { clock, kv, content } = deps;
  let rec: TelemetryRecord = newTelemetry(Math.floor(clock.now()));
  let prev: TelemetrySnapshot | null = null;
  let dirty = false;

  const real = (): number => Math.floor(clock.now());

  return {
    /** The record as it is now. */
    get record(): TelemetryRecord {
      return rec;
    },

    /** Reads the stored record; a missing or unreadable one gives a new record. */
    async load(): Promise<void> {
      rec = newTelemetry(real());
      if (!kv) return;
      try {
        const text = await kv.get(TELEMETRY_KEY);
        const stored = text === undefined ? null : parseTelemetry(text);
        if (stored) rec = stored;
      } catch {
        // A record that cannot be read is replaced by a new one; the game does not depend on it.
      }
    },

    /** A session begins with this state (after a load or a new game). */
    start(state: GameState): void {
      prev = snapshotForTelemetry(state, content);
      if (!deps.enabled()) return;
      sessionStart(rec, real(), state.now);
      dirty = true;
    },

    /** Called before the offline catch-up of a load or of a sleep: takes the snapshot with counters. */
    beforeCatchUp(state: GameState): void {
      prev = snapshotForTelemetry(state, content, true);
    },

    /** Called after the catch-up; folds what it did into the record. */
    afterCatchUp(state: GameState, summary: OfflineSummary): void {
      if (!deps.enabled() || !prev) {
        prev = snapshotForTelemetry(state, content);
        return;
      }
      if (summary.requestedMs > 0) {
        noteOffline(rec, real(), summary.requestedMs, summary.simulatedMs);
      }
      observeState(rec, prev, state, content, real(), true);
      prev = snapshotForTelemetry(state, content);
      dirty = true;
    },

    /** Events drained from the game. Call before `observe` of the same step. */
    fold(events: readonly GameEvent[]): void {
      if (!deps.enabled() || events.length === 0) return;
      foldEvents(rec, events, real());
      dirty = true;
    },

    /** After a step of the game: time, money and the session's end. */
    observe(state: GameState): void {
      const on = deps.enabled();
      const before = prev;
      prev = snapshotForTelemetry(state, content);
      if (!on || !before) return;
      observeState(rec, before, state, content, real(), false);
      sessionBeat(rec, real(), state.now);
      dirty = true;
    },

    /** Writes the record when it changed. Never throws. */
    async save(): Promise<void> {
      if (!kv || !dirty) return;
      try {
        await kv.set(TELEMETRY_KEY, serializeTelemetry(rec));
        dirty = false;
      } catch {
        // Storage trouble loses telemetry only.
      }
    },

    /** Empties the record (a new game, or the player's wish); a session goes on if `state` is given. */
    async clear(state?: GameState): Promise<void> {
      rec = newTelemetry(real());
      prev = state ? snapshotForTelemetry(state, content) : null;
      if (state && deps.enabled()) sessionStart(rec, real(), state.now);
      dirty = false;
      if (!kv) return;
      try {
        await kv.del(TELEMETRY_KEY);
        if (state && deps.enabled()) await kv.set(TELEMETRY_KEY, serializeTelemetry(rec));
      } catch {
        // Nothing to do: the next save writes the record again.
        dirty = true;
      }
    },

    /** The file the player exports: the record with a little about the game it came from. */
    file(state: GameState): TelemetryFile {
      return {
        format: TELEMETRY_FORMAT,
        exportedAt: real(),
        game: {
          now: state.now,
          rank: state.player.rank,
          stateVersion: state.v,
          packs: state.packs.map((p) => ({ id: p.id, version: p.version })),
        },
        record: rec,
      };
    },
  };
}

export type Telemetry = ReturnType<typeof createTelemetry>;

/** The name of the exported file: `shinobi-telemetry-2026-11-18.json`. */
export function telemetryFileName(realMs: number): string {
  return `shinobi-telemetry-${new Date(realMs).toISOString().slice(0, 10)}.json`;
}
