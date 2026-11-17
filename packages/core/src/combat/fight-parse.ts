import type { ContentDb, Rank, SkillId } from '@shinobi/content';
import type { RngState } from '../rng.ts';
import { fightData } from './fight-data.ts';
import type { EvasionPart } from './numbers.ts';
import { TEAM_HOOK } from './fight-team-id.ts';
import type {
  Combatant,
  Effect,
  Encounter,
  FightAct,
  FightLogLine,
  FightResult,
  FightState,
  FightTally,
  KitEffect,
  KitTechnique,
  LastAct,
  ModStat,
  PlayerKit,
  PouchSlot,
  Spawn,
  TeamSupport,
  Timer,
} from './fight-types.ts';
import { needOf, WORK_PER_MS, workOf } from './units.ts';

/*
 * Reads a fight back from untrusted JSON (a save). Every field is checked and anything the engine
 * could not run (a phase the side never has, a zero-length cast, a timer or tick that would spin,
 * a number that is not a number) gives null, and the caller starts the fight over. Times that a
 * valid fight keeps in a window around the fight clock are clamped into it.
 */

/**
 * The vocabulary a saved fight is checked against: the ids of the content in hand. An id of a pack
 * that is not loaded (a status, trait, combo, nature or special) is dropped from the fight; one that
 * the fight cannot do without (a technique, the encounter) discards it.
 */
interface Vocab {
  natures: ReadonlySet<string>;
  traits: ReadonlySet<string>;
  skills: ReadonlySet<string>;
  roles: ReadonlySet<string>;
  ranks: ReadonlySet<string>;
  tags: ReadonlySet<string>;
  states: ReadonlySet<string>;
  combos: ReadonlySet<string>;
  statuses: ReadonlySet<string>;
  /** Every id a status, or an effect a tag defines, goes by in a fight, and every name the report counts one under. */
  effects: ReadonlySet<string>;
  /** The hook ids the content names, and the ones of the engine. */
  specials: ReadonlySet<string>;
  basicSkill: SkillId | null;
  /** The smallest size of a hook timer. */
  timerMin: number;
}

const vocabs = new WeakMap<ContentDb, Vocab>();

function vocabOf(content: ContentDb): Vocab {
  let v = vocabs.get(content);
  if (!v) {
    const ids = (list: readonly { id: string }[]) => new Set(list.map((e) => e.id));
    const effects = new Set<string>();
    for (const st of content.statuses) {
      effects.add(st.id);
      if (st.tally) effects.add(st.tally.as);
    }
    for (const tag of content.tags) {
      for (const op of [...(tag.onHit ?? []), ...(tag.onUse ?? [])]) {
        if (op.op !== 'effect') continue;
        effects.add(op.id);
        if (op.tally) effects.add(op.tally.as);
      }
    }
    const specials = new Set<string>([TEAM_HOOK]);
    for (const t of content.traits) if (t.hook !== undefined) specials.add(t.hook);
    for (const b of content.bosses) {
      specials.add(b.special.hook);
      if (b.special.companions) specials.add(b.special.companions.hook);
    }
    v = {
      natures: ids(content.natures),
      traits: ids(content.traits),
      skills: ids(content.skills),
      roles: ids(content.roles),
      ranks: ids(content.techRanks),
      tags: ids(content.tags),
      states: ids(content.states),
      combos: ids(content.combos),
      statuses: ids(content.statuses),
      effects,
      specials,
      basicSkill: fightData(content).basicSkill,
      timerMin: needOf(content.balance.K.combat.timerMinMs),
    };
    vocabs.set(content, v);
  }
  return v;
}

/** An effect id of the engine or of the pack core is bare; one of another pack names a status, trait or special of its own. */
function knownEffect(id: string, v: Vocab): boolean {
  const base = id.split('#')[0] ?? id;
  return !base.includes(':') || v.effects.has(base) || v.traits.has(base) || v.specials.has(base);
}

/** The ids of a list that the vocabulary knows; the rest are dropped. */
const known = (list: readonly string[], set: ReadonlySet<string>): string[] =>
  list.filter((id) => set.has(id));

type Raw = Record<string, unknown>;

