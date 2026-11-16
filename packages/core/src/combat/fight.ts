import type { AiTier, ContentDb, SkillId, Technique } from '@shinobi/content';
import { createStream, nextFloatFrom } from '../rng.ts';
import { addEffect, findEffect, isSuppressed, removeEffect, statOf } from './fight-effects.ts';
import { figure, need } from './need.ts';
import { answersTraitData, balanceOf, beatenBy, fightData, type TraitMod } from './fight-data.ts';
import {
  disabledCount,
  fault,
  guard,
  isBoolean,
  isDisabled,
  isFactor,
  timerOwner,
  trusted,
  validCastInfo,
  type GuardOptions,
} from './fight-guard.ts';

import { applyItem, itemView } from './fight-items.ts';
import {
  applyStatus,
  comboPriors,
  comboScale,
  removeTagged,
  runCombos,
  runTagOps,
} from './fight-status.ts';
import { TEAM_HOOK } from './fight-team-id.ts';
import type {
  Combatant,
  AttackPlan,
  Decision,
  Encounter,
  FightAct,
  FightCtx,
  FightHook,
  FightRules,
  FightState,
  FightTally,
  FightView,
  KitEffect,
  KitTechnique,
  ModStat,
  PeriodicEffect,
  PlayerKit,
  Spawn,
  Timer,
  ViewEffect,
  ViewEnemy,
  ViewTechnique,
} from './fight-types.ts';
import {
  accuracyOf,
  accuracyTierTerm,
  basicAttackOf,
  chakraRegenOf,
  enemyStats,
  evasionOf,
  evasionParts,
  evasionTierTerm,
  KNOWLEDGE_MAX,
  knowledgeTerm,
  hitChance,
  maxChakraOf,
  maxHpOf,
  maxStaminaOf,
  secMs,
  staminaRegenOf,
  techniqueFigures,
  type PlayerSnapshot,
} from './numbers.ts';
import { needOf, RATE_FULL, TICK_MS, WORK_PER_MS, workOf } from './units.ts';

/** Zero-length steps tolerated in a row before the engine declares itself stuck. */
const STALL_LIMIT = 10_000;

export const alive = (c: Combatant): boolean => c.hp > 0;

/** Work units in a number of seconds of the balance object. */
export const secWork = (seconds: number): number => workOf(secMs(seconds));

function emptyTally(style: SkillId): FightTally {
  return {
    damage: {},
    uses: {},
    basic: 0,
    statuses: {},
    combos: {},
    interrupts: 0,
    kills: 0,
    taken: 0,
    time: 0,
    style,
    lastUseAt: 0,
    masteryWork: {},
    wounds: 0,
    woundMin: 0,
  };
}

/** A deep copy of plain JSON. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const count = (record: Record<string, number>, key: string, n = 1): void => {
  record[key] = (record[key] ?? 0) + n;
};

/** What hooks and helpers work with. */
export const makeCtx = (fight: FightState, content: ContentDb, rules: FightRules): FightCtx => ({
  fight,
  content,
  rules,
});

/** A hook a combatant carries and the trait it comes from (null: it is one of the body's own specials). */
export interface Binding {
  hook: FightHook;
  trait: string | null;
}

interface Bound {
  rules: readonly FightHook[];
  content: ContentDb;
  /** Hooks of the rule set that were switched off when this was made. */
  off: number;
  traits: readonly string[];
  specials: readonly string[];
  /** The hooks in the order of the rule set, with the trait each comes from. */
  list: Binding[];
  hooks: FightHook[];
  /** The stat modifiers its traits declare in data, with the trait they stop with. */
  mods: { trait: string; mod: TraitMod }[];
}

const bound = new WeakMap<Combatant, Bound>();

/**
 * What a combatant carries: the hook of each of its traits (named by the trait's data), the hooks
 * its specials name, and the stat modifiers its traits declare. Found once per body, in the order
 * of the rule set; an id nothing registered (a pack that is not loaded) is ignored.
 */
export function boundOf(ctx: FightCtx, c: Combatant): Bound {
  const rules = ctx.rules.fightHooks;
  const have = bound.get(c);
  if (
    have &&
    have.rules === rules &&
    have.content === ctx.content &&
    have.off === disabledCount(rules) &&
    sameIds(have.traits, c.traits) &&
    sameIds(have.specials, c.specials)
  ) {
    return have;
  }
  const data = fightData(ctx.content);
  const ids = new Map<string, string | null>();
  const mods: Bound['mods'] = [];
  for (const trait of c.traits) {
    const def = data.traits.get(trait);
    if (!def) continue;
    if (def.hook !== null && !ids.has(def.hook)) ids.set(def.hook, trait);
    for (const mod of def.mods) mods.push({ trait, mod });
  }
  for (const special of c.specials) if (!ids.has(special)) ids.set(special, null);
  const list: Binding[] = [];
  for (const hook of rules) {
    const trait = ids.get(hook.id);
    if (trait !== undefined && !isDisabled(rules, hook)) list.push({ hook, trait });
  }
  const made: Bound = {
    rules,
    content: ctx.content,
    off: disabledCount(rules),
    traits: [...c.traits],
    specials: [...c.specials],
    list,
    hooks: list.map((b) => b.hook),
    mods,
  };
  bound.set(c, made);
  // Every hook publishes what it derives before any hook starts or reads: the order of the rule set never matters.
  for (const hook of made.hooks) {
    if (hook.publish) guard(ctx, hook, () => hook.publish?.(ctx, c), undefined);
  }
  return made;
}

/** What a guarded call of a hook of a body may change: the body and the player. */
const bodiesOf = (ctx: FightCtx, c: Combatant, event: boolean): GuardOptions<void | undefined> => ({
  bodies: c === ctx.fight.player ? [c] : [c, ctx.fight.player],
  event,
});
const FACTOR: GuardOptions<number> = { check: isFactor };
const BOOLEAN: GuardOptions<boolean> = { check: isBoolean };
const CAST_INFO: GuardOptions<ReturnType<NonNullable<FightHook['castInfo']>>> = {
  check: validCastInfo,
};

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** The hooks a combatant carries, in the order of the rule set. */
export function hooksOf(ctx: FightCtx, c: Combatant): FightHook[] {
  return boundOf(ctx, c).hooks;
}

/** A stat after effects, the modifiers its traits declare and hooks. */
export function stat(ctx: FightCtx, c: Combatant, which: ModStat, base: number): number {
  let value = statOf(c, which, base);
  const b = boundOf(ctx, c);
  if (b.mods.length > 0) {
    const K = balanceOf(ctx.content);
    for (const { trait, mod } of b.mods) {
      if (mod.stat !== which || isSuppressed(c, trait)) continue;
      value *= mod.op === 'mul' ? mod.value(K) : 1 + mod.value(K);
    }
  }
  for (const hook of b.hooks) {
    const f = hook.stat;
    if (f) value *= guard(ctx, hook, () => f.call(hook, ctx, c, which), 1, FACTOR);
  }
  return value;
}

/** Timer speed in thousandths of full speed; 0 while stunned. */
export const speed = (ctx: FightCtx, c: Combatant): number =>
  Math.max(0, Math.round(stat(ctx, c, 'speed', RATE_FULL)));

export function roll(fight: FightState, chance: number): boolean {
  return nextFloatFrom(fight.rng) < chance;
}

// ---------- creation ----------

/** The share of the combat stats that Wound stacks leave. */
export function woundFactor(wounds: number, content: ContentDb): number {
  const w = content.balance.K.wound;
  return Math.max(0, 1 - w.stat * Math.min(w.max, Math.max(0, wounds)));
}

