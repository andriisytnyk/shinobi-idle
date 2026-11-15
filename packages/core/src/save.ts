import {
  NATURE_IDS,
  SKILL_IDS,
  type ContentDb,
  type NatureId,
  type SkillId,
} from '@shinobi/content';
import { rebalanceShares } from './actions.ts';
import { COURSE_ID, COURSE_KIND } from './athletics.ts';
import { tonicCharges } from './buffs.ts';
import { parseFight } from './combat/fight-parse.ts';
import { secMs } from './combat/numbers.ts';
import { pouchUse } from './combat/fight-items.ts';
import { loadoutLimits, syncLoadout } from './combat/loadout.ts';
import { ensurePouch } from './combat/pouch.ts';
import {
  FIGHT_KIND,
  OPERATION_KIND,
  isCombatKind,
  newCombat,
  newOperation,
} from './combat/system.ts';
import type { CombatState, LoadoutState, PouchState, RunState } from './combat/types.ts';
import { workOf } from './combat/units.ts';
import { woundIntervalMs } from './combat/wounds.ts';
import { entryOf, fightTarget, opSteps } from './combat/zones.ts';
import type { EntityKind } from './entity.ts';
import { emit } from './events.ts';
import { bushSize } from './field.ts';
import { MS_PER_HOUR, MS_PER_SECOND, poolCapacity } from './formulas.ts';
import { maxLevels, parseModRef } from './meditation.ts';
import { indexOf } from './lookup.ts';
import { teamFor } from './natures.ts';
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

/** Turns a state of version `n` into version `n + 1`. `MIGRATIONS[0]` upgrades v1 to v2. Content is there for ids that moved. */
export type Migration = (state: Raw, content: ContentDb) => Raw;

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
  // v6 -> v7: Meditation insights and the Athletics course. A running obstacle becomes a course
  // lap with that obstacle built where it stands (grandfathered, no price).
  (state, content) => {
    const obstacles = indexOf(content).obstacles;
    const course: Record<string, string> = {};
    const slots = Array.isArray(state.slots)
      ? state.slots.map((s: unknown) => {
          if (!isRecord(s) || !isRecord(s.action) || s.action.kind !== 'obstacle') return s;
          const obstacle = typeof s.action.id === 'string' ? obstacles.get(s.action.id) : undefined;
          if (!obstacle) return { ...s, action: null, progress: 0, data: null };
          course[`${obstacle.slot}`] = obstacle.id;
          return { ...s, action: { kind: COURSE_KIND, id: COURSE_ID } };
        })
      : state.slots;
    return { ...state, slots, meditation: {}, course };
  },
  // v7 -> v8: the team's natures follow from the native nature; a save that has one gets them,
  // every other genin has none yet and is led to the nature test.
  (state) => {
    const natures =
      isRecord(state.player) && Array.isArray(state.player.natures) ? state.player.natures : [];
    const native = NATURE_IDS.find((n) => n === natures[0]);
    return { ...state, team: native ? teamFor(native) : null };
  },
  // v8 -> v9: loadouts, the pouch, Wounds and what the player has seen. The fight carries a pouch,
  // technique effects and boss hooks now, so a fight in progress restarts; the loadout rebuilds itself.
  // A genin of an older save gets the medic pouch the graduation now gives.
  (state, content) => {
    const rank = isRecord(state.player) ? state.player.rank : 'student';
    const bank = isRecord(state.bank) ? { ...state.bank } : {};
    const medic = content.items.find((i) => i.medic !== undefined);
    if (medic && rank !== 'student' && typeof bank[medic.id] !== 'number') bank[medic.id] = 1;
    return {
      ...state,
      bank,
      combat: null,
      loadouts: { active: [], auto: true, signature: null, basis: '', saved: {} },
      pouch: { slots: [], medic: null },
      wounds: { stacks: 0, left: 0 },
      seen: {},
    };
  },
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
function sanitizeRun(
  raw: unknown,
  action: { kind: string; id: string },
  content: ContentDb,
): RunState | null | undefined {
  // A zone fight has no run, an operation always has one; `undefined` says the save is unusable.
  if (action.kind === FIGHT_KIND) return raw === null || raw === undefined ? null : undefined;
  const op = indexOf(content).operations.get(action.id);
  if (!op || !isRecord(raw) || raw.op !== op.id) return undefined;
  const step = raw.step;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0) return undefined;
  return step < opSteps(op).length ? { op: op.id, step } : undefined;
}