const isRecord = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const nonNeg = (x: unknown): x is number => isNum(x) && x >= 0;
const share = (x: unknown): x is number => isNum(x) && x >= 0 && x <= 1;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T =>
  typeof x === 'string' && (list as readonly string[]).includes(x);
const inSet = (set: ReadonlySet<string>, x: unknown): x is string =>
  typeof x === 'string' && set.has(x);

const MOD_STATS: readonly ModStat[] = [
  'accuracy',
  'evasion',
  'speed',
  'damageTaken',
  'taiDamage',
  'resist',
];
const KIT_EFFECTS: readonly KitEffect['kind'][] = [
  'damage',
  'none',
  'cleanse',
  'stance',
  'nextCast',
  'reveal',
];
const RESULTS: readonly FightResult[] = ['ongoing', 'victory', 'defeat', 'fled', 'timeout', 'void'];
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

/** An effect read back; `'drop'` for one whose status, trait or nature the content does not have. */
function parseEffect(raw: unknown, t: number, v: Vocab): Effect | 'drop' | null {
  if (!isRecord(raw) || !isStr(raw.id) || !isStr(raw.src)) return null;
  if (!knownEffect(raw.id, v)) return 'drop';
  if (raw.stacks !== undefined && (!isInt(raw.stacks) || raw.stacks < 1)) return null;
  if (raw.unit !== undefined && !nonNeg(raw.unit)) return null;
  if (raw.until !== null && !isInt(raw.until)) return null;
  if (raw.suppresses !== undefined && !isStr(raw.suppresses)) return null;
  if (raw.whileAlive !== undefined && !isStr(raw.whileAlive)) return null;
  const base = {
    id: raw.id,
    src: raw.src,
    until: raw.until === null ? null : Math.max(raw.until as number, t),
    ...(raw.suppresses === undefined ? {} : { suppresses: raw.suppresses }),
    ...(raw.whileAlive === undefined ? {} : { whileAlive: raw.whileAlive }),
    ...(raw.stacks === undefined ? {} : { stacks: raw.stacks }),
    ...(raw.unit === undefined ? {} : { unit: raw.unit }),
  };
  if (raw.kind === 'modifier') {
    if (!oneOf(MOD_STATS, raw.stat) || !isNum(raw.value)) return null;
    if (raw.op !== 'mul' && raw.op !== 'add') return null;
    if (raw.value < 0 || raw.value > MOD_LIMIT) return null;
    if (raw.nature !== undefined && !inSet(v.natures, raw.nature)) return 'drop';
    return {
      ...base,
      kind: 'modifier',
      stat: raw.stat,
      op: raw.op,
      value: raw.value,
      ...(raw.nature === undefined ? {} : { nature: raw.nature }),
    };
  }
  if (raw.kind === 'periodic') {
    if (raw.mode !== 'damage' && raw.mode !== 'heal' && raw.mode !== 'stamina') return null;
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

const EVASION_SOURCES = ['base', 'tier', 'technique', 'modifiers'] as const;
const ACT_KINDS = ['technique', 'basic', 'item', 'attack', 'rest'] as const;

/** An action of a combatant: `undefined` for none, `null` when it is not a usable one. */
function parseAct(raw: unknown, side: Combatant['side']): FightAct | null | undefined {
  if (raw === null) return undefined;
  if (!isRecord(raw) || !oneOf(ACT_KINDS, raw.kind)) return null;
  if (raw.id !== null && !isStr(raw.id)) return null;
  if (raw.target !== null && !isStr(raw.target)) return null;
  const kind = raw.kind;
  const own = side === 'player' ? kind !== 'attack' : kind === 'attack';
  if (!own || (kind === 'technique' || kind === 'item') !== (raw.id !== null)) return null;
  return { kind, id: raw.id, target: raw.target };
}

/** The last action of a combatant: `undefined` for none, `null` when it is not a usable one. */
function parseLast(raw: unknown, t: number): LastAct | null | undefined {
  if (raw === null) return undefined;
  if (!isRecord(raw) || !oneOf(ACT_KINDS, raw.kind)) return null;
  if (raw.id !== null && !isStr(raw.id)) return null;
  if (!oneOf(['hit', 'miss', 'interrupted', 'none'] as const, raw.outcome)) return null;
  if (!nonNeg(raw.damage) || !isInt(raw.at) || raw.at < 0 || raw.at > t) return null;
  if (!Array.isArray(raw.statuses) || !raw.statuses.every(isStr)) return null;
  if (!Array.isArray(raw.combos) || !raw.combos.every(isStr)) return null;
  if (raw.avoidedBy !== null && !isStr(raw.avoidedBy)) return null;
  return {
    avoidedBy: raw.avoidedBy,
    kind: raw.kind,
    id: raw.id,
    outcome: raw.outcome,
    damage: raw.damage as number,
    statuses: raw.statuses as string[],
    combos: raw.combos as string[],
    at: raw.at,
  };
}

function parseTimer(raw: unknown, size: number): Timer | null {
  if (!isRecord(raw) || !isInt(raw.progress) || !isInt(raw.need)) return null;
  if (raw.progress < 0 || raw.need < size) return null;
  return { progress: Math.min(raw.progress, raw.need), need: raw.need };
}

function parseCombatant(
  raw: unknown,
  side: Combatant['side'],
  t: number,
  v: Vocab,
): Combatant | null {
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
  if (!figures.every(nonNeg) || !isInt(raw.waitMs) || raw.waitMs < 1) return null;
  if (!isInt(raw.strikeMs) || raw.strikeMs < 1) return null;
  if ((raw.maxHp as number) <= 0) return null;
  // A fighter waits or acts; only the player rests. A fight saved before the loop of waits and actions has none of this and is not read.
  const phases = side === 'player' ? ['wait', 'act', 'rest'] : ['wait', 'act'];
  if (typeof raw.phase !== 'string' || !phases.includes(raw.phase)) return null;
  const phase = raw.phase as Combatant['phase'];
  const act = parseAct(raw.act, side);
  if (act === null || (phase === 'wait') !== (act === undefined)) return null;
  if (phase === 'rest' && act?.kind !== 'rest') return null;
  if (!isInt(raw.phaseAt) || raw.phaseAt < 0 || raw.phaseAt > t) return null;
  const last = parseLast(raw.last, t);
  if (last === null) return null;
  if (raw.nature !== null && !isStr(raw.nature)) return null;
  if (!Array.isArray(raw.traits) || !raw.traits.every(isStr)) return null;
  if (!Array.isArray(raw.specials) || !raw.specials.every(isStr)) return null;
  if (!Array.isArray(raw.effects)) return null;
  const effects: Effect[] = [];
  for (const e of raw.effects) {
    const effect = parseEffect(e, t, v);
    if (effect === null) return null;
    if (effect !== 'drop') effects.push(effect);
  }
  const cd = numberRecord(raw.cd);
  const data = numberRecord(raw.data);
  const timer = parseTimer(raw.timer, needOf(1));
  if (!cd || !data || !timer || !isRecord(raw.timers)) return null;
  const timers: Record<string, Timer> = {};
  for (const [name, value] of Object.entries(raw.timers)) {
    const parsed = parseTimer(value, v.timerMin);
    if (!parsed) return null;
    timers[name] = parsed;
  }
  if (raw.wardUntil !== null && !isInt(raw.wardUntil)) return null;
  if (!isInt(raw.decoys) || raw.decoys < 0) return null;
  if (raw.decoyUntil !== null && !isInt(raw.decoyUntil)) return null;
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
    waitMs: raw.waitMs,
    strikeMs: raw.strikeMs,
    // A nature, trait or special of a pack that is not loaded is dropped: the body fights without it.
    nature: inSet(v.natures, raw.nature) ? raw.nature : null,
    traits: known(raw.traits as string[], v.traits),
    // A special is a hook id: one nothing registers does nothing, so it is kept as it is.
    specials: raw.specials as string[],
    effects,
    cd,
    phase,
    act: act ?? null,
    phaseAt: raw.phaseAt,
    last: last ?? null,
    timer,
    timers,
    data,
    ward: raw.ward as number,
    wardUntil: raw.wardUntil === null ? null : Math.max(raw.wardUntil as number, t),
    decoys: raw.decoys,
    decoyUntil: raw.decoyUntil === null ? null : Math.max(raw.decoyUntil as number, t),
    fleeAt: raw.fleeAt,
    fled: raw.fled,
  };
}

function parseKitEffect(raw: unknown): KitEffect | null {
  if (!isRecord(raw) || !oneOf(KIT_EFFECTS, raw.kind)) return null;
  const figures = [raw.amount, raw.mult, raw.drain, raw.wounds];
  if (!figures.every(nonNeg) || !isInt(raw.durationMs) || raw.durationMs < 0) return null;
  if (!isInt(raw.everyMs) || raw.everyMs < 0) return null;
  if (!Array.isArray(raw.statuses) || !raw.statuses.every(isStr)) return null;
  return {
    kind: raw.kind,
    amount: raw.amount as number,
    mult: raw.mult as number,
    durationMs: raw.durationMs,
    drain: raw.drain as number,
    wounds: raw.wounds as number,
    everyMs: raw.everyMs,
    statuses: raw.statuses as string[],
  };
}

function parseKit(raw: unknown, content: ContentDb, v: Vocab): PlayerKit | null {
  if (!isRecord(raw) || !Array.isArray(raw.techniques)) return null;
  if (!nonNeg(raw.med) || !nonNeg(raw.chakraRegen) || !nonNeg(raw.staminaRegen)) return null;
  if (!nonNeg(raw.toolDamage)) return null;
  const known = new Set(content.techniques.map((t) => t.id));
  if (!Array.isArray(raw.evasion)) return null;
  const evasion: EvasionPart[] = [];
  for (const p of raw.evasion) {
    if (!isRecord(p) || !oneOf(EVASION_SOURCES, p.source) || !nonNeg(p.value)) return null;
    if (p.id !== null && !(isStr(p.id) && known.has(p.id))) return null;
    const optional = ['full', 'skillLevel', 'masteryLevel', 'effectiveLevel', 'ratio'] as const;
    if (optional.some((k) => p[k] !== undefined && !nonNeg(p[k]))) return null;
    if (p.levelAdj !== undefined && !Number.isFinite(p.levelAdj)) return null;
    const part: EvasionPart = { source: p.source, id: p.id, value: p.value };
    for (const k of optional) if (p[k] !== undefined) part[k] = p[k] as number;
    if (p.levelAdj !== undefined) part.levelAdj = p.levelAdj as number;
    evasion.push(part);
  }
  const techniques: KitTechnique[] = [];
  for (const t of raw.techniques) {
    if (!isRecord(t) || !isStr(t.id) || !known.has(t.id)) return null;
    if (!inSet(v.skills, t.skill) || !inSet(v.roles, t.role) || !inSet(v.ranks, t.rank)) {
      return null;
    }
    if (!Array.isArray(t.tags) || !t.tags.every((tag) => inSet(v.tags, tag))) return null;
    if (t.state !== null && !inSet(v.states, t.state)) return null;
    if (t.pool !== 'chakra' && t.pool !== 'stamina') return null;
    // A cast takes at least a millisecond, or the player would act again without time passing.
    if (!isInt(t.castMs) || t.castMs < 1 || !isInt(t.cooldownMs) || t.cooldownMs < 0) return null;
    if (!share(t.comboChance)) return null;
    const figures = [t.damage, t.cost, t.accuracy, t.habituationMult];
    if (!figures.every(nonNeg) || typeof t.hitsAll !== 'boolean') return null;
    if (t.guaranteedCombo !== null && !isStr(t.guaranteedCombo)) return null;
    const fx = parseKitEffect(t.fx);
    if (!fx || typeof t.requiresStance !== 'boolean') return null;
    techniques.push({
      id: t.id,
      skill: t.skill as SkillId,
      role: t.role,
      rank: t.rank as Rank,
      tags: t.tags as string[],
      state: t.state,
      damage: t.damage as number,
      castMs: t.castMs,
      cooldownMs: t.cooldownMs,
      pool: t.pool,
      cost: t.cost as number,
      accuracy: t.accuracy as number,
      comboChance: t.comboChance,
      hitsAll: t.hitsAll,
      // A combo of a pack that is not loaded cannot fire any more.
      guaranteedCombo: inSet(v.combos, t.guaranteedCombo) ? t.guaranteedCombo : null,
      habituationMult: t.habituationMult as number,
      fx,
      requiresStance: t.requiresStance,
    });
  }
  return {
    techniques,
    toolDamage: raw.toolDamage,
    med: raw.med,
    chakraRegen: raw.chakraRegen,
    staminaRegen: raw.staminaRegen,
    evasion,
  };
}

function parseTally(raw: unknown, v: Vocab): FightTally | null {
  if (!isRecord(raw) || !isStr(raw.style)) return null;
  const damage = numberRecord(raw.damage);
  const uses = numberRecord(raw.uses);
  const statuses = numberRecord(raw.statuses);
  const combos = numberRecord(raw.combos);
  // What counts a status or a combo that the content no longer has is dropped.
  if (statuses)
    for (const key of Object.keys(statuses)) if (!knownEffect(key, v)) delete statuses[key];
  if (combos) for (const key of Object.keys(combos)) if (!v.combos.has(key)) delete combos[key];
  const masteryWork = numberRecord(raw.masteryWork);
  if (!damage || !uses || !statuses || !combos || !masteryWork) return null;
  const scalars = [
    raw.basic,
    raw.interrupts,
    raw.kills,
    raw.taken,
    raw.time,
    raw.lastUseAt,
    raw.wounds,
    raw.woundMin,
  ];
  if (!scalars.every(nonNeg)) return null;
  // A style of a skill that is not loaded falls back to the style of basic attacks; with none, there is no fight to read.
  const style = v.skills.has(raw.style) ? raw.style : v.basicSkill;
  if (style === null) return null;
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
    // A style of a skill that is not loaded falls back to the style of basic attacks.
    style: style as SkillId,
    lastUseAt: raw.lastUseAt as number,
    masteryWork,
    wounds: raw.wounds as number,
    woundMin: raw.woundMin as number,
  };
}