/** What a technique does besides damage, with the numbers of the balance object resolved for this player. */
function kitEffect(tech: Technique, snap: PlayerSnapshot, content: ContentDb): KitEffect {
  const K = content.balance.K;
  const fx: KitEffect = {
    kind: 'damage',
    amount: 0,
    mult: 1,
    durationMs: 0,
    drain: 0,
    wounds: 0,
    everyMs: 0,
    statuses: [],
  };
  const effect = tech.combat?.effect;
  if (!effect || tech.rank === null) return fx;
  fx.kind = effect.kind;
  // The numbers of an effect are the row of `K.techFx` its data names.
  const techFx: Record<string, Record<string, number> | undefined> = K.techFx;
  const row = (key: string) => need(techFx[key], `techFx.${key}`);
  switch (effect.kind) {
    case 'cleanse':
      fx.statuses = [...effect.statuses];
      break;
    case 'stance': {
      const gate = row(effect.fx);
      fx.mult = figure(gate, 'taiDamage', `techFx.${effect.fx}`);
      fx.drain = figure(gate, 'staminaPerSec', `techFx.${effect.fx}`);
      fx.wounds = figure(gate, 'woundsAfter', `techFx.${effect.fx}`);
      break;
    }
    case 'nextCast':
      fx.mult = figure(row(effect.fx), 'castMult', `techFx.${effect.fx}`);
      break;
    case 'reveal':
      fx.durationMs = figure(row(effect.fx), 'durationMs', `techFx.${effect.fx}`);
      break;
    default:
      break;
  }
  return fx;
}

function buildKit(snap: PlayerSnapshot, content: ContentDb): PlayerKit {
  const K = content.balance.K;
  const known = new Set(snap.known);
  const loadout = snap.loadout ? new Set(snap.loadout) : null;
  const wound = woundFactor(snap.wounds ?? 0, content);
  const techniques: KitTechnique[] = [];
  let style = 0;
  const data = fightData(content);
  for (const skill of data.techSkills) style = Math.max(style, snap.levels[skill] ?? 0);
  for (const tech of content.techniques) {
    if (!known.has(tech.id) || tech.rank === null) continue;
    // A defensive technique is passive: it adds to the evasion rating and is never in the hand.
    if (tech.combat?.passive !== undefined) continue;
    if (loadout && !loadout.has(tech.id) && !tech.combat?.outOfLoadout) continue;
    const n = techniqueFigures(snap, tech, content);
    const mastery = snap.mastery[tech.id] ?? 1;
    techniques.push({
      id: tech.id,
      skill: tech.skill,
      role: tech.role,
      rank: tech.rank,
      tags: [...tech.tags],
      state: tech.state,
      damage: n.damage * wound,
      castMs: n.castMs,
      cooldownMs: n.cooldownMs,
      pool: n.pool,
      cost: n.cost,
      accuracy:
        (accuracyOf(snap.levels, tech.skill, content) + accuracyTierTerm(snap.tier ?? 0, content)) *
        wound,
      comboChance: Math.min(
        figure(K.combo, 'cap', 'combo'),
        figure(K.combo, 'base', 'combo') +
          figure(K.combo, 'perLevel', 'combo') * (snap.levels[tech.skill] ?? 1) +
          figure(K.combo, 'perMastery', 'combo') * mastery,
      ),
      hitsAll:
        data.wideRoles.has(tech.role) ||
        tech.tags.some((tag) => data.tags.get(tag)?.hitsAll === true) ||
        tech.combat?.hitsAll === true,
      guaranteedCombo: tech.combat?.guaranteedCombo ?? null,
      habituationMult: snap.signature === tech.id ? K.signatureHabituation : 1,
      fx: kitEffect(tech, snap, content),
      requiresStance: tech.combat?.requiresStance === true,
    });
  }
  return {
    techniques,
    toolDamage: (K.toolTag[0] + K.toolTag[1] * style) * wound,
    med: snap.levels.med ?? 1,
    chakraRegen: chakraRegenOf(snap.levels, content),
    staminaRegen: staminaRegenOf(snap.levels, content),
    evasion: evasionParts(snap, content),
  };
}

/** The nature an enemy fights with; `wheel` is the one that beats the player's first nature. */
function natureOf(spawn: Spawn, natures: readonly string[], content: ContentDb): string | null {
  if (spawn.nature !== 'wheel') return spawn.nature;
  const first = natures[0];
  if (!first) return null;
  return beatenBy(content, first);
}

const idleTimer = (): Timer => ({ progress: 0, need: 0 });

/** The key of the player's data that holds how well the player knows an enemy entry. */
const knowKey = (entry: string): string => `know.${entry}`;

/** The rating a target defends with against `attacker`: its evasion, and for the player what knowing the attacker adds, then the stat modifiers. */
export function evasionAgainst(ctx: FightCtx, target: Combatant, attacker: Combatant): number {
  let base = target.evasion;
  if (target.side === 'player' && attacker.side === 'enemy') {
    const level = target.data[knowKey(attacker.entry)] ?? KNOWLEDGE_MAX;
    base += knowledgeTerm(level, ctx.content);
  }
  return stat(ctx, target, 'evasion', base);
}

/** The defensive technique that did an avoidance, chosen among the ones the player knows in proportion to what each adds to the rating; null when none. */
function avoidedBy(ctx: FightCtx): string | null {
  const parts = ctx.fight.kit.evasion.filter((p) => p.source === 'technique' && p.value > 0);
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (total <= 0) return null;
  let at = nextFloatFrom(ctx.fight.rng) * total;
  for (const p of parts) {
    at -= p.value;
    if (at < 0) return p.id;
  }
  return parts[parts.length - 1]?.id ?? null;
}

/** The AI tier an enemy body waits by: the tier its data names, else the highest tier whose combat level it reaches. */
function enemyTierOf(content: ContentDb, spawn: Spawn): AiTier {
  const named = enemyEntryOf(content, spawn.enemy)?.aiTier;
  const tiers = content.ai.tiers;
  const byName = named ? tiers.find((t) => t.id === named) : undefined;
  if (byName) return byName;
  const from: Record<string, number> = content.balance.K.ai.enemyTier;
  let chosen = tiers[0];
  let at = -1;
  for (const t of tiers) {
    const level = from[t.id];
    if (level !== undefined && spawn.cl >= level && level > at) [chosen, at] = [t, level];
  }
  if (!chosen) throw new Error('the content has no AI tier');
  return chosen;
}

const entryIndexes = new WeakMap<ContentDb, Map<string, { aiTier?: string | null | undefined }>>();
function enemyEntryOf(
  content: ContentDb,
  id: string,
): { aiTier?: string | null | undefined } | undefined {
  let index = entryIndexes.get(content);
  if (!index) {
    index = new Map([...content.enemies, ...content.bosses].map((e) => [e.id, e]));
    entryIndexes.set(content, index);
  }
  return index.get(id);
}

/**
 * Puts `n` more bodies of `fight.encounter.spawns[spawnIndex]` into a running fight, as far as
 * the cap on living enemies allows (dead bodies are dropped first). Returns the new bodies.
 */
export function spawnEnemies(
  fight: FightState,
  spawnIndex: number,
  content: ContentDb,
  rules: FightRules,
  n = 1,
): Combatant[] {
  const spawn = fight.encounter.spawns[spawnIndex];
  if (!spawn) return [];
  return addBodies(makeCtx(fight, content, rules), spawn, n, false);
}

/** The effects a body's traits give it from data: a trait that heals a share of health every second. */
function initTraits(ctx: FightCtx, c: Combatant): void {
  const data = fightData(ctx.content);
  const K = balanceOf(ctx.content);
  for (const trait of c.traits) {
    const def = data.traits.get(trait);
    if (!def?.regen) continue;
    addEffect(c, {
      kind: 'periodic',
      id: trait,
      src: `trait:${trait}`,
      until: null,
      mode: 'heal',
      amount: def.regen(K) * c.maxHp,
      every: workOf(TICK_MS),
      next: ctx.fight.t + workOf(TICK_MS),
    });
  }
}

