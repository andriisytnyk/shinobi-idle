import {
  COMBO_IDS,
  NATURE_IDS,
  RANKS,
  ROLE_IDS,
  SKILL_IDS,
  STATE_IDS,
  TAG_IDS,
  TRAIT_IDS,
  type ComboId,
  type ContentDb,
  type NatureId,
  type SkillId,
  type TagId,
  type TraitId,
} from '@shinobi/content';
import type { RngState } from '../rng.ts';
import type {
  Combatant,
  Effect,
  Encounter,
  FightLogLine,
  FightResult,
  FightState,
  FightTally,
  KitTechnique,
  ModStat,
  PlayerKit,
  Spawn,
  Timer,
} from './fight-types.ts';
import { needOf, WORK_PER_MS, workOf } from './units.ts';

/*
 * Reads a fight back from untrusted JSON (a save). Every field is checked and anything the engine
 * could not run (a phase the side never has, a zero-length cast, a timer or tick that would spin,
 * a number that is not a number) gives null, and the caller starts the fight over. Times that a
 * valid fight keeps in a window around the fight clock are clamped into it.
 */

type Raw = Record<string, unknown>;

const isRecord = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const nonNeg = (x: unknown): x is number => isNum(x) && x >= 0;
const share = (x: unknown): x is number => isNum(x) && x >= 0 && x <= 1;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T =>
  typeof x === 'string' && (list as readonly string[]).includes(x);

const MOD_STATS: readonly ModStat[] = ['accuracy', 'evasion', 'speed', 'damageTaken'];
const RESULTS: readonly FightResult[] = ['ongoing', 'victory', 'defeat', 'fled', 'timeout'];
/** The largest multiplier an effect may carry; more would make a timer fill in no time. */
const MOD_LIMIT = 10;

function numberRecord(raw: unknown): Record<string, number> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isNum(value)) return null;
    out[key] = value;
  }
  return out;
}

function parseEffect(raw: unknown, t: number): Effect | null {
  if (!isRecord(raw) || !isStr(raw.id) || !isStr(raw.src)) return null;
  if (raw.until !== null && !isInt(raw.until)) return null;
  if (raw.suppresses !== undefined && !isStr(raw.suppresses)) return null;
  if (raw.whileAlive !== undefined && !isStr(raw.whileAlive)) return null;
  const base = {
    id: raw.id,
    src: raw.src,
    until: raw.until === null ? null : Math.max(raw.until as number, t),
    ...(raw.suppresses === undefined ? {} : { suppresses: raw.suppresses }),
    ...(raw.whileAlive === undefined ? {} : { whileAlive: raw.whileAlive }),
  };
  if (raw.kind === 'modifier') {
    if (!oneOf(MOD_STATS, raw.stat) || !isNum(raw.value)) return null;
    if (raw.op !== 'mul' && raw.op !== 'add') return null;
    if (raw.value < 0 || raw.value > MOD_LIMIT) return null;
    return { ...base, kind: 'modifier', stat: raw.stat, op: raw.op, value: raw.value };
  }
  if (raw.kind === 'periodic') {
    if (raw.mode !== 'damage' && raw.mode !== 'heal') return null;
    // A tick is at least a millisecond apart, or time could never pass.
    if (!nonNeg(raw.amount) || !isInt(raw.every) || raw.every < WORK_PER_MS || !isInt(raw.next)) {
      return null;
    }
    if (raw.base !== undefined && !nonNeg(raw.base)) return null;
    return {
      ...base,
      kind: 'periodic',
      mode: raw.mode,
      amount: raw.amount,
      every: raw.every,
      // A tick is always within one step ahead of the clock; far behind would mean a flood of ticks.
      next: Math.min(Math.max(raw.next, t), t + raw.every),
      ...(raw.base === undefined ? {} : { base: raw.base }),
    };
  }
  return null;
}

function parseTimer(raw: unknown, size: number): Timer | null {
  if (!isRecord(raw) || !isInt(raw.progress) || !isInt(raw.need)) return null;
  if (raw.progress < 0 || raw.need < size) return null;
  return { progress: Math.min(raw.progress, raw.need), need: raw.need };
}

