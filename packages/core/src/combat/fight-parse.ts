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
  FightLogLine,
  FightState,
  FightTally,
  HeavyTimer,
  KitTechnique,
  ModStat,
  PlayerKit,
  Timer,
} from './fight-types.ts';

/*
 * Reads a fight back from untrusted JSON (a save). Every field is checked; anything that does not
 * fit gives null, and the caller starts the fight over. Numbers that would make the engine spin
 * (a zero-length timer or tick) are rejected, not repaired.
 */

type Raw = Record<string, unknown>;

const isRecord = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T =>
  typeof x === 'string' && (list as readonly string[]).includes(x);

const MOD_STATS: readonly ModStat[] = ['accuracy', 'evasion', 'speed', 'damageTaken'];
const PHASES = ['idle', 'cast', 'recover', 'attack'] as const;
const RESULTS = ['ongoing', 'victory', 'defeat'] as const;

function numberRecord(raw: unknown): Record<string, number> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isNum(value)) return null;
    out[key] = value;
  }
  return out;
}

function parseEffect(raw: unknown): Effect | null {
  if (!isRecord(raw) || !isStr(raw.id) || !isStr(raw.src)) return null;
  if (raw.until !== null && !isInt(raw.until)) return null;
  if (raw.suppresses !== undefined && !isStr(raw.suppresses)) return null;
  const base = {
    id: raw.id,
    src: raw.src,
    until: raw.until as number | null,
    ...(raw.suppresses === undefined ? {} : { suppresses: raw.suppresses }),
  };
  if (raw.kind === 'modifier') {
    if (!oneOf(MOD_STATS, raw.stat) || !isNum(raw.value)) return null;
    if (raw.op !== 'mul' && raw.op !== 'add') return null;
    return { ...base, kind: 'modifier', stat: raw.stat, op: raw.op, value: raw.value };
  }
  if (raw.kind === 'periodic') {
    if (raw.mode !== 'damage' && raw.mode !== 'heal') return null;
    if (!isNum(raw.amount) || !isInt(raw.every) || raw.every < 1 || !isInt(raw.next)) return null;
    return {
      ...base,
      kind: 'periodic',
      mode: raw.mode,
      amount: raw.amount,
      every: raw.every,
      next: raw.next,
    };
  }
  return null;
}

function parseTimer(raw: unknown, needsSize: boolean): Timer | null {
  if (!isRecord(raw) || !isInt(raw.progress) || !isInt(raw.need)) return null;
  if (raw.progress < 0 || raw.need < (needsSize ? 1 : 0)) return null;
  return { progress: Math.min(raw.progress, raw.need), need: raw.need };
}

function parseCombatant(raw: unknown, side: Combatant['side']): Combatant | null {
  if (!isRecord(raw) || raw.side !== side || !isStr(raw.id)) return null;
  const nums = [
    raw.hp,
    raw.maxHp,
    raw.chakra,
    raw.maxChakra,
    raw.stamina,
    raw.maxStamina,
    raw.accuracy,
    raw.evasion,
    raw.damage,
  ];
  if (!nums.every(isNum) || !isInt(raw.intervalMs) || raw.intervalMs < 1) return null;
  if (!oneOf(PHASES, raw.phase) || typeof raw.opening !== 'boolean') return null;
  if (raw.nature !== null && !oneOf(NATURE_IDS, raw.nature)) return null;
  if (raw.cast !== null && !isStr(raw.cast)) return null;
  if (!Array.isArray(raw.traits) || !raw.traits.every((t) => oneOf(TRAIT_IDS, t))) return null;
  if (!Array.isArray(raw.effects)) return null;
  const effects: Effect[] = [];
  for (const e of raw.effects) {
    const effect = parseEffect(e);
    if (!effect) return null;
    effects.push(effect);
  }
  const cd = numberRecord(raw.cd);
  const timer = parseTimer(raw.timer, side === 'enemy');
  if (!cd || !timer) return null;
  let heavy: HeavyTimer | null = null;
  if (raw.heavy !== null) {
    const t = parseTimer(raw.heavy, true);
    if (!t || !isRecord(raw.heavy) || (raw.heavy.phase !== 'wait' && raw.heavy.phase !== 'cast')) {
      return null;
    }
    heavy = { ...t, phase: raw.heavy.phase };
  }
  const illusion = raw.illusion === null ? null : parseTimer(raw.illusion, true);
  if (raw.illusion !== null && !illusion) return null;
  const maxHp = raw.maxHp as number;
  const maxChakra = raw.maxChakra as number;
  const maxStamina = raw.maxStamina as number;
  if (maxHp <= 0 || maxChakra < 0 || maxStamina < 0) return null;
  return {
    id: raw.id,
    side,
    hp: Math.min(maxHp, Math.max(0, raw.hp as number)),
    maxHp,
    chakra: Math.min(maxChakra, Math.max(0, raw.chakra as number)),
    maxChakra,
    stamina: Math.min(maxStamina, Math.max(0, raw.stamina as number)),
    maxStamina,
    accuracy: raw.accuracy as number,
    evasion: raw.evasion as number,
    damage: raw.damage as number,
    intervalMs: raw.intervalMs,
    nature: raw.nature as NatureId | null,
    traits: raw.traits as TraitId[],
    effects,
    cd,
    phase: raw.phase,
    cast: raw.cast,
    timer,
    heavy,
    illusion,
    opening: raw.opening,
  };
}