function addBodies(ctx: FightCtx, spawn: Spawn, n: number, staggered: boolean): Combatant[] {
  const { fight, content } = ctx;
  const K = content.balance.K;
  fight.enemies = fight.enemies.filter(alive);
  const room = Math.max(0, K.combat.maxEnemies - fight.enemies.length);
  const bodies = Math.min(n, room);
  const stats = enemyStats(spawn, content);
  const maxHp = stats.maxHp * spawn.hpMult;
  const added: Combatant[] = [];
  // An enemy waits for the moment as long as its AI tier says, then winds its attack up for the rest of its cycle.
  const tier = enemyTierOf(content, spawn);
  const waitMs = tier.waitMs;
  const strikeMs = Math.max(secMs(K.castFloor), stats.intervalMs - waitMs);
  for (let i = 0; i < bodies; i++) {
    const c: Combatant = {
      id: `${spawn.enemy}#${fight.spawned++}`,
      side: 'enemy',
      entry: spawn.enemy,
      hp: maxHp,
      maxHp,
      chakra: 0,
      maxChakra: 0,
      stamina: 0,
      maxStamina: 0,
      accuracy: stats.accuracy + accuracyTierTerm(tier.minTier, content, true),
      evasion: stats.evasion + evasionTierTerm(tier.minTier, content, true),
      damage: stats.damage * spawn.dmgMult,
      waitMs,
      strikeMs,
      nature: natureOf(spawn, fight.natures, content),
      traits: [...spawn.traits],
      specials: [...fight.encounter.specials, ...spawn.specials],
      effects: [],
      cd: {},
      phase: 'wait',
      act: null,
      phaseAt: fight.t,
      last: null,
      // Bodies that start together are staggered so they do not all strike at once.
      timer: {
        progress: 0,
        need:
          needOf(waitMs) + (staggered ? Math.round((needOf(stats.intervalMs) * i) / bodies) : 0),
      },
      timers: {},
      data: {},
      ward: 0,
      wardUntil: null,
      decoys: 0,
      decoyUntil: null,
      fleeAt: spawn.fleeAt,
      fled: false,
    };
    fight.enemies.push(c);
    added.push(c);
    initTraits(ctx, c);
    for (const hook of hooksOf(ctx, c)) {
      guard(ctx, hook, () => hook.init?.(ctx, c), undefined, bodiesOf(ctx, c, true));
    }
  }
  return added;
}

/**
 * Starts a fight between the player described by `snap` and an encounter, with its own random
 * stream seeded from `seed`. Touches nothing outside the returned state.
 */
export function createFight(
  snap: PlayerSnapshot,
  encounter: Encounter,
  seed: number,
  content: ContentDb,
  rules: FightRules,
): FightState {
  const K = content.balance.K;
  const data = fightData(content);
  const levels = snap.levels;
  const wound = woundFactor(snap.wounds ?? 0, content);
  const maxHp = maxHpOf(levels, content) * wound;
  const maxChakra = maxChakraOf(levels, content);
  const maxStamina = maxStaminaOf(levels, content);
  const basic = basicAttackOf(levels, content);
  const player: Combatant = {
    id: 'player',
    side: 'player',
    entry: '',
    hp: Math.min(maxHp, snap.hp ?? maxHp),
    maxHp,
    chakra: Math.min(maxChakra, snap.chakra ?? maxChakra),
    maxChakra,
    stamina: Math.min(maxStamina, snap.stamina ?? maxStamina),
    maxStamina,
    accuracy: (basic.accuracy + accuracyTierTerm(snap.tier ?? 0, content)) * wound,
    evasion: evasionOf(snap, content) * wound,
    damage: basic.damage * wound,
    waitMs: aiTierOf(content, snap.tier ?? 0).waitMs,
    strikeMs: basic.castMs,
    nature: null,
    traits: [],
    specials: [],
    effects: [],
    cd: {},
    phase: 'wait',
    act: null,
    phaseAt: 0,
    last: null,
    timer: idleTimer(),
    timers: {},
    data: {},
    ward: 0,
    wardUntil: null,
    decoys: 0,
    decoyUntil: null,
    fleeAt: null,
    fled: false,
  };
  const fight: FightState = {
    t: 0,
    cap: workOf(K.combat.fightCapMs),
    rng: createStream(seed, 'fight'),
    result: 'ongoing',
    enemy: encounter.id,
    encounter: plain(encounter),
    spawned: 0,
    player,
    enemies: [],
    kit: buildKit(snap, content),
    tier: snap.tier ?? 0,
    natures: [...snap.natures],
    target: null,
    knowledge: plain(snap.knowledge ?? {}),
    pouch: (snap.pouch ?? []).map((s) => ({ id: s.id, n: s.n })),
    medic: snap.medic ?? null,
    uses: {},
    poolAt: workOf(K.combat.regenMs),
    tally: emptyTally(data.basicSkill ?? data.techSkills[0] ?? ('' as SkillId)),
    log: [],
  };
  player.timer = { progress: 0, need: needOf(player.waitMs) };
  // How well each enemy of the fight is known; an enemy the snapshot says nothing about is known completely.
  for (const spawn of encounter.spawns) {
    player.data[knowKey(spawn.enemy)] = snap.knowledgeLevel?.[spawn.enemy] ?? KNOWLEDGE_MAX;
  }
  const ctx = makeCtx(fight, content, rules);
  // Teammates of a team mission support the player through a hook of the player's own.
  if (fight.encounter.support?.length) player.specials.push(TEAM_HOOK);
  for (const hook of hooksOf(ctx, player)) {
    guard(ctx, hook, () => hook.init?.(ctx, player), undefined, bodiesOf(ctx, player, true));
  }
  for (const spawn of fight.encounter.spawns) addBodies(ctx, spawn, spawn.count, spawn.count > 1);
  return fight;
}

// ---------- time ----------

/** Work units until `timer` is full at `rate`, or null when it never fills. */
function timeTo(timer: Timer, rate: number): number | null {
  if (rate <= 0) return null;
  const rest = timer.need - timer.progress;
  return rest <= 0 ? 0 : Math.ceil(rest / rate);
}

/** The nearest due time of one combatant, if it is nearer than `start`. */
function soonest(ctx: FightCtx, fight: FightState, c: Combatant, start: number): number {
  let best = start;
  for (const e of c.effects) {
    if (e.kind === 'periodic' && (e.until === null || e.next <= e.until)) {
      const n = e.next - fight.t;
      if (n < best) best = n;
    }
    if (e.until !== null) {
      const n = e.until - fight.t;
      if (n < best) best = n;
    }
  }
  if (c.ward > 0 && c.wardUntil !== null && c.wardUntil - fight.t < best) best = c.wardUntil - fight.t;
  if (c.decoys > 0 && c.decoyUntil !== null && c.decoyUntil - fight.t < best) best = c.decoyUntil - fight.t;
  const rate = speed(ctx, c);
  for (const name in c.timers) {
    const timer = c.timers[name];
    if (timer) {
      const n = timeTo(timer, rate);
      if (n !== null && n < best) best = n;
    }
  }
  const own = timeTo(c.timer, rate);
  if (own !== null && own < best) best = own;
  return best;
}

/**
 * Work units until something happens in the fight: a combatant's timer fills, an effect ticks or
 * ends, a ward lapses, pools regenerate, the time cap comes. Zero when the player is free to act.
 * Null once the fight is decided.
 */
export function fightNextEventIn(
  fight: FightState,
  content: ContentDb,
  rules: FightRules,
): number | null {
  if (fight.result !== 'ongoing') return null;
  const player = fight.player;
  const ctx = makeCtx(fight, content, rules);
  let best = Math.min(fight.poolAt, fight.cap) - fight.t;
  best = soonest(ctx, fight, player, best);
  for (const e of fight.enemies) if (alive(e)) best = soonest(ctx, fight, e, best);
  return Math.max(0, best);
}