/** Whether an enemy id is one the run's step can have put in the fight. */
function stepAllows(run: RunState, enemy: string, content: ContentDb): boolean {
  const op = indexOf(content).operations.get(run.op);
  const step = op ? opSteps(op)[run.step] : undefined;
  if (!step || step.t === 'approach') return false;
  return step.t === 'fight' ? step.enemy === enemy : step.pool.includes(enemy);
}

function sanitizeCombat(
  raw: unknown,
  action: { kind: string; id: string },
  content: ContentDb,
): CombatState | null {
  if (!isRecord(raw) || typeof raw.enemy !== 'string') return null;
  const enemy = entryOf(content, raw.enemy);
  if (!enemy) return null;
  const run = sanitizeRun(raw.run, action, content);
  if (run === undefined) return null;
  if (run && !stepAllows(run, enemy.id, content)) return null;
  const fight = parseFight(raw.fight, content);
  if (!fight || !entryOf(content, fight.enemy)) return null;
  const phase = raw.phase === 'respawn' || raw.phase === 'approach' ? raw.phase : 'fight';
  // A won fight waits out the pause; a fight in progress or yet to begin cannot be decided.
  const rewarded = fight.result === 'victory' || fight.result === 'fled';
  if (
    (phase === 'respawn') !== rewarded ||
    fight.result === 'defeat' ||
    fight.result === 'timeout'
  ) {
    return null;
  }
  if (phase !== 'respawn' && fight.enemy !== enemy.id) return null;
  if (phase === 'approach' && (!run || fight.t !== 0)) return null;
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
    phase,
    fight,
    work: Math.min(horizon, Math.floor(nonNegative(raw.work))),
    pause: Math.min(
      workOf(Math.max(secMs(K.respawn), K.operation.approachMs)),
      Math.floor(nonNegative(raw.pause)),
    ),
    paid,
    carry: Math.min(horizon, Math.floor(nonNegative(raw.carry))),
    style: SKILL_ID_SET.has(String(raw.style)) ? (raw.style as SkillId) : style,
    run,
  };
}

/** A loadout read back: ids the content or the player no longer has are dropped. */
function sanitizeLoadouts(raw: unknown, state: GameState, content: ContentDb): LoadoutState {
  const out: LoadoutState = { active: [], auto: true, signature: null, basis: '', saved: {} };
  if (!isRecord(raw)) return out;
  const index = indexOf(content);
  const limits = loadoutLimits(RANK_ORDER.indexOf(state.player.rank), content);
  const natureOf = (id: string): string | null => {
    const skill = index.techniques.get(id)?.skill ?? '';
    return (NATURE_IDS as readonly string[]).includes(skill) ? skill : null;
  };
  /** The techniques the player knows, none out of the loadout, as many as the rank's slots and natures allow. */
  const ids = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    const natures = new Set<string>();
    for (const id of new Set(list.filter((x): x is string => typeof x === 'string'))) {
      const tech = index.techniques.get(id);
      if (!tech || tech.rank === null || tech.combat?.outOfLoadout || state.known[id] !== true) {
        continue;
      }
      const nature = natureOf(id);
      if (limits) {
        if (out.length >= limits.slots) break;
        if (nature && !natures.has(nature) && natures.size >= limits.natures) continue;
      }
      if (nature) natures.add(nature);
      out.push(id);
    }
    return out.slice(0, content.balance.K.loadout.slots.chunin);
  };
  out.auto = raw.auto !== false;
  out.active = ids(raw.active);
  out.signature =
    typeof raw.signature === 'string' && out.active.includes(raw.signature) ? raw.signature : null;
  out.basis = typeof raw.basis === 'string' ? raw.basis : '';
  if (isRecord(raw.saved)) {
    for (const [name, entry] of Object.entries(raw.saved)) {
      if (
        name.length < 1 ||
        name.length > content.balance.K.loadout.nameMax ||
        name in Object.prototype ||
        !isRecord(entry)
      )
        continue;
      if (Object.keys(out.saved).length >= content.balance.K.loadout.saved) break;
      const techniques = ids(entry.techniques);
      const sig =
        typeof entry.signature === 'string' && techniques.includes(entry.signature)
          ? entry.signature
          : null;
      out.saved[name] = { techniques, signature: sig };
    }
  }
  return out;
}

