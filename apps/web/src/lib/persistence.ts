import type { ContentDb, SkillId } from '@shinobi/content';
import {
  advanceOffline,
  createState,
  defaultRules,
  deserialize,
  readSavedAt,
  serialize,
  STATE_VERSION,
  type ActionStoppedEvent,
  type CloneDispelledEvent,
  type GameState,
  type OfflineSummary,
  type RaidAway,
  type Rules,
} from '@shinobi/core';

/** Wall-clock time in ms. Injected so tests can run a fake clock. */
export interface Clock {
  now(): number;
}

/** The slice of IndexedDB the game needs. */
export interface KeyValue {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  /** Reads and writes one key in a single transaction; `fn` gets the old value and returns the new one. */
  update(key: string, fn: (old: string | undefined) => string | undefined): Promise<void>;
}

export const SAVE_KEY = 'save';
/** A save that could not be read is parked here instead of being overwritten. */
export const BROKEN_SAVE_KEY = 'save.broken';
/** The save as it was before an import, a reset, a restore or an upgrade of the format. */
export const BACKUP_KEY = 'save.backup';

/** The list of the backups made before a save was upgraded: `[{ key, v, at }]`, newest first. */
export const BACKUPS_INDEX_KEY = 'save.backups';
/** How many such backups are kept. */
export const BACKUPS_KEEP = 3;

/** A copy of a save as it was before its format was upgraded. */
export interface BackupEntry {
  /** The storage key of the raw text; carries the version of the save: `save.backup.v14.<time>`. */
  key: string;
  /** The version of the format the save had. */
  v: number;
  /** Wall-clock time of the copy, ms. */
  at: number;
}

/** What «Звіт АНБУ» shows after the game was closed or asleep. */
export interface AnbuReport {
  requestedMs: number;
  simulatedMs: number;
  capped: boolean;
  skills: { skill: SkillId; xp: number; levels: number }[];
  mastery: { key: string; levels: number }[];
  techniques: string[];
  stopped: ActionStoppedEvent[];
  /** The clones dispelled while away: whose, why, and the XP each handed over. */
  dispelled?: CloneDispelledEvent[];
  /** Raids that arrived or ended while away. */
  raids: RaidAway[];
}

/** An absence shorter than this is applied without a report. */
export const REPORT_MIN_MS = 60_000;

/** Turns the engine's summary into the report; null when there is nothing worth showing. */
export function buildReport(summary: OfflineSummary): AnbuReport | null {
  const skills = (Object.keys(summary.skillXp) as SkillId[]).map((skill) => ({
    skill,
    xp: summary.skillXp[skill] ?? 0,
    levels: summary.levelsGained[skill] ?? 0,
  }));
  const mastery = Object.entries(summary.masteryLevelsGained).map(([key, levels]) => ({
    key,
    levels,
  }));
  const quiet =
    skills.length === 0 &&
    mastery.length === 0 &&
    summary.techniquesLearned.length === 0 &&
    summary.actionsStopped.length === 0 &&
    (summary.clonesDispelled ?? []).length === 0 &&
    (summary.raids ?? []).length === 0;
  if (summary.requestedMs < REPORT_MIN_MS || quiet) return null;
  return {
    requestedMs: summary.requestedMs,
    simulatedMs: summary.simulatedMs,
    capped: summary.capped,
    skills,
    mastery,
    techniques: summary.techniquesLearned,
    stopped: summary.actionsStopped,
    dispelled: summary.clonesDispelled ?? [],
    raids: summary.raids ?? [],
  };
}

export interface LoadResult {
  state: GameState;
  /** The engine's account of the away time; null for a new game. */
  summary: OfflineSummary | null;
  report: AnbuReport | null;
  /** Revision of the stored save this state was loaded from; 0 for a new game. */
  rev: number;
}

/** A save that exists but could not be read. Nothing is overwritten when this is thrown. */
export class LoadError extends Error {
  /** The stored text as it is, for export; null when even reading it failed. */
  readonly raw: string | null;
  /** What the player is told; the message is the technical detail. */
  readonly reason: LoadReason;
  constructor(message: string, raw: string | null, reason: LoadReason = 'core') {
    super(message);
    this.name = 'LoadError';
    this.raw = raw;
    this.reason = reason;
  }
}

/** A new game, seeded from the wall clock so each player gets their own random streams. */
export function newGame(clock: Clock, content: ContentDb): GameState {
  return createState(Math.floor(clock.now()) % 0x7fffffff, content);
}

// ---------- stored form: a revision around the core's save text ----------

interface Stored {
  rev: number;
  text: string;
}

/** What goes into IndexedDB: the core's save text plus a revision that only ever grows. */
export function encodeStored(rev: number, text: string): string {
  return JSON.stringify({ rev, save: text });
}

/** Reads the stored form; a bare save text from before revisions counts as revision 0. */
export function decodeStored(raw: string): Stored {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'save' in parsed) {
      const { rev, save } = parsed as { rev?: unknown; save?: unknown };
      if (typeof save === 'string') {
        return { rev: typeof rev === 'number' && rev >= 0 ? Math.floor(rev) : 0, text: save };
      }
    }
  } catch {
    // Fall through: not the wrapped form.
  }
  return { rev: 0, text: raw };
}

/** Why a save could not be read: the key of the text the player sees (the technical message is kept apart). */
export type LoadReason = 'notJson' | 'noState' | 'core';

/**
 * Rejects a text that is not a save at all: it must be JSON with a version and a state object. What
 * the state holds is for the core loader to judge with the composed content and rules: a save made
 * while a pack was absent lacks that pack's data, which the loader initialises.
 */
export function assertSaneSave(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new LoadError(error instanceof Error ? error.message : String(error), text, 'notJson');
  }
  const save =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  if (typeof save.v !== 'number' || typeof save.state !== 'object' || save.state === null) {
    throw new LoadError('The text has no version or state', text, 'noState');
  }
}