function fill(ctx: FightCtx, c: Combatant, dt: number): void {
  const rate = speed(ctx, c);
  if (rate === 0) return;
  const add = dt * rate;
  c.timer.progress += add;
  for (const name in c.timers) {
    const timer = c.timers[name];
    if (timer) timer.progress += add;
  }
}

function step(ctx: FightCtx, dt: number): void {
  if (dt <= 0) return;
  const fight = ctx.fight;
  fight.t += dt;
  fight.tally.time = fight.t;
  fill(ctx, fight.player, dt);
  for (const e of fight.enemies) if (alive(e)) fill(ctx, e, dt);
}

/**
 * Lets `work` units of fight time pass, handling every event on the way at its exact moment, so
 * any split of the same work gives the same fight. Stops early when the fight is decided and
 * returns the work that was not used.
 */
export function fightAdvance(
  fight: FightState,
  work: number,
  content: ContentDb,
  rules: FightRules,
): number {
  const ctx = makeCtx(fight, content, rules);
  let left = work;
  let stalled = 0;
  // Whatever was done to the bodies since the last call (damage dealt from outside) is settled first.
  if (checkResult(fight)) return left;
  while (fight.result === 'ongoing') {
    const next = fightNextEventIn(fight, content, rules);
    if (next === null || next > left) {
      step(ctx, left);
      return 0;
    }
    stalled = next === 0 ? stalled + 1 : 0;
    if (stalled > STALL_LIMIT) {
      // An event that repeats at once is a hook of another pack that never lets time pass, or a bug.
      const bodies = [fight.player, ...fight.enemies];
      const culprit =
        bodies
          .flatMap((c) => Object.keys(c.timers).map((name) => timerOwner(c, name)))
          .find((h) => h !== undefined && !trusted(h)) ??
        bodies.flatMap((c) => hooksOf(ctx, c)).find((h) => !trusted(h));
      if (!culprit) throw new Error('fight made no progress: an event repeats at once');
      fault(ctx, culprit, 'an event repeated without time passing');
      return left;
    }
    step(ctx, next);
    left -= next;
    handle(ctx);
  }
  return left;
}

/** `ongoing`, `victory`, `defeat`, `fled` (an enemy left) or `timeout` (the time cap came). */
export function fightOutcome(fight: FightState): FightState['result'] {
  return fight.result;
}

/** Fight time so far, in ms. */
export const fightTimeMs = (fight: FightState): number => Math.floor(fight.t / WORK_PER_MS);

// ---------- damage and effects ----------

/** The player's fall wins over the last enemy's in the same moment; a leaving enemy ends the fight as `fled`. */
function checkResult(fight: FightState): boolean {
  if (fight.result !== 'ongoing') return true;
  if (!alive(fight.player)) fight.result = 'defeat';
  else if (!fight.enemies.some(alive)) {
    fight.result = fight.enemies.some((e) => e.fled) ? 'fled' : 'victory';
  }
  return fight.result !== 'ongoing';
}

/** What the action that is being resolved did, collected from the notes of its hits. */
interface ActRecord {
  avoidedBy: string | null;
  hit: boolean;
  miss: boolean;
  damage: number;
  statuses: Record<string, number>;
  combos: Record<string, number>;
}
let resolving: ActRecord | null = null;

function note(
  fight: FightState,
  side: 'player' | 'enemy',
  act: 'cast' | 'resolve' | 'interrupted' | 'hit' | 'miss',
  tech: string | null,
  dmg: number,
  by?: string,
  via?: string,
): void {
  if (resolving) {
    if (act === 'hit') {
      resolving.hit = true;
      resolving.damage += dmg;
    } else if (act === 'miss') resolving.miss = true;
  }
  fight.log?.push({
    side,
    act,
    tech,
    dmg,
    ...(by === undefined ? {} : { by }),
    ...(via === undefined ? {} : { via }),
  });
}

/** What of `after` is more than in `before`, by key. */
const grown = (before: Record<string, number>, after: Record<string, number>): string[] =>
  Object.keys(after)
    .filter((k) => (after[k] ?? 0) > (before[k] ?? 0))
    .sort();

/** Runs the effect of an action and records how it went as the combatant's last action. */
function resolveAs(
  ctx: FightCtx,
  c: Combatant,
  act: FightAct,
  run: () => void,
  log = true,
): ActRecord {
  const { fight } = ctx;
  const was = resolving;
  const rec: ActRecord = {
    avoidedBy: null,
    hit: false,
    miss: false,
    damage: 0,
    statuses: { ...fight.tally.statuses },
    combos: { ...fight.tally.combos },
  };
  resolving = rec;
  try {
    run();
  } finally {
    resolving = was;
  }
  c.last = {
    kind: act.kind,
    id: act.id,
    outcome: rec.hit ? 'hit' : rec.miss ? 'miss' : 'none',
    damage: rec.damage,
    statuses: grown(rec.statuses, fight.tally.statuses),
    combos: grown(rec.combos, fight.tally.combos),
    at: fight.t,
    avoidedBy: rec.avoidedBy,
  };
  if (log) note(fight, c.side, 'resolve', act.id, rec.damage, c.id);
  return rec;
}

/**
 * Takes `amount` of `target`'s health (ward and modifiers have been applied by the caller),
 * credited to `src` when the target is an enemy. Tells the hooks, and sends an enemy that falls
 * to its flee share away. Returns the health actually taken.
 */
export function hurt(ctx: FightCtx, target: Combatant, amount: number, src: string): number {
  const fight = ctx.fight;
  if (!alive(target) || !(amount > 0)) return 0;
  const applied = Math.min(amount, target.hp);
  target.hp -= applied;
  if (target.side === 'enemy') count(fight.tally.damage, src, applied);
  else {
    fight.tally.taken += applied;
    // A fight that took the player this low costs a Wound even when it is won.
    if (target.hp <= target.maxHp * ctx.content.balance.K.woundHp) target.data.low = 1;
  }
  for (const hook of hooksOf(ctx, target)) {
    guard(
      ctx,
      hook,
      () => hook.onDamaged?.(ctx, target, applied, src),
      undefined,
      bodiesOf(ctx, target, true),
    );
  }
  if (!alive(target)) {
    if (target.side === 'enemy') fight.tally.kills++;
    for (const hook of hooksOf(ctx, target)) {
      guard(ctx, hook, () => hook.onDeath?.(ctx, target), undefined, bodiesOf(ctx, target, true));
    }
    leave(ctx, target);
    // A fallen body keeps no effects: its ticks would never be handled, and a save would not read them back.
    target.effects = [];
  } else if (target.fleeAt !== null && target.hp <= target.maxHp * target.fleeAt) {
    target.fled = true;
    target.hp = 0;
    leave(ctx, target);
  }
  return applied;
}

/** A body is gone, by death or flight: tell its hooks and end every effect that lasts while it lives. */
function leave(ctx: FightCtx, c: Combatant): void {
  for (const hook of hooksOf(ctx, c)) {
    guard(ctx, hook, () => hook.onLeave?.(ctx, c), undefined, bodiesOf(ctx, c, true));
  }
  for (const holder of [ctx.fight.player, ...ctx.fight.enemies]) {
    if (holder.effects.some((e) => e.whileAlive === c.id)) {
      holder.effects = holder.effects.filter((e) => e.whileAlive !== c.id);
    }
  }
}

/**
 * The first step of every incoming attack: the hit roll (`null` chance: a sure hit), then a decoy
 * charge, which turns a hit into a miss. Returns whether the attack gets through.
 */
export function rollHit(ctx: FightCtx, target: Combatant, chance: number | null): boolean {
  if (chance !== null && !roll(ctx.fight, chance)) return false;
  if (target.decoys > 0) {
    target.decoys--;
    if (target.decoys === 0) target.decoyUntil = null;
    return false;
  }
  return true;
}

/**
 * The rest of an incoming attack that got through: the target's damage-taken modifiers, then its
 * ward, which is drained before health, then health. Returns the health lost.
 */
