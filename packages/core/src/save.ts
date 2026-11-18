import type { ContentDb, NatureId, SkillId } from '@shinobi/content';
import { actionKindOf, rebalanceShares } from './actions.ts';
import { COURSE_ID, COURSE_KIND } from './athletics.ts';
import { tonicCharges } from './buffs.ts';
import { BINGO_MAX } from './combat/bingo.ts';
import { RATION_BUFF } from './missions/ration.ts';
import { repairMissions } from './missions/run.ts';
import { parseFight } from './combat/fight-parse.ts';
import { parseReport } from './combat/report.ts';
import { secMs } from './combat/numbers.ts';
import { pouchUse } from './combat/fight-items.ts';
import { loadoutLimits, syncLoadout } from './combat/loadout.ts';
import { ensurePouch } from './combat/pouch.ts';
import {
  FIGHT_KIND,
  OPERATION_KIND,
  MISSION_KIND,
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
import {
  balanceOf,
  packDiff,
  restoreDormant,
  safeKey,
  sanitizeDormant,
  sanitizePacks,
  sanitizeRankOrder,
  settlePlayer,
  stashMissing,
} from './pack-data.ts';
import { bushSize } from './field.ts';
import { cycleSeconds, MS_PER_HOUR, MS_PER_SECOND, poolCapacity } from './formulas.ts';
import { maxLevels, parseModRef } from './meditation.ts';
import { indexOf } from './lookup.ts';
import { teamFor } from './natures.ts';
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
import { refreshRegions, regionFlag } from './regions.ts';
import { isShownKey, seenLimit } from './reveal.ts';
import { refreshUnlocks } from './unlocks.ts';
import {
  villageBuildCost,
  civilCap,
  maxBuildingLevel,
  reputationOf,
  shinobiCap,
  stageForRep,
  tickMs,
} from './village.ts';
import { createVillage, type VillageState } from './village-state.ts';
import { isAcademyRank, isNature, packOfId, poolEntry, rankIndex, skillEntry } from './vocab.ts';
import { hexKey, hexLine, isPlayable, removeFigure } from './hex.ts';
import { cellMaxExplores, levelForExplores, plainMaxExplores, subjectOf } from './world.ts';
import { createWorld, seedSurvey } from './world-state.ts';
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
  (state, content) => {
    const natures =
      isRecord(state.player) && Array.isArray(state.player.natures) ? state.player.natures : [];
    const first: unknown = natures[0];
    const native = typeof first === 'string' && isNature(content, first) ? first : undefined;
    return { ...state, team: native ? teamFor(content, native) : null };
  },
  // v8 -> v9: exploration. Nothing explored yet; the player stands in the first cell of the world.
  (state, content) => ({ ...state, world: createWorld(content) }),
  // v9 -> v10: loadouts, the pouch, Wounds and what the player has seen. The fight carries a pouch,
  // technique effects and boss hooks now, so a fight in progress restarts; the loadout rebuilds itself.
  // A genin of an older save gets the medic pouch the graduation now gives.
  (state, content) => {
    const rank = isRecord(state.player) ? state.player.rank : undefined;
    const bank = isRecord(state.bank) ? { ...state.bank } : {};
    const medic = content.items.find((i) => i.medic !== undefined);
    const graduate =
      typeof rank === 'string' && rankIndex(content, rank) >= 0 && !isAcademyRank(content, rank);
    if (medic && graduate && typeof bank[medic.id] !== 'number') bank[medic.id] = 1;
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
  // v10 -> v11: the village. A genin or chunin gets one with the starting buildings; a student has none.
  (state, content) => {
    const rank = isRecord(state.player) ? state.player.rank : undefined;
    const village =
      typeof rank === 'string' && rankIndex(content, rank) >= 0 && !isAcademyRank(content, rank)
        ? createVillage(content)
        : null;
    return { ...state, village };
  },
  // v11 -> v12: missions. Village resource units earned by missions wait here until a village takes them.
  (state) => ({ ...state, missions: { pending: {} } }),
  // v12 -> v13: the Bingo book replaces `seen`; battle reports start empty. An entry the old rule
  // counted as beaten (a win, a defeat or a watched fight) keeps its knowledge as a bought level 2.
  (state) => {
    const seen = isRecord(state.seen) ? state.seen : {};
    const counters = isRecord(state.counters) ? state.counters : {};
    const bingo: Record<string, unknown> = {};
    const ids = new Set<string>(Object.keys(seen));
    for (const key of Object.keys(counters)) {
      const m = /^(?:kills|defeats|studied)\.(.+)$/.exec(key);
      if (m?.[1]) ids.add(m[1]);
    }
    for (const id of ids) {
      const wins = nonNegative(counters[`kills.${id}`]);
      const losses = nonNegative(counters[`defeats.${id}`]);
      const timeouts = nonNegative(counters[`studied.${id}`]);
      bingo[id] = {
        seen: Math.max(1, wins + losses + timeouts),
        wins,
        losses,
        timeouts,
        bought: wins + losses + timeouts > 0 ? 2 : 0,
        bounty: 0,
      };
    }
    const { seen: _seen, ...rest } = state;
    void _seen;
    return { ...rest, bingo, report: {} };
  },
  // v13 -> v14: the save keeps the packs it was made with, the rank order and the dormant data of
  // missing packs. A v13 save was made with the built-in pack alone, so its ranks are that pack's.
  (state, content) => {
    const core = content.packs.find((p) => p.id === 'core');
    return {
      ...state,
      packs: [{ id: 'core', version: core?.version ?? '' }],
      rankOrder: content.playerRanks.filter((r) => packOfId(r.id) === 'core').map((r) => r.id),
      dormant: {},
    };
  },
  // v14 -> v15: the set of entities the interface has shown (the reveal rule), empty at first.
  // The set starts from what the old save proves the player has met: what is in the bank, the pouch
  // and the gear, what the battle reports and mastery records name, the recipes known, the enemies
  // of the Bingo book and the reports. A player who reached the same state on this version has them.
  (state, content) => {
    const items = new Set(content.items.map((i) => i.id));
    const recipes = new Set(content.recipes.map((r) => r.id));
    const gear = new Set(content.gear.map((g) => g.id));
    const enemies = new Set(content.enemies.map((e) => e.id));
    const bosses = new Set(content.bosses.map((b) => b.id));
    const shown: Record<string, true> = {};
    const mark = (set: Set<string>, kind: string, id: unknown): void => {
      if (typeof id === 'string' && set.has(id)) shown[`${id}@${kind}`] = true;
    };
    const keys = (x: unknown): string[] => (isRecord(x) ? Object.keys(x) : []);
    for (const id of keys(state.bank)) mark(items, 'item', id);
    const slots =
      isRecord(state.pouch) && Array.isArray(state.pouch.slots) ? state.pouch.slots : [];
    for (const slot of slots) mark(items, 'item', isRecord(slot) ? slot.id : undefined);
    for (const id of keys(state.gear)) mark(gear, 'gear', id);
    for (const id of keys(state.known)) mark(recipes, 'recipe', id);
    for (const id of keys(state.mastery)) {
      mark(recipes, 'recipe', id);
      mark(items, 'item', id);
    }
    for (const id of keys(state.buffs)) mark(items, 'item', id);
    const report = isRecord(state.report) ? state.report : {};
    for (const entry of Object.values(report)) {
      // A report is kept by the id of a zone, an enemy, an operation or a mission, so its key says nothing of what was met: the book and the kill counters do.
      if (!isRecord(entry)) continue;
      if (isRecord(entry.loot)) for (const id of keys(entry.loot.items)) mark(items, 'item', id);
      for (const id of keys(entry.items)) mark(items, 'item', id);
    }
    for (const id of keys(state.bingo)) {
      mark(enemies, 'enemy', id);
      mark(bosses, 'boss', id);
    }
    // What left no trace in the bank: rewards of the missions completed, the scrolls and parts of the
    // techniques learned from scrolls, the products of the recipes practised.
    const counters = isRecord(state.counters) ? state.counters : {};
    const done = (id: string): boolean => {
      const n = counters[`missions.done.${id}`];
      return typeof n === 'number' && n > 0;
    };
    const known = isRecord(state.known) ? state.known : {};
    for (const mission of content.missions) {
      if (!done(mission.id)) continue;
      for (const pay of mission.pay) {
        if (pay.kind === 'item') mark(items, 'item', pay.item);
        if (pay.kind === 'scrollPart') {
          for (const item of content.items) {
            if (item.part?.technique === pay.technique) mark(items, 'item', item.id);
          }
        }
      }
    }
    for (const item of content.items) {
      const technique = item.scroll?.technique ?? item.part?.technique;
      if (technique !== undefined && known[technique] === true) mark(items, 'item', item.id);
    }
    const practised = new Set(keys(state.mastery));
    for (const recipe of content.recipes) {
      if (known[recipe.id] === true || practised.has(recipe.id)) {
        mark(items, 'item', recipe.output.item);
      }
    }
    return { ...state, shown };
  },
  // v15 -> v16: the Evasion skill is gone (evasion is a rating now): its XP and pool entries are dropped. The fight
  // loop is another one (waiting and acting): the fight in progress (the bodies, their timers and pools) cannot go
  // on in it and is dropped; the place it had is kept (its owner slot, its enemy, an operation's step), so the load
  // starts a fresh fight of the same enemy there without a reward, a Wound or a lost item. What is kept: the action
  // and its slot, a mission's run (stage, attempts, the ration already spent, the plan), an operation's step, the
  // mastery and XP already paid. What restarts: the fight of the stage (full pools, nothing dealt yet) and an
  // operation's approach. Nothing else of a save changes here.
  (state) => {
    const without = (branch: unknown): unknown => {
      if (!isRecord(branch)) return branch;
      const { eva: _eva, ...rest } = branch;
      void _eva;
      return rest;
    };
    const fight = state.combat;
    const place = isRecord(fight)
      ? { enemy: fight.enemy, owner: fight.owner, run: fight.run }
      : null;
    return { ...state, skills: without(state.skills), pools: without(state.pools), combat: place };
  },
  // v16 -> v17: the world became a grid of hexes surveyed one by one. The position is still the
  // address of a cell (a cell id names its hex) and surveys keep their cell ids. What the save
  // proves is surveyed, as a player who had played on this version would have it: the starting
  // area (the hexes within `K.map.startRadius` of the first cell); for every region of which a cell
  // is explored to level 1, the hexes of all its cells and of the straight lines that join each to
  // the first cell (so that the way there can be walked); and the hex underfoot. A hex that is no
  // cell is marked with the surveys of its first level; a cell is only marked, its level stays.
  (state, content) => {
    const world = isRecord(state.world) ? state.world : {};
    const explores = isRecord(world.explores) ? world.explores : {};
    const index = indexOf(content);
    const seeded = createWorld(content);
    const keys = new Set<string>(Object.keys(seeded.surveyed));
    const first = content.cells[0];
    const add = (a: { q: number; r: number }): void => void keys.add(hexKey(a.q, a.r));
    for (const region of content.regions) {
      const explored = region.cells.some((id) => {
        const n = explores[id];
        return typeof n === 'number' && levelForExplores(n, content) >= 1;
      });
      if (!explored) continue;
      for (const id of region.cells) {
        const cell = index.cells.get(id);
        if (!cell) continue;
        const at = { q: cell.hex[0], r: cell.hex[1] };
        add(at);
        if (first) for (const h of hexLine({ q: first.hex[0], r: first.hex[1] }, at)) add(h);
      }
    }
    const here = typeof world.location === 'string' ? index.cells.get(world.location) : undefined;
    if (here) add({ q: here.hex[0], r: here.hex[1] });
    const marked = { ...seeded, explores: { ...seeded.explores } };
    for (const [id, n] of Object.entries(explores))
      if (typeof n === 'number' && index.cells.has(id)) marked.explores[id] = n;
    seedSurvey(marked, content, keys);
    return {
      ...state,
      world: { ...world, surveyed: marked.surveyed, explores: { ...marked.explores } },
    };
  },
  // v17 -> v18: the pool capacity per item went from 1500 to 2000 (action pace, #69). The saved pool XP is a
  // number against that capacity, so every pool is scaled by 2000 / 1500: it keeps its fraction of the capacity and
  // so the pool checkpoints it had reached (a checkpoint never switches off). The two numbers are the capacities of
  // the two versions, not `K.poolCapPerItem`: a migration says what the save was, whatever the data is now.
  (state) => {
    const pools = isRecord(state.pools) ? state.pools : {};
    const scaled: Raw = {};
    for (const [id, pool] of Object.entries(pools))
      scaled[id] = isRecord(pool) ? { ...pool, xp: (nonNegative(pool.xp) * 2000) / 1500 } : pool;
    return { ...state, pools: scaled };
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
    if (!safeKey(key)) continue;
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
    if (actionKindOf(rules, action.kind)?.has(action.id, content)) {
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
  owner: number,
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
  const index = indexOf(content);
  const horizon = workOf(MS_PER_HOUR);
  const paid = pick(raw.paid, (key, v) =>
    indexOf(content).techniques.has(key) && typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? v
      : undefined,
  );
  const style = fight.tally.style;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(1e15, v) : undefined;
  const xp = pick(isRecord(raw.pending) ? raw.pending.xp : undefined, (key, v) =>
    index.skills.has(key) ? num(v) : undefined,
  );
  const mastery = pick(isRecord(raw.pending) ? raw.pending.mastery : undefined, (key, v) => {
    const amount = isRecord(v) ? num(v.amount) : undefined;
    const tech = index.techniques.get(key);
    return amount !== undefined && tech ? { skill: tech.skill, amount } : undefined;
  });
  const pending =
    Object.keys(xp).length + Object.keys(mastery).length > 0 ? { xp, mastery } : undefined;
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
    style: index.skills.has(String(raw.style)) ? (raw.style as SkillId) : style,
    owner,
    run,
    ...(pending ? { pending } : {}),
  };
}

/** A loadout read back: ids the content or the player no longer has are dropped. */
function sanitizeLoadouts(raw: unknown, state: GameState, content: ContentDb): LoadoutState {
  const out: LoadoutState = { active: [], auto: true, signature: null, basis: '', saved: {} };
  if (!isRecord(raw)) return out;
  const index = indexOf(content);
  const limits = loadoutLimits(rankIndex(content, state.player.rank), content);
  const natureOf = (id: string): string | null => {
    const skill = index.techniques.get(id)?.skill ?? '';
    return isNature(content, skill) ? skill : null;
  };
  /** The most slots any rank of the content gives. */
  const mostSlots = Math.max(0, ...Object.values(content.balance.K.loadout.slots));
  /** The techniques the player knows, none out of the loadout, as many as the rank's slots and natures allow. */
  const ids = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    const natures = new Set<string>();
    for (const id of new Set(list.filter((x): x is string => typeof x === 'string'))) {
      const tech = index.techniques.get(id);
      // A defensive technique is passive and never in the hand: a loadout saved with one has the slot freed.
      if (
        !tech ||
        tech.rank === null ||
        tech.combat?.outOfLoadout ||
        tech.combat?.passive !== undefined ||
        state.known[id] !== true
      ) {
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
    return out.slice(0, mostSlots);
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

/**
 * A saved world. The position must name a hex of the map. Surveys are clamped to what the hex can
 * hold (a cell's levels, or a plain hex's); found points follow from them, so they are recomputed,
 * never trusted; loot counts as taken only when it can be. Surveyed hexes must be playable hexes of
 * the map; a hex surveyed to its first level counts as surveyed whether or not it is listed.
 */
function sanitizeWorld(raw: unknown, content: ContentDb): GameState['world'] {
  const world = createWorld(content);
  if (!isRecord(raw)) return world;
  const index = indexOf(content);
  if (typeof raw.location === 'string' && subjectOf(content, raw.location) !== null) {
    world.location = raw.location;
  }
  // The figures of the other performers: a slot index (1 and up) and a hex of the map.
  if (isRecord(raw.figures)) {
    const figures: Record<number, string> = {};
    for (const [slot, at] of Object.entries(raw.figures)) {
      const n = Number(slot);
      if (Number.isInteger(n) && n >= 1 && typeof at === 'string' && subjectOf(content, at))
        figures[n] = at;
    }
    if (Object.keys(figures).length > 0) world.figures = figures;
  }
  world.explores = pick(raw.explores, (key, v) => {
    if (typeof v !== 'number') return undefined;
    const subject = subjectOf(content, key);
    // Only the address of a hex is a key: a cell id for a cell, the key of the hex for any other.
    if (!subject || subject.address !== key) return undefined;
    const top = subject.cell ? cellMaxExplores(subject.cell, content) : plainMaxExplores(content);
    const count = Math.min(Math.floor(nonNegative(v)), top);
    return count >= 1 ? count : undefined;
  });
  for (const cell of content.cells) {
    if (levelForExplores(world.explores[cell.id] ?? 0, content) < 1) continue;
    for (const poi of cell.pois) world.pois[poi.id] = true;
  }
  // A place that is a point of interest is found by a performer stepping on it: that is not derived
  // from the surveys, so a saved find is kept (when the content still has a point there).
  if (isRecord(raw.pois))
    for (const place of content.places)
      if (place.point && raw.pois[place.id] === true) world.pois[place.id] = true;
  const stock = pick(raw.stock, (key, v) => {
    const rare = index.places.get(key)?.rare;
    if (!rare || !isRecord(v)) return undefined;
    const left = typeof v.left === 'number' && Number.isInteger(v.left) ? v.left : rare.stock;
    return { left: Math.min(Math.max(left, 0), rare.stock), at: nonNegative(v.at) };
  });
  if (Object.keys(stock).length > 0) world.stock = stock;
  world.claimed = pick(raw.claimed, (key, v) => {
    const kind = index.pois.get(key)?.poi.kind;
    return v === true && world.pois[key] && (kind === 'cache' || kind === 'vault')
      ? (true as const)
      : undefined;
  });
  world.surveyed = {
    ...world.surveyed,
    ...pick(raw.surveyed, (key, v) =>
      v === true && isPlayable(index.hexes.get(key)) ? (true as const) : undefined,
    ),
  };
  return world;
}

/**
 * A saved village. A student has none. Levels are clamped to what the building can reach and never
 * fall below the starting level; stores are clamped to their caps; the job's cost is recomputed from
 * the level it builds, never trusted; the stage follows Reputation.
 */
function sanitizeVillage(raw: unknown, state: GameState, content: ContentDb): VillageState | null {
  if (isAcademyRank(content, state.player.rank)) return null;
  const village = createVillage(content);
  if (!isRecord(raw)) return village;
  const K = content.balance.K;
  const whole = (x: unknown): number => Math.floor(nonNegative(x));
  const savedLevels = isRecord(raw.levels) ? raw.levels : {};
  for (const b of content.buildings) {
    const level = Math.min(whole(savedLevels[b.id]), maxBuildingLevel(b, content));
    village.levels[b.id] = Math.max(level, village.levels[b.id] ?? 0);
    if (village.levels[b.id] === 0) delete village.levels[b.id];
  }
  village.stage = stageForRep(content, reputationOf(state, content));
  const civil = civilCap(village, content);
  const shinobi = shinobiCap(village, content);
  const savedRes = isRecord(raw.res) ? raw.res : {};
  for (const id of Object.keys(village.res)) village.res[id] = Math.min(whole(savedRes[id]), civil);
  const savedShinobi = isRecord(raw.shinobi) ? raw.shinobi : {};
  for (const id of Object.keys(village.shinobi)) {
    village.shinobi[id] = Math.min(whole(savedShinobi[id]), shinobi);
  }
  village.workforce = Math.min(whole(raw.workforce), shinobi);
  village.power = whole(raw.power);
  village.treasury = whole(raw.treasury);
  village.clock = Math.min(whole(raw.clock), tickMs(content) - 1);
  const job = raw.job;
  if (isRecord(job) && typeof job.building === 'string') {
    const building = content.buildings.find((b) => b.id === job.building);
    const level = building ? (village.levels[building.id] ?? 0) + 1 : 0;
    if (building && level <= maxBuildingLevel(building, content)) {
      const total = Math.max(1, K.buildTicks[level - 1] ?? 1);
      village.job = {
        building: building.id,
        ticks: Math.max(1, Math.min(whole(job.ticks), total)),
        total,
        paid: villageBuildCost(building, level, content),
      };
    }
  }
  return village;
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
    raw = migrate(raw, content);
  }

  const state = createState(0, content);
  const index = indexOf(content);
  const cap = content.balance.K.cap;

  // The packs the save was made with against the packs of the content: what a pack that is missing
  // owned goes to its dormant bucket, and what a pack that came back kept is returned.
  const savedPacks = sanitizePacks(raw.packs);
  const savedVersions = new Map(savedPacks.map((p) => [p.id, p.version]));
  const dormant = sanitizeDormant(raw.dormant);
  raw = stashMissing(raw, content, dormant, savedVersions);
  const back = restoreDormant(raw, content, dormant);
  raw = back.raw;
  const settled = isRecord(raw.player)
    ? settlePlayer(
        raw.player,
        content,
        sanitizeRankOrder(raw.rankOrder),
        back.restored,
        dormant,
        savedVersions,
      )
    : null;
  state.dormant = dormant;

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
    if (settled?.rank) state.player.rank = settled.rank;
    state.player.natures = (settled?.natures ?? []).slice(
      0,
      content.balance.K.natures.max,
    ) as NatureId[];
    // The team's natures follow from the native nature alone, so they are recomputed, never trusted.
    const native = state.player.natures[0];
    state.team = native ? teamFor(content, native) : null;
  }

  const skillXp = isRecord(raw.skills) ? raw.skills : {};
  const poolXp = isRecord(raw.pools) ? raw.pools : {};
  for (const id of Object.keys(state.skills)) {
    const skill = Object.hasOwn(skillXp, id) ? skillXp[id] : undefined;
    const entry = skillEntry(state, id);
    if (isRecord(skill) && entry) entry.xp = Math.min(nonNegative(skill.xp), xpAt(cap));
    const pool = Object.hasOwn(poolXp, id) ? poolXp[id] : undefined;
    const poolRecord = poolEntry(state, id);
    if (isRecord(pool) && poolRecord) {
      poolRecord.xp = Math.min(nonNegative(pool.xp), poolCapacity(id, content));
    }
  }

  state.mastery = pick(raw.mastery, (key, v) =>
    index.masteryKeys.has(key) && isRecord(v) ? { xp: nonNegative(v.xp) } : undefined,
  );
  state.bank = pick(raw.bank, (key, v) =>
    index.itemIds.has(key) && typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined,
  );
  if (isRecord(raw.currencies)) {
    for (const id of Object.keys(state.currencies)) {
      if (Object.hasOwn(raw.currencies, id)) state.currencies[id] = balanceOf(raw.currencies[id]);
    }
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
  state.bingo = pick(raw.bingo, (key, v) => {
    const entry = entryOf(content, key);
    if (!entry || !isRecord(v)) return undefined;
    const n = (x: unknown): number => Math.floor(nonNegative(x));
    // The bounty paid cannot exceed what the content allows for the wins: the first, then the repeat share.
    const wins = n(v.wins);
    const ceiling = entry.bounty
      ? entry.bounty.first + wins * Math.round(entry.bounty.first * entry.bounty.repeatShare)
      : 0;
    return {
      seen: n(v.seen),
      wins,
      losses: n(v.losses),
      timeouts: n(v.timeouts),
      bought: Math.min(BINGO_MAX, n(v.bought)),
      bounty: Math.min(ceiling, n(v.bounty)),
    };
  });
  // The set of shown entities is trusted only as far as the ids go: each must be an entity of the content, and the set is bounded.
  state.shown = Object.fromEntries(
    Object.keys(
      pick(raw.shown, (key, v) =>
        v === true && isShownKey(content, key) ? (true as const) : undefined,
      ),
    )
      .slice(0, seenLimit(content))
      .map((key) => [key, true as const]),
  );
  state.report = pick(raw.report, (key, v) =>
    entryOf(content, key) || Object.values(rules.actionKinds).some((kind) => kind.has(key, content))
      ? (parseReport(v, content) ?? undefined)
      : undefined,
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
  // Region flags follow from rank and Scouting, so they are recomputed below, never trusted.
  for (const region of content.regions) delete state.flags[regionFlag(region.id)];
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
    if (fx?.kind === 'ration' && isRecord(v)) {
      const charges = Math.min(Math.floor(nonNegative(v.charges)), fx.missions);
      return charges >= 1 ? { skill: RATION_BUFF, charges } : undefined;
    }
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
    // The carried progress of an empty bush is bounded by the herb's own cycle and its regrowing.
    const herb = index.herbs.get(key);
    const cycle = herb ? cycleSeconds('gather', herb, content) : K.gather;
    const room = (K.field.regrowMs + cycle * MS_PER_SECOND) * SHARE_FULL;
    const carry = stock === 0 ? Math.min(Math.floor(nonNegative(v.carry)), room) : 0;
    return { stock, size, carry };
  });
  state.world = sanitizeWorld(raw.world, content);
  const pending = isRecord(raw.missions) ? raw.missions.pending : undefined;
  state.missions = {
    pending: pick(pending, (key, n) =>
      content.resources.some((r) => r.id === key) &&
      typeof n === 'number' &&
      Number.isInteger(n) &&
      n > 0
        ? n
        : undefined,
    ),
  };
  state.village = sanitizeVillage(raw.village, state, content);
  const goal = raw.goal;
  state.goal =
    isRecord(goal) && typeof goal.kind === 'string' && typeof goal.id === 'string'
      ? { kind: goal.kind as EntityKind, id: goal.id }
      : null;

  refreshUnlocks(state, content, true);
  refreshRegions(state, content, true);
  // The pack list is written from the content. A pack that was in the save keeps its attach time;
  // one that is new here (or came back) is attached now, so its systems do not back-pay for the time away.
  const hasList = Array.isArray(raw.packs);
  state.packs = content.packs.map((p) => {
    const was = savedPacks.find((s) => s.id === p.id);
    const since = was ? Math.min(was.since, state.now) : hasList || p.id !== 'core' ? state.now : 0;
    return { id: p.id, version: p.version, since };
  });
  const changed = packDiff(savedPacks, content);
  // A save with no pack list (a hand-made one) says nothing about which packs it was made with.
  if (
    hasList &&
    (changed.added.length > 0 || changed.removed.length > 0 || changed.updated.length > 0)
  ) {
    emit(state, {
      type: 'packsChanged',
      added: changed.added,
      removed: changed.removed,
      updated: changed.updated,
    });
  }
  // Shares are derived from which slots run, so they are recomputed rather than trusted; a
  // saved progress beyond one cycle is cut so a doctored save cannot make the loop spin.
  rebalanceShares(state, content);
  for (const [at, slot] of state.slots.entries()) {
    const kind = slot.action && rules.actionKinds[slot.action.kind];
    if (slot.action && kind) {
      slot.progress = Math.min(
        slot.progress,
        kind.intervalMs(state, slot.action.id, content, rules, at) * SHARE_FULL,
      );
    }
  }
  // A figure belongs to a clone that works: one of a slot that is gone or idle is not on the map.
  for (const slot of Object.keys(state.world.figures ?? {}))
    if (!state.slots[Number(slot)]?.action) removeFigure(state, Number(slot));
  ensurePouch(state, content);
  syncLoadout(state, content);
  // A fight needs both its slot and its state: it belongs to the slot its `owner` names, and only if that
  // slot still runs an action that can hold a fight. Either one alone is dropped or rebuilt.
  const holds = (i: number): boolean => {
    const kind = state.slots[i]?.action?.kind;
    return kind !== undefined && (isCombatKind(kind) || kind === MISSION_KIND);
  };
  const savedOwner = isRecord(raw.combat) ? raw.combat.owner : undefined;
  const firstFight = state.slots.findIndex((s) => s.action !== null && isCombatKind(s.action.kind));
  const owner =
    typeof savedOwner === 'number' && Number.isInteger(savedOwner) && holds(savedOwner)
      ? savedOwner
      : firstFight;
  /** A new fight for a slot that runs a plain fight or an operation. */
  const rebuild = (i: number): CombatState | null => {
    const action = state.slots[i]?.action;
    if (action?.kind === FIGHT_KIND) {
      const target = fightTarget(content, action.id);
      return target ? newCombat(state, target.enemy, content, rules, i) : null;
    }
    if (action?.kind === OPERATION_KIND) {
      const op = indexOf(content).operations.get(action.id);
      // A fight that could not be carried over (an older save) goes on from the step of its run.
      const saved = isRecord(raw.combat) ? sanitizeRun(raw.combat.run, action, content) : null;
      return op ? newOperation(state, op, content, rules, i, saved?.step) : null;
    }
    return null;
  };
  const action = state.slots[owner]?.action ?? null;
  state.combat = null;
  if (action && owner >= 0) {
    // A mission keeps its fight in the same place; the mission checks it against its run below.
    const stand = action.kind === MISSION_KIND ? { kind: FIGHT_KIND, id: action.id } : action;
    state.combat = sanitizeCombat(raw.combat, stand, owner, content) ?? rebuild(owner);
  }
  repairMissions(state, content, rules);
  // A mission that took the fight in a tampered save gave it up again: a plain fight gets its own back.
  if (!state.combat && firstFight >= 0) state.combat = rebuild(firstFight);
  updateQuests(state, content);
  return state;
}