function parseCombatant(raw: unknown, side: Combatant['side'], t: number): Combatant | null {
  if (!isRecord(raw) || raw.side !== side || !isStr(raw.id) || !isStr(raw.entry)) return null;
  const figures = [
    raw.hp,
    raw.maxHp,
    raw.chakra,
    raw.maxChakra,
    raw.stamina,
    raw.maxStamina,
    raw.accuracy,
    raw.evasion,
    raw.damage,
    raw.ward,
  ];
  if (!figures.every(nonNeg) || !isInt(raw.intervalMs) || raw.intervalMs < 1) return null;
  if ((raw.maxHp as number) <= 0) return null;
  // The player is idle, casting or recovering; an enemy is always counting down to its attack.
  const phases = side === 'player' ? ['idle', 'cast', 'recover'] : ['attack'];
  if (typeof raw.phase !== 'string' || !phases.includes(raw.phase)) return null;
  const phase = raw.phase as Combatant['phase'];
  if (raw.nature !== null && !oneOf(NATURE_IDS, raw.nature)) return null;
  if (raw.cast !== null && !isStr(raw.cast)) return null;
  if (!Array.isArray(raw.traits) || !raw.traits.every((x) => oneOf(TRAIT_IDS, x))) return null;
  if (!Array.isArray(raw.specials) || !raw.specials.every(isStr)) return null;
  if (!Array.isArray(raw.effects)) return null;
  const effects: Effect[] = [];
  for (const e of raw.effects) {
    const effect = parseEffect(e, t);
    if (!effect) return null;
    effects.push(effect);
  }
  const cd = numberRecord(raw.cd);
  const data = numberRecord(raw.data);
  const timer = parseTimer(raw.timer, phase === 'idle' ? 0 : needOf(1));
  if (!cd || !data || !timer || !isRecord(raw.timers)) return null;
  const timers: Record<string, Timer> = {};
  for (const [name, value] of Object.entries(raw.timers)) {
    const parsed = parseTimer(value, needOf(1));
    if (!parsed) return null;
    timers[name] = parsed;
  }
  if (raw.wardUntil !== null && !isInt(raw.wardUntil)) return null;
  if (!isInt(raw.decoys) || raw.decoys < 0) return null;
  if (raw.fleeAt !== null && !share(raw.fleeAt)) return null;
  if (typeof raw.fled !== 'boolean') return null;
  const max = (x: unknown, m: number) => Math.min(m, x as number);
  const maxHp = raw.maxHp as number;
  const maxChakra = raw.maxChakra as number;
  const maxStamina = raw.maxStamina as number;
  return {
    id: raw.id,
    side,
    entry: raw.entry,
    hp: max(raw.hp, maxHp),
    maxHp,
    chakra: max(raw.chakra, maxChakra),
    maxChakra,
    stamina: max(raw.stamina, maxStamina),
    maxStamina,
    accuracy: raw.accuracy as number,
    evasion: raw.evasion as number,
    damage: raw.damage as number,
    intervalMs: raw.intervalMs,
    nature: raw.nature as NatureId | null,
    traits: raw.traits as TraitId[],
    specials: raw.specials as string[],
    effects,
    cd,
    phase,
    cast: raw.cast,
    timer,
    timers,
    data,
    ward: raw.ward as number,
    wardUntil: raw.wardUntil === null ? null : Math.max(raw.wardUntil as number, t),
    decoys: raw.decoys,
    fleeAt: raw.fleeAt,
    fled: raw.fled,
  };
}