export function dealDamage(ctx: FightCtx, target: Combatant, raw: number, src: string): number {
  let damage = raw * stat(ctx, target, 'damageTaken', 1);
  if (!(damage > 0) || !alive(target)) return 0;
  if (target.ward > 0) {
    const absorbed = Math.min(target.ward, damage);
    target.ward -= absorbed;
    damage -= absorbed;
    if (target.ward <= 0) {
      target.ward = 0;
      target.wardUntil = null;
    }
  }
  return hurt(ctx, target, damage, src);
}

/** Gives a combatant a ward of `amount` until `until` (null: for the fight), replacing any ward. */
export function grantWard(c: Combatant, amount: number, until: number | null): void {
  c.ward = Math.max(0, amount);
  c.wardUntil = c.ward > 0 ? until : null;
}

/** Gives a combatant `n` decoy charges. */
export function addDecoys(c: Combatant, n: number): void {
  c.decoys = Math.max(0, c.decoys + n);
}

/**
 * Cancels the casts of a combatant's hooks that are under way (only the interruptible ones when
 * `interruptible` is set); returns whether any was.
 */
export function cancelCasts(ctx: FightCtx, target: Combatant, interruptible = false): boolean {
  let any = false;
  for (const hook of hooksOf(ctx, target)) {
    const info = guard(ctx, hook, () => hook.castInfo?.(ctx, target) ?? null, null, CAST_INFO);
    if (info?.casting && (!interruptible || info.interruptible)) {
      guard(ctx, hook, () => hook.onCancel?.(ctx, target), undefined, bodiesOf(ctx, target, true));
      any = true;
    }
  }
  // A fighter that is casting loses its cast too; the plain attack of an enemy only waits while it is stopped.
  if (breakAct(ctx, target)) any = true;
  return any;
}

/**
 * Breaks off the action a fighter is casting: it ends without effect, no cooldown starts, the share
 * of the pools it spent that `K.combat.interruptLost` names is lost and the rest returns, and the
 * fighter goes back to waiting. The plain attack of an enemy is not a cast and cannot be broken.
 */
export function breakAct(ctx: FightCtx, c: Combatant): boolean {
  const { fight } = ctx;
  const act = c.act;
  // The plain attack of an enemy and the use of an item (whose effect has happened) are not casts.
  if (c.phase !== 'act' || act === null || act.kind === 'attack' || act.kind === 'item')
    return false;
  const keep = 1 - ctx.content.balance.K.combat.interruptLost;
  c.chakra = Math.min(c.maxChakra, c.chakra + keep * (c.data['act.chakra'] ?? 0));
  c.stamina = Math.min(c.maxStamina, c.stamina + keep * (c.data['act.stamina'] ?? 0));
  delete c.data['act.chakra'];
  delete c.data['act.stamina'];
  c.last = {
    kind: act.kind,
    id: act.id,
    outcome: 'interrupted',
    damage: 0,
    statuses: [],
    combos: [],
    at: fight.t,
    avoidedBy: null,
  };
  note(fight, c.side, 'interrupted', act.id, 0, c.id);
  if (c === fight.player) fight.target = null;
  enter(fight, c, 'wait', null, needOf(c.waitMs), 0);
  return true;
}

/** Puts a fighter into a phase: its action, and the timer that ends it (`carry` is the progress already made). */
function enter(
  fight: FightState,
  c: Combatant,
  phase: Combatant['phase'],
  act: FightAct | null,
  need: number,
  carry: number,
): void {
  c.phase = phase;
  c.act = act;
  c.phaseAt = fight.t;
  c.timer = { progress: carry, need: Math.max(1, need) };
}

/** The nature wheel: +wheel against a nature the technique beats, -wheel against one that beats it. */
export function wheelFactor(skill: string, nature: string | null, content: ContentDb): number {
  if (nature === null) return 1;
  const strong = fightData(content).strong;
  const own = strong.get(skill);
  // Only the skills that are natures have a place in the wheel.
  if (!own) return 1;
  const wheel = content.balance.K.wheel;
  if (own.has(nature)) return 1 + wheel;
  if (strong.get(nature)?.has(skill)) return 1 - wheel;
  return 1;
}

/** Damage multiplier of habituation after `previous` uses of a technique against this enemy. */
export function habituation(previous: number, mult: number, content: ContentDb): number {
  const K = content.balance.K;
  return 1 - Math.min(K.habituationCap, K.habituation * mult * previous);
}

/** How much faster the player's techniques wear off against this body: the product of its hooks' multipliers. */
function habituationScale(ctx: FightCtx, target: Combatant | undefined): number {
  if (!target) return 1;
  let scale = 1;
  for (const hook of hooksOf(ctx, target)) {
    scale *= guard(ctx, hook, () => hook.habituation?.(ctx, target) ?? 1, 1, FACTOR);
  }
  return scale;
}

/** The stance technique that is active on the player, or null. */
function activeStance(fight: FightState): string | null {
  const e = findEffect(fight.player, 'stance');
  return e ? e.src : null;
}

const techViews = new WeakMap<KitTechnique, KitTechnique>();
const techFactsOf = new WeakMap<KitTechnique, { answers: string[]; interrupts: boolean }>();

/** What a technique answers and whether it interrupts, from the data; the same for the whole fight. */
function techFacts(
  content: ContentDb,
  tech: KitTechnique,
): { answers: string[]; interrupts: boolean } {
  let facts = techFactsOf.get(tech);
  if (!facts) {
    const data = fightData(content);
    facts = {
      answers: [...data.traits.values()]
        .filter((trait) => answersTraitData(data, tech.tags, tech.state, trait))
        .map((trait) => trait.id),
      interrupts: tech.tags.some((tag) => data.tags.get(tag)?.interrupts === true),
    };
    techFactsOf.set(tech, facts);
  }
  return facts;
}

/**
 * A frozen copy of a kit technique for the view, made once per technique: the AI reads it, never
 * changes it, and copying it at every decision would be most of the cost of a decision.
 */
function viewOf(tech: KitTechnique): KitTechnique {
  let copy = techViews.get(tech);
  if (!copy) {
    copy = Object.freeze({
      ...tech,
      tags: Object.freeze([...tech.tags]) as KitTechnique['tags'],
      fx: Object.freeze({ ...tech.fx, statuses: Object.freeze([...tech.fx.statuses]) as string[] }),
    });
    techViews.set(tech, copy);
  }
  return copy;
}

export function lowestHp(enemies: readonly Combatant[]): Combatant | undefined {
  let best: Combatant | undefined;
  for (const e of enemies) if (alive(e) && (!best || e.hp < best.hp)) best = e;
  return best;
}

/** The body an attack is aimed at: the one the AI named if it lives, else the weakest. */
export function pickTarget(
  fight: FightState,
  id: string | null | undefined,
): Combatant | undefined {
  const named = id ? fight.enemies.find((e) => e.id === id && alive(e)) : undefined;
  return named ?? lowestHp(fight.enemies);
}

// ---------- the player's side ----------

const viewEffects = (fight: FightState, c: Combatant): ViewEffect[] =>
  c.effects.map((e) => ({
    id: e.id,
    kind: e.kind,
    remaining: e.until === null ? null : Math.max(0, e.until - fight.t),
  }));