/** A pouch read back: only items that can ride in it, at most a stack each. */
function sanitizePouch(raw: unknown, content: ContentDb): PouchState {
  const out: PouchState = { slots: [], medic: null };
  if (!isRecord(raw) || !Array.isArray(raw.slots)) return out;
  const index = indexOf(content);
  const cap = content.balance.K.pouchStack;
  const most = content.balance.K.pouch.slots + content.balance.K.pouch.vest;
  for (const s of raw.slots.slice(0, most)) {
    const item = isRecord(s) && typeof s.id === 'string' ? index.items.get(s.id) : undefined;
    const n = isRecord(s) ? Math.floor(nonNegative(s.n)) : 0;
    out.slots.push(
      item && pouchUse(item) !== null ? { id: item.id, n: Math.min(cap, n) } : { id: '', n: 0 },
    );
  }
  const medic = raw.medic;
  if (typeof medic === 'number' && Number.isInteger(medic) && out.slots[medic]?.id)
    out.medic = medic;
  return out;
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
    raw = migrate(raw, content);
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
    state.player.natures = state.player.natures.slice(0, content.balance.K.natures.max);
    // The team's natures follow from the native nature alone, so they are recomputed, never trusted.
    const native = state.player.natures[0];
    state.team = native ? teamFor(native) : null;
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
  state.loadouts = sanitizeLoadouts(raw.loadouts, state, content);
  state.pouch = sanitizePouch(raw.pouch, content);
  if (isRecord(raw.wounds)) {
    const stacks = Math.min(
      Math.floor(nonNegative(raw.wounds.stacks)),
      content.balance.K.wound.max,
    );
    state.wounds = {
      stacks,
      left:
        stacks > 0
          ? Math.max(
              1,
              Math.min(woundIntervalMs(content), Math.floor(nonNegative(raw.wounds.left))),
            )
          : 0,
    };
  }
  state.seen = pick(raw.seen, (key, v) =>
    v === true && entryOf(content, key) ? (true as const) : undefined,
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
  // The Athletics course and Meditation feed modifiers, so they load before what the modifiers bound.
  state.course = pick(raw.course, (slot, v) => {
    const obstacle = typeof v === 'string' ? index.obstacles.get(v) : undefined;
    return obstacle && `${obstacle.slot}` === slot ? obstacle.id : undefined;
  });
  state.meditation = pick(raw.meditation, (key, v) => {
    const practice = index.practices.get(key);
    if (!practice || !isRecord(v)) return undefined;
    const bought = pick(v.bought, (ref, levels) => {
      const parsed = parseModRef(ref);
      const list =
        parsed && (parsed.kind === 'insight' ? practice.insightMods : practice.enlightMods);
      if (!parsed || !list?.[parsed.index] || typeof levels !== 'number') return undefined;
      const n = Math.min(Math.floor(nonNegative(levels)), maxLevels(parsed.kind, content));
      return n >= 1 ? n : undefined;
    });
    return {
      insight: Math.floor(nonNegative(v.insight)),
      enlight: Math.floor(nonNegative(v.enlight)),
      bought,
    };
  });
  state.buffs = pick(raw.buffs, (key, v) => {
    const fx = index.items.get(key)?.fx;
    if (fx?.kind !== 'tonic' || !isRecord(v)) return undefined;
    const cap = tonicCharges(state, fx.charges, content, rules) * content.balance.K.tonic.capMult;
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
    if (size < 1 || size > bushSize(state, key, content, rules)) return undefined;
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
  ensurePouch(state, content);
  syncLoadout(state, content);
  // A fight needs both its slot and its state; either one alone is dropped or rebuilt.
  const slot = state.slots.find((s) => s.action !== null && isCombatKind(s.action.kind));
  const action = slot?.action ?? null;
  state.combat = action ? sanitizeCombat(raw.combat, action, content) : null;
  if (action && !state.combat) {
    if (action.kind === FIGHT_KIND) {
      const target = fightTarget(content, action.id);
      if (target) state.combat = newCombat(state, target.enemy, content, rules);
    } else if (action.kind === OPERATION_KIND) {
      const op = indexOf(content).operations.get(action.id);
      if (op) state.combat = newOperation(state, op, content, rules);
    }
  }
  updateQuests(state, content);
  return state;
}