function parseEncounter(raw: unknown, most: number, v: Vocab): Encounter | null {
  if (!isRecord(raw) || !isStr(raw.id) || !Array.isArray(raw.spawns)) return null;
  if (!Array.isArray(raw.specials) || !raw.specials.every(isStr)) return null;
  if (raw.spawns.length < 1 || raw.spawns.length > most) return null;
  const spawns: Spawn[] = [];
  for (const s of raw.spawns) {
    if (!isRecord(s) || !isStr(s.enemy) || !isInt(s.cl) || s.cl < 0) return null;
    if (!Array.isArray(s.traits) || !s.traits.every(isStr)) return null;
    if (s.nature !== null && !isStr(s.nature)) return null;
    if (!isInt(s.count) || s.count < 1 || s.count > most) return null;
    if (!isNum(s.hpMult) || s.hpMult <= 0 || !nonNeg(s.dmgMult)) return null;
    if (s.fleeAt !== null && !share(s.fleeAt)) return null;
    if (!Array.isArray(s.specials) || !s.specials.every(isStr)) return null;
    spawns.push({
      enemy: s.enemy,
      cl: s.cl,
      traits: known(s.traits as string[], v.traits),
      nature: s.nature === 'wheel' || inSet(v.natures, s.nature) ? s.nature : null,
      count: s.count,
      hpMult: s.hpMult,
      dmgMult: s.dmgMult as number,
      fleeAt: s.fleeAt,
      specials: s.specials as string[],
    });
  }
  const encounter: Encounter = {
    id: raw.id,
    spawns,
    specials: raw.specials as string[],
  };
  if (raw.support !== undefined) {
    if (!Array.isArray(raw.support) || raw.support.length > 2) return null;
    const support: TeamSupport[] = [];
    for (const s of raw.support) {
      if (!isRecord(s) || !isStr(s.nature)) return null;
      if (!isInt(s.everyMs) || s.everyMs < 1 || !isNum(s.damage) || s.damage < 0) return null;
      // A teammate whose nature is not loaded gives no support.
      if (v.natures.has(s.nature)) {
        support.push({ nature: s.nature, everyMs: s.everyMs, damage: s.damage });
      }
    }
    encounter.support = support;
  }
  return encounter;
}