function buildView(ctx: FightCtx): FightView {
  const { fight, content } = ctx;
  const K = content.balance.K;
  const player = fight.player;
  const tier = aiTierOf(content, fight.tier);
  const living = fight.enemies.filter(alive);
  const primary = lowestHp(living);
  const stance = activeStance(fight);
  // Per view, not per technique: the same for every technique.
  const taiMult = stat(ctx, player, 'taiDamage', 1);
  const habScale = habituationScale(ctx, primary);
  const physical = fightData(content).physical;
  const techniques: ViewTechnique[] = fight.kit.techniques.map((tech) => {
    const cooldownLeft = Math.max(0, (player.cd[tech.id] ?? 0) - fight.t);
    const affordable = (tech.pool === 'chakra' ? player.chakra : player.stamina) >= tech.cost;
    const uses = fight.uses[tech.id] ?? 0;
    const wheel = wheelFactor(tech.skill, primary?.nature ?? null, content);
    const targets = tech.hitsAll ? living.length : 1;
    const stanceOk = !tech.requiresStance || stance !== null;
    const hab = habituation(uses, tech.habituationMult * habScale, content);
    const facts = techFacts(content, tech);
    return {
      tech: viewOf(tech),
      cooldownLeft,
      affordable,
      ready: cooldownLeft === 0 && affordable && stanceOk,
      uses,
      expected: tech.damage * hab * wheel * targets * (physical.has(tech.skill) ? taiMult : 1),
      power: tech.damage,
      stanceOk,
      answers: facts.answers,
      interrupts: facts.interrupts,
    };
  });
  const enemies: ViewEnemy[] = living.map((e) => {
    const known = fight.knowledge[e.entry];
    const knownTraits = known ? e.traits.filter((t) => known.includes(t)) : [...e.traits];
    const mechanicKnown = !known || known.includes('special');
    const bindings = boundOf(ctx, e).list;
    const workingTraits = knownTraits.filter((trait) => {
      const hook = bindings.find((b) => b.trait === trait)?.hook;
      const w = hook?.working;
      return hook && w
        ? guard(ctx, hook, () => w.call(hook, ctx, e), true, BOOLEAN)
        : !isSuppressed(e, trait);
    });
    let cast: ViewEnemy['cast'] = null;
    let nextCastIn: number | null = null;
    for (const { hook, trait } of bindings) {
      const info = guard(ctx, hook, () => hook.castInfo?.(ctx, e) ?? null, null, CAST_INFO);
      if (!info || info.inWork === null) continue;
      // A cast under way can be seen; when the next one comes is known only for a known trait.
      const seen = trait !== null ? knownTraits.includes(trait) : mechanicKnown;
      if (info.casting) {
        cast = {
          kind: info.kind,
          remaining: info.inWork,
          total: info.total,
          mult: info.mult,
          interruptible: info.interruptible,
          known: seen,
        };
      } else if (seen) {
        nextCastIn = info.inWork;
      }
    }
    return {
      id: e.id,
      hp: e.hp,
      hpShare: e.maxHp > 0 ? e.hp / e.maxHp : 0,
      nature: e.nature,
      effects: viewEffects(fight, e),
      knownTraits,
      workingTraits,
      cast,
      nextCastIn,
      leader: bindings.some(
        (b) =>
          b.trait === null &&
          guard(ctx, b.hook, () => b.hook.leader?.(ctx, e) ?? false, false, BOOLEAN) === true,
      ),
    };
  });
  return {
    t: fight.t,
    tier: fight.tier,
    player: {
      hp: player.hp,
      maxHp: player.maxHp,
      chakra: player.chakra,
      maxChakra: player.maxChakra,
      stamina: player.stamina,
      maxStamina: player.maxStamina,
      effects: viewEffects(fight, player),
      ward: player.ward,
      decoys: player.decoys,
    },
    techniques,
    enemies,
    habituation: { ...fight.uses },
    ai: tier,
    visibleTraits: content.ai.visibleTraits,
    vocab: fightData(content).ai,
    pouch: fight.pouch.flatMap((slot, i) => {
      const view = slot.n > 0 ? itemView(content, slot.id) : null;
      return view
        ? [
            {
              slot: i,
              id: slot.id,
              n: slot.n,
              tags: view.tags,
              use: view.use,
              answers: view.answers,
              interrupts: view.interrupts,
              guard: view.guard,
              selfBonus: view.selfBonus,
            },
          ]
        : [];
    }),
    medic:
      fight.medic !== null && (fight.pouch[fight.medic]?.n ?? 0) > 0
        ? { slot: fight.medic, below: content.balance.K.pillAt }
        : null,
    stance,
    hastened: (player.data.hasten ?? 0) > 0,

    itemWork: secWork(K.pillAction),
  };
}

/** The AI tier that plays a player of this tier: the highest one whose minimum the tier meets. */
export function aiTierOf(content: ContentDb, tier: number) {
  let chosen = content.ai.tiers[0];
  for (const t of content.ai.tiers) {
    if (t.minTier <= tier && (!chosen || t.minTier >= chosen.minTier)) chosen = t;
  }
  if (!chosen) throw new Error('the content has no AI tier');
  return chosen;
}

/** The player has waited long enough: the AI chooses, and the player begins what it chose, or waits again, or catches its breath. */
function decide(ctx: FightCtx): void {
  const { fight, content } = ctx;
  const player = fight.player;
  const view = buildView(ctx);
  const decision: Decision = ctx.rules.combatAi(view);
  if (decision.type === 'technique') {
    const chosen = view.techniques.find((r) => r.tech.id === decision.id && r.ready);
    const tech = chosen && fight.kit.techniques.find((t) => t.id === chosen.tech.id);
    if (tech) return startTechnique(ctx, tech, decision.target);
  } else if (decision.type === 'item') {
    if (startItem(ctx, decision.id, decision.target)) return;
  }
  if (decision.type === 'wait') return beginWait(ctx);
  const cost = content.balance.K.basicCost;
  if (player.stamina >= cost) {
    return startBasic(ctx, decision.type === 'basic' ? decision.target : undefined, cost);
  }
  // Rest only when neither the plain strike nor any technique can be paid for.
  const canPay = fight.kit.techniques.some(
    (t) => (t.pool === 'chakra' ? player.chakra : player.stamina) >= t.cost,
  );
  if (canPay) return beginWait(ctx);
  enter(
    fight,
    player,
    'rest',
    { kind: 'rest', id: null, target: null },
    needOf(secMs(content.balance.K.rest.s)),
    player.timer.progress,
  );
}

function beginWait(ctx: FightCtx): void {
  const player = ctx.fight.player;
  enter(ctx.fight, player, 'wait', null, needOf(player.waitMs), player.timer.progress);
}

/** The rest ends: a share of both pools comes back. */
function finishRest(ctx: FightCtx): void {
  const { fight, content } = ctx;
  const player = fight.player;
  const share = content.balance.K.rest.share;
  player.chakra = Math.min(player.maxChakra, player.chakra + share * player.maxChakra);
  player.stamina = Math.min(player.maxStamina, player.stamina + share * player.maxStamina);
  player.last = {
    kind: 'rest',
    id: null,
    outcome: 'none',
    damage: 0,
    statuses: [],
    combos: [],
    at: fight.t,
    avoidedBy: null,
  };
  note(fight, 'player', 'resolve', null, 0, player.id);
}

/**
 * Takes one unit of `id` from the pouch and uses it (its effect is at once) and reports whether it could.
 * Using it is an action that takes the item's action time, during which the player does nothing else.
 */
function startItem(ctx: FightCtx, id: string, target: string | undefined): boolean {
  const { fight, content } = ctx;
  const slot = fight.pouch.find((s) => s.id === id && s.n > 0);
  if (!slot) return false;
  const player = fight.player;
  const act: FightAct = { kind: 'item', id, target: target ?? null };
  let used = false;
  const before = player.last;
  const rec = resolveAs(
    ctx,
    player,
    act,
    () => {
      fight.target = target ?? null;
      used = applyItem(ctx, id);
      fight.target = null;
    },
    false,
  );
  if (!used) {
    // Nothing happened: no unit is spent and the player decides again.
    player.last = before;
    return false;
  }
  note(fight, 'player', 'cast', id, 0, player.id);
  note(fight, 'player', 'resolve', id, rec.damage, player.id);
  slot.n--;
  count(fight.tally.uses, id);
  enter(
    fight,
    player,
    'act',
    act,
    needOf(secMs(content.balance.K.pillAction)),
    player.timer.progress,
  );
  return true;
}

