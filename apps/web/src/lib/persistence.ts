import type { ContentDb, SkillId } from '@shinobi/content';
import {
  advanceOffline,
  createState,
  defaultRules,
  deserialize,
  readSavedAt,
  serialize,
  type ActionStoppedEvent,
  type GameState,
  type OfflineSummary,
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
}

export const SAVE_KEY = 'save';
/** A save that could not be read is parked here instead of being overwritten. */
export const BROKEN_SAVE_KEY = 'save.broken';

/** What «Звіт АНБУ» shows after the game was closed or asleep. */
export interface AnbuReport {
  requestedMs: number;
  simulatedMs: number;
  capped: boolean;
  skills: { skill: SkillId; xp: number; levels: number }[];
  mastery: { key: string; levels: number }[];
  techniques: string[];
  stopped: ActionStoppedEvent[];
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
    summary.actionsStopped.length === 0;
  if (summary.requestedMs < REPORT_MIN_MS || quiet) return null;
  return {
    requestedMs: summary.requestedMs,
    simulatedMs: summary.simulatedMs,
    capped: summary.capped,
    skills,
    mastery,
    techniques: summary.techniquesLearned,
    stopped: summary.actionsStopped,
  };
}

export interface LoadResult {
  state: GameState;
  /** The engine's account of the away time; null for a new game. */
  summary: OfflineSummary | null;
  report: AnbuReport | null;
  /** True when a save existed but could not be read; it was parked, not deleted. */
  broken: boolean;
}

/** A new game, seeded from the wall clock so each player gets their own random streams. */
export function newGame(clock: Clock, content: ContentDb): GameState {
  return createState(Math.floor(clock.now()) % 0x7fffffff, content);
}

/** Loads the save and catches the game up to the wall clock; starts a new game if there is none. */
export async function loadGame(
  kv: KeyValue,
  clock: Clock,
  content: ContentDb,
  rules: Rules = defaultRules,
): Promise<LoadResult> {
  const text = await kv.get(SAVE_KEY);
  if (text === undefined) {
    return { state: newGame(clock, content), summary: null, report: null, broken: false };
  }
  try {
    const state = deserialize(text, content, rules);
    const savedAt = readSavedAt(text);
    const elapsed = Math.max(0, clock.now() - savedAt);
    const summary = advanceOffline(state, elapsed, content, rules);
    return { state, summary, report: buildReport(summary), broken: false };
  } catch {
    await kv.set(BROKEN_SAVE_KEY, text);
    return { state: newGame(clock, content), summary: null, report: null, broken: true };
  }
}

/** Writes the state with the current wall-clock time as `savedAt`. */
export async function saveGame(kv: KeyValue, clock: Clock, state: GameState): Promise<void> {
  await kv.set(SAVE_KEY, serialize(state, Math.floor(clock.now())));
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

/** Reads base64 save text. Throws when the text is not a save. */
export function importSave(
  b64: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): GameState {
  return deserialize(fromBase64(b64), content, rules);
}