/** The battle log lines still to be read; lines that do not fit are dropped, an absent log is empty. */
const LOG_ACTS = ['cast', 'resolve', 'interrupted', 'hit', 'miss'] as const;

function parseLog(raw: unknown): FightLogLine[] | null {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return [];
  const lines: FightLogLine[] = [];
  for (const l of raw) {
    if (!isRecord(l) || (l.side !== 'player' && l.side !== 'enemy') || !isNum(l.dmg)) continue;
    if (!oneOf(LOG_ACTS, l.act)) continue;
    if (l.tech !== null && !isStr(l.tech)) continue;
    lines.push({
      side: l.side,
      act: l.act,
      tech: l.tech,
      dmg: l.dmg,
      ...(isStr(l.by) ? { by: l.by } : {}),
      ...(isStr(l.via) ? { via: l.via } : {}),
    });
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

function parsePouch(raw: unknown, content: ContentDb): PouchSlot[] | null {
  const most = content.balance.K.pouch.slots + content.balance.K.pouch.vest;
  if (!Array.isArray(raw) || raw.length > most) return null;
  const items = new Set(content.items.map((i) => i.id));
  const slots: PouchSlot[] = [];
  for (const s of raw) {
    if (!isRecord(s) || !isStr(s.id) || !isInt(s.n) || s.n < 0) return null;
    if (s.id !== '' && !items.has(s.id)) return null;
    slots.push({ id: s.id, n: s.n });
  }
  return slots;
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
  const v = vocabOf(content);
  const encounter = parseEncounter(raw.encounter, most, v);
  const player = parseCombatant(raw.player, 'player', t, v);
  if (!encounter || !player || !Array.isArray(raw.enemies)) return null;
  // Dead bodies are dropped when a new one spawns, so the list is at most twice the cap.
  if (raw.enemies.length < 1 || raw.enemies.length > most + most) return null;
  const enemies: Combatant[] = [];
  for (const e of raw.enemies) {
    const enemy = parseCombatant(e, 'enemy', t, v);
    if (!enemy) return null;
    enemies.push(enemy);
  }
  const kit = parseKit(raw.kit, content, v);
  const uses = numberRecord(raw.uses);
  const tally = parseTally(raw.tally, v);
  const knowledge = parseKnowledge(raw.knowledge);
  const pouch = parsePouch(raw.pouch, content);
  if (!kit || !uses || !tally || !knowledge || !pouch) return null;
  if (raw.medic !== null && (!isInt(raw.medic) || raw.medic < 0 || raw.medic >= pouch.length)) {
    return null;
  }
  if (!Array.isArray(raw.natures) || !raw.natures.every(isStr)) return null;
  if (raw.target !== null && !isStr(raw.target)) return null;
  // A player who is casting a technique casts one of the kit; one using an item uses one it has.
  const doing = player.act;
  if (doing?.kind === 'technique' && !kit.techniques.some((x) => x.id === doing.id)) return null;
  if (doing?.kind === 'item' && !pouch.some((x) => x.id === doing.id)) return null;
  if (doing?.kind === 'attack') return null;
  if (enemies.some((e) => e.act !== null && e.act.kind !== 'attack')) return null;
  const w = rng as number[];
  const state: RngState = [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0, w[3] ?? 0];
  const fault =
    isRecord(raw.fault) && isStr(raw.fault.pack) && isStr(raw.fault.hook) && isStr(raw.fault.reason)
      ? { pack: raw.fault.pack, hook: raw.fault.hook, reason: raw.fault.reason }
      : undefined;
  return {
    t,
    cap: raw.cap,
    rng: state,
    result: raw.result,
    ...(fault ? { fault } : {}),
    enemy: raw.enemy,
    encounter,
    spawned: raw.spawned,
    player,
    enemies,
    kit,
    tier: raw.tier,
    natures: known(raw.natures as string[], v.natures),
    target: raw.target,
    knowledge,
    pouch,
    medic: raw.medic as number | null,
    uses,
    // The next regeneration is within one step of the clock.
    poolAt: Math.min(Math.max(raw.poolAt, t), t + workOf(K.combat.regenMs)),
    tally,
    log: parseLog(raw.log),
  };
}