function startTechnique(ctx: FightCtx, tech: KitTechnique, target: string | undefined): void {
  const fight = ctx.fight;
  const player = fight.player;
  if (tech.pool === 'chakra') player.chakra -= tech.cost;
  else player.stamina -= tech.cost;
  player.data[tech.pool === 'chakra' ? 'act.chakra' : 'act.stamina'] = tech.cost;
  // A hastened cast is shortened once.
  const hasten = player.data.hasten ?? 0;
  player.data.hasten = 0;
  enter(
    fight,
    player,
    'act',
    { kind: 'technique', id: tech.id, target: target ?? null },
    needOf(hasten > 0 ? Math.max(1, Math.round(tech.castMs * hasten)) : tech.castMs),
    player.timer.progress,
  );
  fight.target = target ?? null;
  // Mastery is paid for the fight time since the previous technique use (or the fight's start).
  count(fight.tally.masteryWork, tech.id, fight.t - fight.tally.lastUseAt);
  fight.tally.lastUseAt = fight.t;
  fight.tally.style = tech.skill;
  note(fight, 'player', 'cast', tech.id, 0, player.id);
}

/** The plain strike is an action: it costs a little stamina, takes its own time and lands when it ends. */
function startBasic(ctx: FightCtx, targetId: string | undefined, cost: number): void {
  const fight = ctx.fight;
  const player = fight.player;
  player.stamina -= cost;
  player.data['act.stamina'] = cost;
  enter(
    fight,
    player,
    'act',
    { kind: 'basic', id: null, target: targetId ?? null },
    needOf(player.strikeMs),
    player.timer.progress,
  );
  fight.tally.style = fightData(ctx.content).basicSkill ?? fight.tally.style;
  note(fight, 'player', 'cast', null, 0, player.id);
}

function finishBasic(ctx: FightCtx, targetId: string | null): void {
  const fight = ctx.fight;
  const player = fight.player;
  fight.tally.basic++;
  const target = pickTarget(fight, targetId);
  if (!target) return;
  const chance = hitChance(
    stat(ctx, player, 'accuracy', player.accuracy),
    evasionAgainst(ctx, target, player),
    ctx.content,
  );
  if (rollHit(ctx, target, chance)) {
    const damage = player.damage * stat(ctx, player, 'taiDamage', 1);
    note(fight, 'player', 'hit', null, dealDamage(ctx, target, damage, 'basic'));
  } else note(fight, 'player', 'miss', null, 0);
}

/** The player's action ends: its effect happens now, then the player waits again. */
function finishAct(ctx: FightCtx): void {
  const player = ctx.fight.player;
  const act = player.act;
  delete player.data['act.chakra'];
  delete player.data['act.stamina'];
  if (act) {
    resolveAs(ctx, player, act, () => {
      if (act.kind === 'technique') resolveCast(ctx, act.id);
      else if (act.kind === 'basic') finishBasic(ctx, act.target);
    });
  }
  if (ctx.fight.result === 'ongoing') {
    enter(ctx.fight, player, 'wait', null, needOf(player.waitMs), player.timer.progress);
  }
}

function resolveCast(ctx: FightCtx, id: string | null): void {
  const { fight, content } = ctx;
  const player = fight.player;
  const tech = fight.kit.techniques.find((t) => t.id === id);
  if (!tech) return;
  player.cd[tech.id] = fight.t + workOf(tech.cooldownMs);
  const previous = fight.uses[tech.id] ?? 0;
  fight.uses[tech.id] = previous + 1;
  count(fight.tally.uses, tech.id);
  // Tags that work on the player rather than on an enemy act when the cast ends.
  const tags = fightData(content).tags;
  for (const tag of tech.tags) {
    const def = tags.get(tag);
    if (def) removeTagged(player, def.removes);
  }
  applyTechniqueEffect(ctx, tech);
  const hurtsEnemy =
    tech.damage > 0 ||
    tech.state !== null ||
    tech.tags.some((tag) => (tags.get(tag)?.onHit.length ?? 0) > 0);
  if (!hurtsEnemy) return;
  const aimed = pickTarget(fight, fight.target);
  fight.target = null;
  const targets = tech.hitsAll ? fight.enemies.filter(alive) : aimed ? [aimed] : [];
  for (const target of targets) {
    const chance = hitChance(
      stat(ctx, player, 'accuracy', tech.accuracy),
      evasionAgainst(ctx, target, player),
      content,
    );
    if (rollHit(ctx, target, chance)) {
      const hab = habituation(
        previous,
        tech.habituationMult * habituationScale(ctx, target),
        content,
      );
      note(fight, 'player', 'hit', tech.id, applyHit(ctx, tech, target, hab));
    } else note(fight, 'player', 'miss', tech.id, 0);
  }
}

/** What a technique does to the player's side besides hurting an enemy, from its combat data. */
function applyTechniqueEffect(ctx: FightCtx, tech: KitTechnique): void {
  const fight = ctx.fight;
  const player = fight.player;
  const fx = tech.fx;
  const until = fight.t + workOf(fx.durationMs);
  switch (fx.kind) {
    case 'cleanse':
      for (const status of fx.statuses) removeEffect(player, status);
      break;
    case 'nextCast':
      player.data.hasten = fx.mult;
      break;
    case 'reveal':
      // The Hidden trait stops working for a while: no body can hide or hide again.
      for (const e of fight.enemies) {
        if (!alive(e)) continue;
        addEffect(e, {
          kind: 'modifier',
          id: 'revealed',
          src: tech.id,
          until,
          stat: 'accuracy',
          op: 'mul',
          value: 1,
        });
      }
      break;
    case 'stance': {
      // One stance at a time: the new one replaces the old; it costs a Wound after the fight, once.
      addEffect(player, {
        kind: 'modifier',
        id: 'stance',
        src: tech.id,
        until: null,
        stat: 'taiDamage',
        op: 'add',
        value: fx.mult,
      });
      addEffect(player, {
        kind: 'periodic',
        id: 'stanceDrain',
        src: tech.id,
        until: null,
        mode: 'stamina',
        amount: fx.drain,
        every: workOf(TICK_MS),
        next: fight.t + workOf(TICK_MS),
      });
      const key = `stance.${tech.id}`;
      if (!player.data[key]) {
        player.data[key] = 1;
        fight.tally.wounds += fx.wounds;
      }
      break;
    }
    default:
      break;
  }
}

/** What one technique does to one enemy it hit: tags, damage, status, then combos. Returns the direct damage dealt. */
function applyHit(ctx: FightCtx, tech: KitTechnique, target: Combatant, hab: number): number {
  const { fight, content } = ctx;
  const data = fightData(content);
  // What the combos need of the body is read before the hit changes it.
  const priors = comboPriors(ctx, tech, target);
  for (const tag of tech.tags) {
    const def = data.tags.get(tag);
    if (def) runTagOps(ctx, target, def.onHit, tech.id, tech.rank);
  }
  const base =
    tech.damage *
    hab *
    wheelFactor(tech.skill, target.nature, content) *
    (data.physical.has(tech.skill) ? stat(ctx, fight.player, 'taiDamage', 1) : 1);
  const dealt = dealDamage(ctx, target, base, tech.id);
  if (!alive(target)) return dealt;

  const status = tech.state === null ? undefined : data.byState.get(tech.state);
  if (status) {
    applyStatus(ctx, target, status, tech.id, {
      base,
      rank: tech.rank,
      scale: comboScale(ctx, tech, priors),
    });
  }
  runCombos(ctx, tech, target, priors, base);
  return dealt;
}

// ---------- the enemies' side and the clock's ----------

