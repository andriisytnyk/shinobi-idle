import { NATURE_IDS, type ContentDb, type NatureId, type SkillId } from '@shinobi/content';
import { rebalanceShares } from './actions.ts';
import { emit } from './events.ts';
import { poolCapacity } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { RANK_ORDER } from './requirements.ts';
import { STREAM_NAMES } from './rng.ts';
import { defaultRules, type Rules } from './rules.ts';
import {
  createState,
  SHARE_FULL,
  STATE_VERSION,
  type ActionSlot,
  type GameState,
  type JsonValue,
} from './state.ts';
import { refreshUnlocks } from './unlocks.ts';
import { xpAt } from './xp.ts';

type Raw = Record<string, unknown>;

/** Turns a state of version `n` into version `n + 1`. `MIGRATIONS[0]` upgrades v1 to v2. */
export type Migration = (state: Raw) => Raw;

export const MIGRATIONS: readonly Migration[] = [
  // v1 -> v2: the completed-cycles counter.
  (state) => ({ ...state, stats: { completed: 0 } }),
  // v2 -> v3: slot share and progress become whole numbers (thousandths, ms x 1000); slots get `data`.
  (state) => ({
    ...state,
    slots: Array.isArray(state.slots)
      ? state.slots.map((s: unknown) =>
          isRecord(s)
            ? {
                ...s,
                share: Math.round(nonNegative(s.share) * SHARE_FULL),
                progress: Math.round(nonNegative(s.progress) * SHARE_FULL),
                data: null,
              }
            : s,
        )
      : state.slots,
  }),
];

const isRecord = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x);
const nonNegative = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;

function sortKeys(_key: string, value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The save text: `{ v, savedAt, state }` with every object's keys sorted, so equal states give
 * identical bytes. `savedAt` is wall-clock time supplied by the platform adapter. Events are not saved.
 */
export function serialize(state: GameState, savedAt = 0): string {
  const { events: _events, ...persisted } = state;
  return JSON.stringify({ v: state.v, savedAt, state: persisted }, sortKeys);
}

function parseEnvelope(text: string): { v: number; savedAt: number; state: Raw } {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !isRecord(parsed.state)) throw new Error('Save is not a game save');
  const v = parsed.v;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
    throw new Error('Save has no version');
  if (v > STATE_VERSION) throw new Error(`Save version ${v} is newer than ${STATE_VERSION}`);
  return { v, savedAt: nonNegative(parsed.savedAt), state: parsed.state };
}

/** The wall-clock time stored in a save text. */
export function readSavedAt(text: string): number {
  return parseEnvelope(text).savedAt;
}

function pick<T>(
  source: unknown,
  valid: (key: string, value: unknown) => T | undefined,
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    const checked = valid(key, value);
    if (checked !== undefined) out[key] = checked;
  }
  return out;
}

/** Cleans one saved slot. `lost` names an action that the rule set or content no longer has. */
function sanitizeSlot(
  raw: unknown,
  content: ContentDb,
  rules: Rules,
): { slot: ActionSlot; lost: { kind: string; id: string } | null } {
  const slot: ActionSlot = { action: null, progress: 0, share: 0, data: null };
  let lost: { kind: string; id: string } | null = null;
  if (!isRecord(raw)) return { slot, lost };
  const action = raw.action;
  if (isRecord(action) && typeof action.kind === 'string' && typeof action.id === 'string') {
    if (rules.actionKinds[action.kind]?.has(action.id, content)) {
      slot.action = { kind: action.kind, id: action.id };
      slot.progress = Math.floor(nonNegative(raw.progress));
      slot.data = (raw.data ?? null) as JsonValue;
    } else {
      lost = { kind: action.kind, id: action.id };
    }
  }
  return { slot, lost };
}

/**
 * Reads a save text, migrating old versions. Ids that the content no longer knows are dropped
 * and numbers are clamped to what the rules allow; only a text that is not a save at all throws.
 */