function parseKit(raw: unknown, content: ContentDb): PlayerKit | null {
  if (!isRecord(raw) || !Array.isArray(raw.techniques)) return null;
  if (!nonNeg(raw.med) || !nonNeg(raw.chakraRegen) || !nonNeg(raw.staminaRegen)) return null;
  const known = new Set(content.techniques.map((t) => t.id));
  const techniques: KitTechnique[] = [];
  for (const t of raw.techniques) {
    if (!isRecord(t) || !isStr(t.id) || !known.has(t.id)) return null;
    if (!oneOf(SKILL_IDS, t.skill) || !oneOf(ROLE_IDS, t.role) || !oneOf(RANKS, t.rank)) {
      return null;
    }
    if (!Array.isArray(t.tags) || !t.tags.every((tag) => oneOf(TAG_IDS, tag))) return null;
    if (t.state !== null && !oneOf(STATE_IDS, t.state)) return null;
    if (t.pool !== 'chakra' && t.pool !== 'stamina') return null;
    // A cast takes at least a millisecond, or the player would act again without time passing.
    if (!isInt(t.castMs) || t.castMs < 1 || !isInt(t.cooldownMs) || t.cooldownMs < 0) return null;
    if (!share(t.comboChance)) return null;
    const figures = [t.damage, t.cost, t.accuracy, t.habituationMult];
    if (!figures.every(nonNeg) || typeof t.hitsAll !== 'boolean') return null;
    if (t.guaranteedCombo !== null && !oneOf(COMBO_IDS, t.guaranteedCombo)) return null;
    techniques.push({
      id: t.id,
      skill: t.skill,
      role: t.role,
      rank: t.rank,
      tags: t.tags as TagId[],
      state: t.state,
      damage: t.damage as number,
      castMs: t.castMs,
      cooldownMs: t.cooldownMs,
      pool: t.pool,
      cost: t.cost as number,
      accuracy: t.accuracy as number,
      comboChance: t.comboChance,
      hitsAll: t.hitsAll,
      guaranteedCombo: t.guaranteedCombo as ComboId | null,
      habituationMult: t.habituationMult as number,
    });
  }
  return { techniques, med: raw.med, chakraRegen: raw.chakraRegen, staminaRegen: raw.staminaRegen };
}

function parseTally(raw: unknown): FightTally | null {
  if (!isRecord(raw) || !oneOf(SKILL_IDS, raw.style)) return null;
  const damage = numberRecord(raw.damage);
  const uses = numberRecord(raw.uses);
  const statuses = numberRecord(raw.statuses);
  const combos = numberRecord(raw.combos);
  const masteryWork = numberRecord(raw.masteryWork);
  if (!damage || !uses || !statuses || !combos || !masteryWork) return null;
  const scalars = [raw.basic, raw.interrupts, raw.kills, raw.taken, raw.time, raw.lastUseAt];
  if (!scalars.every(nonNeg)) return null;
  return {
    damage,
    uses,
    basic: raw.basic as number,
    statuses,
    combos,
    interrupts: raw.interrupts as number,
    kills: raw.kills as number,
    taken: raw.taken as number,
    time: raw.time as number,
    style: raw.style as SkillId,
    lastUseAt: raw.lastUseAt as number,
    masteryWork,
  };
}

function parseEncounter(raw: unknown, most: number): Encounter | null {
  if (!isRecord(raw) || !isStr(raw.id) || !Array.isArray(raw.spawns)) return null;
  if (!Array.isArray(raw.specials) || !raw.specials.every(isStr)) return null;
  if (raw.spawns.length < 1 || raw.spawns.length > most) return null;
  const spawns: Spawn[] = [];
  for (const s of raw.spawns) {
    if (!isRecord(s) || !isStr(s.enemy) || !isInt(s.cl) || s.cl < 0) return null;
    if (!Array.isArray(s.traits) || !s.traits.every((x) => oneOf(TRAIT_IDS, x))) return null;
    if (s.nature !== null && s.nature !== 'wheel' && !oneOf(NATURE_IDS, s.nature)) return null;
    if (!isInt(s.count) || s.count < 1 || s.count > most) return null;
    if (!isNum(s.hpMult) || s.hpMult <= 0 || !nonNeg(s.dmgMult)) return null;
    if (s.fleeAt !== null && !share(s.fleeAt)) return null;
    if (!Array.isArray(s.specials) || !s.specials.every(isStr)) return null;
    spawns.push({
      enemy: s.enemy,
      cl: s.cl,
      traits: s.traits as TraitId[],
      nature: s.nature as Spawn['nature'],
      count: s.count,
      hpMult: s.hpMult,
      dmgMult: s.dmgMult as number,
      fleeAt: s.fleeAt,
      specials: s.specials as string[],
    });
  }
  return { id: raw.id, spawns, specials: raw.specials as string[] };
}