/** One basic attack of an enemy body on the player: hooks may change it, then the incoming pipeline runs. */
function enemyAttack(ctx: FightCtx, enemy: Combatant): void {
  const fight = ctx.fight;
  const player = fight.player;
  const plan: AttackPlan = {
    chance: hitChance(
      stat(ctx, enemy, 'accuracy', enemy.accuracy),
      evasionAgainst(ctx, player, enemy),
      ctx.content,
    ),
    damage: enemy.damage,
  };
  const hooks = hooksOf(ctx, enemy);
  for (const hook of hooks) {
    guard(ctx, hook, () => hook.onAttack?.(ctx, enemy, plan), undefined, {
      ...bodiesOf(ctx, enemy, true),
      after: () =>
        Number.isFinite(plan.damage) &&
        plan.damage >= 0 &&
        Number.isFinite(plan.chance) &&
        plan.chance >= 0 &&
        plan.chance <= 1 &&
        (plan.interrupts === undefined || typeof plan.interrupts === 'boolean'),
    });
  }
  const resist = findEffect(player, 'resist');
  if (resist?.kind === 'modifier' && enemy.nature !== null && resist.nature === enemy.nature) {
    plan.damage *= resist.value;
  }
  if (!rollHit(ctx, player, plan.chance)) {
    const via = avoidedBy(ctx);
    if (resolving) resolving.avoidedBy = via;
    note(fight, 'enemy', 'miss', null, 0, undefined, via ?? undefined);
    return;
  }
  const dealt = dealDamage(ctx, player, plan.damage, enemy.id);
  note(fight, 'enemy', 'hit', null, dealt);
  // An attack that carries the interrupt breaks the cast of whoever it hits.
  if (plan.interrupts === true && alive(player)) breakAct(ctx, player);
  for (const hook of hooks) {
    guard(
      ctx,
      hook,
      () => hook.onAttackHit?.(ctx, enemy, player, dealt),
      undefined,
      bodiesOf(ctx, enemy, true),
    );
  }
}

/** The chance that an attack of `attacker` lands on `target`, accuracy and evasion modifiers counted. */
export function hitChanceOf(ctx: FightCtx, attacker: Combatant, target: Combatant): number {
  return hitChance(
    stat(ctx, attacker, 'accuracy', attacker.accuracy),
    evasionAgainst(ctx, target, attacker),
    ctx.content,
  );
}

/** A heavy blow, for hooks such as the caster's: like every incoming strike it rolls once, its accuracy against the player's evasion. */
export function heavyBlow(ctx: FightCtx, enemy: Combatant, damage: number): boolean {
  const player = ctx.fight.player;
  if (!rollHit(ctx, player, hitChanceOf(ctx, enemy, player))) {
    const via = avoidedBy(ctx);
    note(ctx.fight, 'enemy', 'miss', null, 0, undefined, via ?? undefined);
    return false;
  }
  note(ctx.fight, 'enemy', 'hit', null, dealDamage(ctx, player, damage, enemy.id));
  return true;
}

function tickEffects(ctx: FightCtx, c: Combatant): void {
  const fight = ctx.fight;
  for (const e of [...c.effects]) {
    if (e.kind !== 'periodic') continue;
    while (alive(c) && e.next <= fight.t && (e.until === null || e.next <= e.until)) {
      if (!isSuppressed(c, e.id)) tick(ctx, c, e);
      e.next += e.every;
    }
  }
}

function tick(ctx: FightCtx, c: Combatant, e: PeriodicEffect): void {
  if (e.mode === 'damage') hurt(ctx, c, e.amount, e.src);
  else if (e.mode === 'heal') c.hp = Math.min(c.maxHp, c.hp + e.amount);
  else {
    // A stance burns stamina and ends when none is left.
    c.stamina = Math.max(0, c.stamina - e.amount);
    if (c.stamina <= 0) {
      removeEffect(c, 'stance');
      removeEffect(c, 'stanceDrain');
    }
  }
}

function expire(fight: FightState, c: Combatant): void {
  if (c.effects.some((e) => e.until !== null && e.until <= fight.t)) {
    c.effects = c.effects.filter((e) => e.until === null || e.until > fight.t);
  }
  if (c.ward > 0 && c.wardUntil !== null && c.wardUntil <= fight.t) {
    c.ward = 0;
    c.wardUntil = null;
  }
  if (c.decoyUntil !== null && c.decoyUntil <= fight.t) {
    c.decoys = 0;
    c.decoyUntil = null;
  }
}

/** Runs the hook timers of a combatant that have filled, in name order. */
function runTimers(ctx: FightCtx, c: Combatant): void {
  const names = Object.keys(c.timers).sort();
  for (const name of names) {
    let fires = 0;
    const cap = Math.max(1, ctx.content.balance.K.combat.timerFires);
    for (;;) {
      const timer = c.timers[name];
      if (!timer || timer.progress < timer.need || !alive(ctx.fight.player)) break;
      if (ctx.fight.result !== 'ongoing') return;
      timer.progress -= timer.need;
      const hooks = hooksOf(ctx, c);
      for (const hook of hooks) {
        guard(ctx, hook, () => hook.onTimer?.(ctx, c, name), undefined, bodiesOf(ctx, c, true));
      }
      const after = c.timers[name];
      // A timer that no longer has a size, or that fires without end within one moment, is a failure of
      // the hook that owns it: of another pack it is contained, of the core it is a bug.
      const broken = after !== undefined && !(Number.isFinite(after.need) && after.need >= 1);
      if (broken || ++fires > cap) {
        const culprit =
          timerOwner(c, name) ??
          hooks.find((h) => !trusted(h) && h.onTimer !== undefined) ??
          hooks.find((h) => !trusted(h));
        if (culprit) {
          fault(ctx, culprit, 'a timer lost its size or fired without end');
          return;
        }
        throw new Error(`timer ${name} has no size`);
      }
    }
  }
}

/** Handles everything that is due at the fight clock, in a fixed order. */
function handle(ctx: FightCtx): void {
  const { fight, content } = ctx;
  const K = content.balance.K;
  const player = fight.player;

  tickEffects(ctx, player);
  for (const e of fight.enemies) tickEffects(ctx, e);
  if (checkResult(fight)) return;
  expire(fight, player);
  for (const e of fight.enemies) if (alive(e)) expire(fight, e);

  // Enemies spawned during the loop wait for the next event.
  for (const e of [...fight.enemies]) {
    if (!alive(e)) continue;
    while (e.timer.progress >= e.timer.need && alive(player)) {
      e.timer.progress -= e.timer.need;
      if (e.phase === 'wait') {
        // The wait is over: the wind-up of the attack begins, and can be seen.
        enter(
          fight,
          e,
          'act',
          { kind: 'attack', id: null, target: player.id },
          needOf(e.strikeMs),
          e.timer.progress,
        );
        note(fight, 'enemy', 'cast', null, 0, e.id);
      } else {
        const act: FightAct = e.act ?? { kind: 'attack', id: null, target: player.id };
        resolveAs(ctx, e, act, () => enemyAttack(ctx, e));
        enter(fight, e, 'wait', null, needOf(e.waitMs), e.timer.progress);
      }
    }
    runTimers(ctx, e);
  }
  runTimers(ctx, player);
  if (checkResult(fight)) return;

  while (fight.poolAt <= fight.t) {
    fight.poolAt += workOf(K.combat.regenMs);
    // The regeneration numbers are per second; a step of another length scales them.
    const scale = K.combat.regenMs / TICK_MS;
    player.chakra = Math.min(player.maxChakra, player.chakra + fight.kit.chakraRegen * scale);
    player.stamina = Math.min(player.maxStamina, player.stamina + fight.kit.staminaRegen * scale);
  }

  if (checkResult(fight)) return;
  if (fight.t >= fight.cap) {
    fight.result = 'timeout';
    return;
  }
  // The player's phase ends: the wait (the AI chooses), the action (it takes effect) or the rest.
  while (fight.result === 'ongoing' && player.timer.progress >= player.timer.need) {
    player.timer.progress -= player.timer.need;
    if (player.phase === 'wait') decide(ctx);
    else if (player.phase === 'act') finishAct(ctx);
    else {
      finishRest(ctx);
      beginWait(ctx);
    }
    checkResult(fight);
  }
}