export function deserialize(
  text: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): GameState {
  const envelope = parseEnvelope(text);
  let raw = envelope.state;
  for (let v = envelope.v; v < STATE_VERSION; v++) {
    const migrate = MIGRATIONS[v - 1];
    if (!migrate) throw new Error(`No migration from version ${v}`);
    raw = migrate(raw);
  }

  const state = createState(0, content);
  const index = indexOf(content);
  const cap = content.balance.K.cap;

  if (Number.isInteger(raw.now) && (raw.now as number) >= 0) state.now = raw.now as number;

  const streams = isRecord(raw.rng) ? raw.rng : {};
  for (const name of STREAM_NAMES) {
    const s = streams[name];
    if (Array.isArray(s) && s.length === 4 && s.every((w) => Number.isInteger(w) && w >= 0)) {
      const w = s as number[];
      state.rng[name] = [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0, w[3] ?? 0];
    }
  }

  const player = raw.player;
  if (isRecord(player)) {
    if (typeof player.name === 'string') state.player.name = player.name;
    const rank = RANK_ORDER.find((r) => r === player.rank);
    if (rank) state.player.rank = rank;
    const natures: unknown[] = Array.isArray(player.natures) ? player.natures : [];
    state.player.natures = natures.filter(
      (n, i): n is NatureId =>
        (NATURE_IDS as readonly unknown[]).includes(n) && natures.indexOf(n) === i,
    );
  }

  const skillXp = isRecord(raw.skills) ? raw.skills : {};
  const poolXp = isRecord(raw.pools) ? raw.pools : {};
  for (const id of Object.keys(state.skills) as SkillId[]) {
    const skill = skillXp[id];
    if (isRecord(skill)) state.skills[id].xp = Math.min(nonNegative(skill.xp), xpAt(cap));
    const pool = poolXp[id];
    if (isRecord(pool))
      state.pools[id].xp = Math.min(nonNegative(pool.xp), poolCapacity(id, content));
  }

  state.mastery = pick(raw.mastery, (key, v) =>
    index.masteryKeys.has(key) && isRecord(v) ? { xp: nonNegative(v.xp) } : undefined,
  );
  state.bank = pick(raw.bank, (key, v) =>
    index.itemIds.has(key) && typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined,
  );
  if (isRecord(raw.currencies)) {
    state.currencies = {
      ryo: nonNegative(raw.currencies.ryo),
      rep: nonNegative(raw.currencies.rep),
      intel: nonNegative(raw.currencies.intel),
    };
  }
  state.known = pick(raw.known, (key) =>
    index.techniques.has(key) || index.recipeIds.has(key) ? (true as const) : undefined,
  );
  if (Array.isArray(raw.slots) && raw.slots.length > 0) {
    state.slots = [];
    raw.slots.forEach((s: unknown, i) => {
      const { slot, lost } = sanitizeSlot(s, content, rules);
      state.slots.push(slot);
      if (lost) emit(state, { type: 'actionStopped', slot: i, ...lost, reason: 'missing' });
    });
  }
  state.flags = pick(raw.flags, (_key, v) =>
    v === true || (typeof v === 'number' && Number.isFinite(v)) ? v : undefined,
  );
  if (isRecord(raw.stats)) state.stats.completed = Math.floor(nonNegative(raw.stats.completed));

  refreshUnlocks(state, content, true);
  // Shares are derived from which slots run, so they are recomputed rather than trusted; a
  // saved progress beyond one cycle is cut so a doctored save cannot make the loop spin.
  rebalanceShares(state);
  for (const slot of state.slots) {
    const kind = slot.action && rules.actionKinds[slot.action.kind];
    if (slot.action && kind) {
      slot.progress = Math.min(
        slot.progress,
        kind.intervalMs(state, slot.action.id, content, rules) * SHARE_FULL,
      );
    }
  }
  return state;
}
