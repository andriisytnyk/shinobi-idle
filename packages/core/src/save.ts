import {
  NATURE_IDS,
  SKILL_IDS,
  type ContentDb,
  type NatureId,
  type SkillId,
} from '@shinobi/content';
import { rebalanceShares } from './actions.ts';
import { parseFight } from './combat/fight-parse.ts';
import { secMs } from './combat/numbers.ts';
import { FIGHT_KIND, newCombat } from './combat/system.ts';
import type { CombatState } from './combat/types.ts';
import { workOf } from './combat/units.ts';
import type { EntityKind } from './entity.ts';
import { emit } from './events.ts';
import { MS_PER_HOUR, MS_PER_SECOND, masteryLevel, poolCapacity } from './formulas.ts';
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
import { updateQuests } from './quests.ts';
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
  // v3 -> v4: counters, quest progress, the running fight and the pinned goal.
  (state) => ({ ...state, counters: {}, quests: {}, combat: null, goal: null }),
  // v4 -> v5: running tonics, owned training gear and herb bushes.
  (state) => ({ ...state, buffs: {}, gear: {}, bushes: {} }),
  // v5 -> v6: the fight became a self-contained fight state; an old fight in progress restarts.
  (state) => ({ ...state, combat: null }),
];

/** Deepest nesting a slot's data may have. */
const JSON_DEPTH = 6;

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
/** Whether a value is plain JSON of modest depth (what a slot may keep); anything else is dropped. */
function isJson(x: unknown, depth: number): x is JsonValue {
  if (x === null || typeof x === 'string' || typeof x === 'boolean') return true;
  if (typeof x === 'number') return Number.isFinite(x);
  if (depth >= JSON_DEPTH) return false;
  if (Array.isArray(x)) return x.every((v) => isJson(v, depth + 1));
  return isRecord(x) && Object.values(x).every((v) => isJson(v, depth + 1));
}

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
      slot.data = isJson(raw.data, 0) ? raw.data : null;
    } else {
      lost = { kind: action.kind, id: action.id };
    }
  }
  return { slot, lost };
}

/** A saved fight, checked field by field; null when it is not a usable fight. */
function sanitizeCombat(raw: unknown, content: ContentDb): CombatState | null {
  if (!isRecord(raw) || typeof raw.enemy !== 'string') return null;
  const enemy = indexOf(content).enemies.get(raw.enemy);
  if (!enemy) return null;
  const fight = parseFight(raw.fight, content);
  if (!fight || fight.enemy !== enemy.id) return null;
  const respawn = raw.phase === 'respawn';
  // A won fight waits out the pause; a fight in progress cannot be decided yet.
  const rewarded = fight.result === 'victory' || fight.result === 'fled';
  if (respawn !== rewarded || fight.result === 'defeat' || fight.result === 'timeout') return null;
  const K = content.balance.K;
  const horizon = workOf(MS_PER_HOUR);
  const paid = pick(raw.paid, (key, v) =>
    indexOf(content).techniques.has(key) && typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? v
      : undefined,
  );
  const style = fight.tally.style;
  return {
    enemy: enemy.id,
    phase: respawn ? 'respawn' : 'fight',
    fight,
    work: Math.min(horizon, Math.floor(nonNegative(raw.work))),
    pause: Math.min(workOf(secMs(K.respawn)), Math.floor(nonNegative(raw.pause))),
    paid,
    carry: Math.min(horizon, Math.floor(nonNegative(raw.carry))),
    style: SKILL_ID_SET.has(String(raw.style)) ? (raw.style as SkillId) : style,
  };
}

const SKILL_ID_SET: ReadonlySet<string> = new Set(SKILL_IDS);

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
  state.counters = pick(raw.counters, (_key, v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined,
  );
  state.quests = pick(raw.quests, (key, v) => {
    const quest = index.quests.get(key);
    if (!quest || !isRecord(v)) return undefined;
    const step = Math.min(Math.floor(nonNegative(v.step)), quest.steps.length);
    return { step, base: Math.floor(nonNegative(v.base)), done: step >= quest.steps.length };
  });
  state.buffs = pick(raw.buffs, (key, v) => {
    const fx = index.items.get(key)?.fx;
    if (fx?.kind !== 'tonic' || !isRecord(v)) return undefined;
    const cap = fx.charges * content.balance.K.tonic.capMult;
    const charges = Math.min(Math.floor(nonNegative(v.charges)), cap);
    return charges >= 1 ? { skill: fx.skill, charges } : undefined;
  });
  state.gear = pick(raw.gear, (key, v) => {
    const line = index.gear.get(key);
    if (!line || typeof v !== 'number') return undefined;
    const tiers = Math.min(Math.floor(nonNegative(v)), line.tiers.length);
    return tiers >= 1 ? tiers : undefined;
  });
  state.bushes = pick(raw.bushes, (key, v) => {
    if (!index.herbs.has(key) || !isRecord(v)) return undefined;
    const K = content.balance.K;
    const size = Math.floor(nonNegative(v.size));
    if (size < 1 || size > K.field.stockBase + masteryLevel(state, key, content)) return undefined;
    const stock = Math.min(Math.floor(nonNegative(v.stock)), size);
    const room = (K.field.regrowMs + K.gather * MS_PER_SECOND) * SHARE_FULL;
    const carry = stock === 0 ? Math.min(Math.floor(nonNegative(v.carry)), room) : 0;
    return { stock, size, carry };
  });
  const goal = raw.goal;
  state.goal =
    isRecord(goal) && typeof goal.kind === 'string' && typeof goal.id === 'string'
      ? (goal as { kind: EntityKind; id: string })
      : null;

  refreshUnlocks(state, content, true);
  // Shares are derived from which slots run, so they are recomputed rather than trusted; a
  // saved progress beyond one cycle is cut so a doctored save cannot make the loop spin.
  rebalanceShares(state);
  for (const [at, slot] of state.slots.entries()) {
    const kind = slot.action && rules.actionKinds[slot.action.kind];
    if (slot.action && kind) {
      slot.progress = Math.min(
        slot.progress,
        kind.intervalMs(state, slot.action.id, content, rules, at) * SHARE_FULL,
      );
    }
  }
  // A fight needs both its slot and its state; either one alone is dropped or rebuilt.
  const fighting = state.slots.some((s) => s.action?.kind === FIGHT_KIND);
  state.combat = fighting ? sanitizeCombat(raw.combat, content) : null;
  if (fighting && !state.combat) {
    for (const slot of state.slots) {
      if (slot.action?.kind === FIGHT_KIND) {
        const enemy = indexOf(content).enemies.get(slot.action.id);
        if (enemy) state.combat = newCombat(state, enemy, content, rules);
      }
    }
  }
  updateQuests(state, content);
  return state;
}