function parseKit(raw: unknown, content: ContentDb): PlayerKit | null {
  if (!isRecord(raw) || !Array.isArray(raw.techniques)) return null;
  if (!isNum(raw.med) || !isNum(raw.chakraRegen) || !isNum(raw.staminaRegen)) return null;
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
    const figures = [t.damage, t.castMs, t.cooldownMs, t.cost, t.accuracy, t.comboChance];
    if (!figures.every(isNum) || typeof t.hitsAll !== 'boolean') return null;
    if (t.guaranteedCombo !== null && !oneOf(COMBO_IDS, t.guaranteedCombo)) return null;
    techniques.push({
      id: t.id,
      skill: t.skill,
      role: t.role,
      rank: t.rank,
      tags: t.tags as TagId[],
      state: t.state,
      damage: t.damage as number,
      castMs: t.castMs as number,
      cooldownMs: t.cooldownMs as number,
      pool: t.pool,
      cost: t.cost as number,
      accuracy: t.accuracy as number,
      comboChance: t.comboChance as number,
      hitsAll: t.hitsAll,
      guaranteedCombo: t.guaranteedCombo as ComboId | null,
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
  if (!scalars.every(isNum)) return null;
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

/** A saved fight, checked field by field; null when it is not a usable fight. */
export function parseFight(raw: unknown, content: ContentDb): FightState | null {
  if (!isRecord(raw) || !isStr(raw.enemy) || !isInt(raw.t) || raw.t < 0) return null;
  if (!isInt(raw.poolAt) || !oneOf(RESULTS, raw.result)) return null;
  const rng = raw.rng;
  if (!Array.isArray(rng) || rng.length !== 4 || !rng.every((w) => isInt(w) && w >= 0)) return null;
  const player = parseCombatant(raw.player, 'player');
  if (!player || !Array.isArray(raw.enemies) || raw.enemies.length < 1) return null;
  if (raw.enemies.length > Math.max(1, content.balance.K.pack.n)) return null;
  const enemies: Combatant[] = [];
  for (const e of raw.enemies) {
    const enemy = parseCombatant(e, 'enemy');
    if (!enemy) return null;
    enemies.push(enemy);
  }
  const kit = parseKit(raw.kit, content);
  const uses = numberRecord(raw.uses);
  const tally = parseTally(raw.tally);
  if (!kit || !uses || !tally) return null;
  const w = rng as number[];
  const state: RngState = [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0, w[3] ?? 0];
  return {
    t: raw.t,
    rng: state,
    result: raw.result,
    enemy: raw.enemy,
    player,
    enemies,
    kit,
    uses,
    poolAt: raw.poolAt,
    tally,
    log: parseLog(raw.log),
  };
}