/** The battle log lines still to be read; lines that do not fit are dropped, an absent log is empty. */
function parseLog(raw: unknown): FightLogLine[] | null {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return [];
  const lines: FightLogLine[] = [];
  for (const l of raw) {
    if (!isRecord(l) || (l.side !== 'player' && l.side !== 'enemy') || !isNum(l.dmg)) continue;
    if (l.act !== 'cast' && l.act !== 'hit' && l.act !== 'miss') continue;
    if (l.tech !== null && !isStr(l.tech)) continue;
    lines.push({ side: l.side, act: l.act, tech: l.tech, dmg: l.dmg });
  }
  return lines;
}

function parseKnowledge(raw: unknown): Record<string, string[]> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || !value.every(isStr)) return null;
    out[key] = value;
  }
  return out;
}

/** A saved fight, checked field by field; null when it is not a usable fight. */
export function parseFight(raw: unknown, content: ContentDb): FightState | null {
  if (!isRecord(raw) || !isStr(raw.enemy) || !isInt(raw.t) || raw.t < 0) return null;
  const K = content.balance.K;
  const t = raw.t;
  if (!isInt(raw.cap) || raw.cap < 1 || !isInt(raw.spawned) || raw.spawned < 0) return null;
  if (!isInt(raw.poolAt) || !oneOf(RESULTS, raw.result)) return null;
  if (!isInt(raw.tier) || raw.tier < 0) return null;
  const rng = raw.rng;
  if (!Array.isArray(rng) || rng.length !== 4 || !rng.every((w) => isInt(w) && w >= 0)) return null;
  const most = Math.max(1, K.combat.maxEnemies);
  const encounter = parseEncounter(raw.encounter, most);
  const player = parseCombatant(raw.player, 'player', t);
  if (!encounter || !player || !Array.isArray(raw.enemies)) return null;
  // Dead bodies are dropped when a new one spawns, so the list is at most twice the cap.
  if (raw.enemies.length < 1 || raw.enemies.length > most + most) return null;
  const enemies: Combatant[] = [];
  for (const e of raw.enemies) {
    const enemy = parseCombatant(e, 'enemy', t);
    if (!enemy) return null;
    enemies.push(enemy);
  }
  const kit = parseKit(raw.kit, content);
  const uses = numberRecord(raw.uses);
  const tally = parseTally(raw.tally);
  const knowledge = parseKnowledge(raw.knowledge);
  if (!kit || !uses || !tally || !knowledge) return null;
  if (!Array.isArray(raw.natures) || !raw.natures.every((n) => oneOf(NATURE_IDS, n))) return null;
  if (raw.target !== null && !isStr(raw.target)) return null;
  // A player who is casting casts a technique of the kit.
  if (player.phase === 'cast' && !kit.techniques.some((x) => x.id === player.cast)) return null;
  if (player.phase !== 'cast' && player.cast !== null) return null;
  const w = rng as number[];
  const state: RngState = [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0, w[3] ?? 0];
  return {
    t,
    cap: raw.cap,
    rng: state,
    result: raw.result,
    enemy: raw.enemy,
    encounter,
    spawned: raw.spawned,
    player,
    enemies,
    kit,
    tier: raw.tier,
    natures: raw.natures as NatureId[],
    target: raw.target,
    knowledge,
    uses,
    // The next regeneration is within one step of the clock.
    poolAt: Math.min(Math.max(raw.poolAt, t), t + workOf(K.combat.regenMs)),
    tally,
    log: parseLog(raw.log),
  };
}