/** Keeps the stored save as the one-generation backup. Does nothing when there is no save. */
export async function backupSave(kv: KeyValue): Promise<void> {
  const raw = await kv.get(SAVE_KEY);
  if (raw !== undefined) await kv.set(BACKUP_KEY, raw);
}

/** Looks at the state around the offline catch-up of a load (the local telemetry does). */
export interface CatchUpWatch {
  before(state: GameState): void;
  after(state: GameState, summary: OfflineSummary): void;
}

/** The backups kept before upgrades, newest first; an unreadable index counts as none. */
export async function listBackups(kv: KeyValue): Promise<BackupEntry[]> {
  try {
    const raw = await kv.get(BACKUPS_INDEX_KEY);
    if (raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is BackupEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as BackupEntry).key === 'string' &&
          typeof (e as BackupEntry).v === 'number' &&
          typeof (e as BackupEntry).at === 'number',
      )
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/**
 * Keeps the raw stored text of a save of an older format, before it is upgraded. The last
 * `BACKUPS_KEEP` copies stay; the same text is not kept twice (a retried load adds nothing).
 */
export async function addBackup(
  kv: KeyValue,
  raw: string,
  v: number,
  at: number,
): Promise<BackupEntry> {
  const known = await listBackups(kv);
  for (const entry of known) {
    if (entry.v === v && (await kv.get(entry.key)) === raw) return entry;
  }
  const entry: BackupEntry = { key: `save.backup.v${v}.${Math.floor(at)}`, v, at };
  // The text goes in first: an index never points at a copy that is not there.
  await kv.set(entry.key, raw);
  const next = [entry, ...known.filter((e) => e.key !== entry.key)];
  await kv.set(BACKUPS_INDEX_KEY, JSON.stringify(next.slice(0, BACKUPS_KEEP)));
  for (const old of next.slice(BACKUPS_KEEP)) await kv.del(old.key);
  return entry;
}

/** The text of a save (stored or bare) as base64, for copying out of the app. */
export function exportRaw(raw: string): string {
  return toBase64(decodeStored(raw).text);
}

/** Loads the save and catches the game up to the wall clock; starts a new game if there is none. */
export async function loadGame(
  kv: KeyValue,
  clock: Clock,
  content: ContentDb,
  rules: Rules = defaultRules,
  watch?: CatchUpWatch,
): Promise<LoadResult> {
  let raw: string | undefined;
  try {
    raw = await kv.get(SAVE_KEY);
  } catch (error) {
    throw new LoadError(error instanceof Error ? error.message : String(error), null);
  }
  if (raw === undefined) {
    return { state: newGame(clock, content), summary: null, report: null, rev: 0 };
  }
  try {
    const stored = decodeStored(raw);
    assertSaneSave(stored.text);
    // An older format is upgraded on load: its text is kept first, whatever the upgrade does.
    const version = (JSON.parse(stored.text) as { v: number }).v;
    if (version < STATE_VERSION) {
      try {
        await addBackup(kv, raw, version, clock.now());
      } catch (error) {
        // The old save stays in place until the first save; a full disk must not lock the game.
        console.warn('Could not back up the save before upgrading it', error);
      }
    }
    const state = deserialize(stored.text, content, rules);
    const elapsed = Math.max(0, clock.now() - readSavedAt(stored.text));
    watch?.before(state);
    const summary = advanceOffline(state, elapsed, content, rules);
    watch?.after(state, summary);
    return { state, summary, report: buildReport(summary), rev: stored.rev };
  } catch (error) {
    if (error instanceof LoadError) throw new LoadError(error.message, raw, error.reason);
    throw new LoadError(error instanceof Error ? error.message : String(error), raw);
  }
}

export type SaveResult = { ok: true; rev: number } | { ok: false; reason: 'stale' };

/**
 * Writes the state with the current wall-clock time as `savedAt` and the next revision. The write
 * is one IndexedDB transaction that refuses when the stored revision is higher than `rev`, i.e.
 * when another tab or an earlier session saved something newer. `force` (import, reset, restore)
 * writes anyway, still above the stored revision.
 */
export async function saveGame(
  kv: KeyValue,
  clock: Clock,
  state: GameState,
  rev: number,
  force = false,
): Promise<SaveResult> {
  const text = serialize(state, Math.floor(clock.now()));
  let result: SaveResult = { ok: false, reason: 'stale' };
  await kv.update(SAVE_KEY, (old) => {
    const storedRev = old === undefined ? 0 : decodeStored(old).rev;
    if (storedRev > rev && !force) return old;
    const next = Math.max(storedRev, rev) + 1;
    result = { ok: true, rev: next };
    return encodeStored(next, text);
  });
  return result;
}

/** Reads the one-generation backup into a state; null when there is none or it cannot be read. */
export async function readBackup(
  kv: KeyValue,
  content: ContentDb,
  rules: Rules = defaultRules,
): Promise<GameState | null> {
  const raw = await kv.get(BACKUP_KEY);
  if (raw === undefined) return null;
  try {
    const { text } = decodeStored(raw);
    assertSaneSave(text);
    return deserialize(text, content, rules);
  } catch {
    return null;
  }
}

// ---------- export and import ----------

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\s+/g, ''));
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  );
}

/** The save as base64 text, for copying out of the app. */
export function exportSave(state: GameState, clock: Clock): string {
  return toBase64(serialize(state, Math.floor(clock.now())));
}

/** Reads base64 save text. Throws when the text is not a save or its state is empty. */
export function importSave(
  b64: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): GameState {
  const text = fromBase64(b64);
  assertSaneSave(text);
  return deserialize(text, content, rules);
}
