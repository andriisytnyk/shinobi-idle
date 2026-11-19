import type { AiTier, ContentDb, SkillId, Technique } from '@shinobi/content';
import { createStream, nextFloatFrom } from '../rng.ts';
import { addEffect, findEffect, isSuppressed, removeEffect, statOf } from './fight-effects.ts';
import { sharesOf, summonSpecOf } from './fight-allies.ts';
import { cloneRoleOf, copiesHand, pickCloneHand } from './fight-roles.ts';
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
  AllyHeld,
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
  SummonSpec,
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
  shiftAgainst,
  evasionTierTerm,
  KNOWLEDGE_MAX,
  knowledgeTerm,
  hitChance,
  CHAKRA_DIVISOR_KEY,
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

/** The bodies of the player's side besides the character (fallen ones stay in the list with no health). */
export const alliesOf = (fight: FightState): readonly Combatant[] => fight.allies ?? [];

/** Every body of the player's side: the character first, then the allies in the order they came in. */
export const sideBodies = (fight: FightState): Combatant[] => [fight.player, ...alliesOf(fight)];

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

/** What a guarded call of a hook of a body may change: the body and every body of the player's side (the character and the allies). */
const bodiesOf = (ctx: FightCtx, c: Combatant, event: boolean): GuardOptions<void | undefined> => ({
  bodies: [c, ...sideBodies(ctx.fight).filter((b) => b !== c)],
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
    case 'summon':
      fx.summon = summonSpecOf(content, effect.fx, snap.mastery[tech.id] ?? 1);
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
  const make = (tech: Technique): KitTechnique => {
    const n = techniqueFigures(snap, tech, content);
    const mastery = snap.mastery[tech.id] ?? 1;
    const fx = kitEffect(tech, snap, content);
    return {
      id: tech.id,
      skill: tech.skill,
      role: tech.role,
      rank: tech.rank ?? '',
      tags: [...tech.tags],
      state: tech.state,
      // A technique that puts allies on the player's side does not strike by itself.
      damage: fx.kind === 'summon' ? 0 : n.damage * wound,
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
      fx,
      requiresStance: tech.combat?.requiresStance === true,
    };
  };
  // A defensive technique is passive: it adds to the evasion rating and is never in the hand.
  const usable = (tech: Technique): boolean =>
    known.has(tech.id) && tech.rank !== null && tech.combat?.passive === undefined;
  for (const tech of content.techniques) {
    if (!usable(tech)) continue;
    if (loadout && !loadout.has(tech.id) && !tech.combat?.outOfLoadout) continue;
    techniques.push(make(tech));
  }
  const kit: PlayerKit = {
    techniques,
    toolDamage: (K.toolTag[0] + K.toolTag[1] * style) * wound,
    med: snap.levels.med ?? 1,
    chakraRegen: chakraRegenOf(snap.levels, content),
    staminaRegen: staminaRegenOf(snap.levels, content),
    evasion: evasionParts(snap, content),
  };
  // The role of the clones. The default role copies the character's hand and leaves the kit as it always was.
  const role = cloneRoleOf(content, snap.cloneRole);
  if (role) {
    if (!copiesHand(role)) {
      // The hand is picked from every technique the character knows, the loadout or not, that a clone can cast.
      const byId = new Map(techniques.map((t) => [t.id, t]));
      const every = content.techniques
        .filter(usable)
        .map((tech) => byId.get(tech.id) ?? make(tech));
      kit.cloneHand = pickCloneHand(
        content,
        role,
        // A clone has no stance, so a technique that needs one is not offered to it.
        every.filter((t) => !barredForAllies(t) && !t.requiresStance),
        every,
      );
    }
    if (role.threat !== 1) kit.cloneThreat = role.threat;
    if (role.default !== true) kit.cloneRole = role.id;
  }
  return kit;
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

/** The key of an enemy's data that holds its combat level, which the defensive techniques of the player are weighed against. */
const LEVEL_KEY = 'combat.level';

/** The rating a target defends with against `attacker`: its evasion, and for the player what knowing the attacker adds, then the stat modifiers. */
export function evasionAgainst(ctx: FightCtx, target: Combatant, attacker: Combatant): number {
  let base = target.evasion;
  if (target.side === 'player' && attacker.side === 'enemy') {
    const level = target.data[knowKey(attacker.entry)] ?? KNOWLEDGE_MAX;
    base += knowledgeTerm(level, ctx.content);
    // The defensive techniques count by their effective level against the level of the attacker.
    const attackerLevel = attacker.data[LEVEL_KEY];
    if (attackerLevel !== undefined) {
      const parts = ctx.fight.kit.evasion;
      const raw = parts.reduce((n, p) => n + p.value, 0);
      const adj = shiftAgainst(parts, attackerLevel, ctx.content);
      // Wounds weaken the whole rating; they weaken the adjustment the same way.
      base += raw > 0 ? adj * (target.evasion / raw) : adj;
    }
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
      data: { [LEVEL_KEY]: spawn.cl },
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
  const chakraDivisor = Math.max(1, snap.chakraDivisor ?? 1);
  const maxChakra = maxChakraOf(levels, content, chakraDivisor);
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
    data: chakraDivisor > 1 ? { [CHAKRA_DIVISOR_KEY]: chakraDivisor } : {},
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
  if (c.ward > 0 && c.wardUntil !== null && c.wardUntil - fight.t < best)
    best = c.wardUntil - fight.t;
  if (c.decoys > 0 && c.decoyUntil !== null && c.decoyUntil - fight.t < best)
    best = c.decoyUntil - fight.t;
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
  for (const a of alliesOf(fight)) if (alive(a)) best = soonest(ctx, fight, a, best);
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
  for (const a of alliesOf(fight)) if (alive(a)) fill(ctx, a, dt);
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
  const left = advanceFight(fight, work, content, rules);
  // However it ended, the allies that still stand give back what they have left.
  if (fight.result !== 'ongoing' && fight.allies) {
    releaseAllies(makeCtx(fight, content, rules));
  }
  return left;
}

function advanceFight(
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
      const bodies = [...sideBodies(fight), ...fight.enemies];
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
  /** The body an enemy's blow landed on (or missed), when the action struck one. */
  struck: string | null;
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
  ally?: number,
): void {
  if (resolving) {
    if (act === 'hit') {
      resolving.hit = true;
      resolving.damage += dmg;
    } else if (act === 'miss') resolving.miss = true;
  }
  const kind =
    ally === undefined ? undefined : fight.allies?.find((a) => a.ally?.n === ally)?.ally?.kind;
  fight.log?.push({
    side,
    act,
    tech,
    dmg,
    ...(by === undefined ? {} : { by }),
    ...(via === undefined ? {} : { via }),
    ...(ally === undefined ? {} : { ally }),
    ...(kind === undefined ? {} : { allyKind: kind }),
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
    struck: null,
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
  // Named only when it is not the plain case, so that a fight with no allies is written as it always was: an enemy's blow on a body
  // other than the character, and what an ally aimed at.
  const target =
    rec.struck !== null
      ? rec.struck === fight.player.id
        ? null
        : rec.struck
      : c === fight.player
        ? null
        : act.target;
  c.last = {
    kind: act.kind,
    id: act.id,
    outcome: rec.hit ? 'hit' : rec.miss ? 'miss' : 'none',
    damage: rec.damage,
    statuses: grown(rec.statuses, fight.tally.statuses),
    combos: grown(rec.combos, fight.tally.combos),
    at: fight.t,
    avoidedBy: rec.avoidedBy,
    ...(target === null ? {} : { target }),
  };
  if (log) note(fight, c.side, 'resolve', act.id, rec.damage, c.id, undefined, allyOf(c));
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
  else if (target.ally !== undefined) {
    // What an ally takes is not the character's: no tally, no Wound.
  } else {
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
    // A dispelled ally does not come back in this fight; what it had left returns to the character.
    if (target.ally !== undefined) {
      target.ally.out = 'struck';
      target.act = null;
      target.phase = 'wait';
      releaseAlly(ctx, target);
    }
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
  for (const holder of [...sideBodies(ctx.fight), ...ctx.fight.enemies]) {
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
  note(fight, c.side, 'interrupted', act.id, 0, c.id, undefined, allyOf(c));
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
function activeStance(actor: Combatant): string | null {
  const e = findEffect(actor, 'stance');
  return e ? e.src : null;
}

/** Whether a technique is left out of an ally's hand: allies use the character's techniques except the ones that act on the character's own body or on the side itself. */
const barredForAllies = (tech: KitTechnique): boolean =>
  tech.fx.kind === 'summon' || tech.fx.kind === 'stance';

/** Whether the fight lets the technique be cast now: a technique that puts allies is limited per fight and by the room on the side. */
function castable(fight: FightState, tech: KitTechnique): boolean {
  const summon = tech.fx.summon;
  if (!summon) return true;
  const living = alliesOf(fight).filter(alive).length;
  return (fight.uses[tech.id] ?? 0) < summon.casts && living < summon.max;
}

/** The hand of a body: the character's techniques; an ally's are those that do not act on the body or the side itself. */
const handOf = (fight: FightState, actor: Combatant): KitTechnique[] =>
  actor === fight.player
    ? fight.kit.techniques
    : (fight.kit.cloneHand ?? fight.kit.techniques.filter((t) => !barredForAllies(t)));

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

function buildView(ctx: FightCtx, actor: Combatant): FightView {
  const { fight, content } = ctx;
  const K = content.balance.K;
  const player = actor;
  // The pouch and the medic are the character's: an ally sees none.
  const own = actor === fight.player;
  const tier = aiTierOf(content, fight.tier);
  const living = fight.enemies.filter(alive);
  const primary = lowestHp(living);
  const stance = activeStance(actor);
  // Per view, not per technique: the same for every technique.
  const taiMult = stat(ctx, player, 'taiDamage', 1);
  const habScale = habituationScale(ctx, primary);
  const physical = fightData(content).physical;
  const techniques: ViewTechnique[] = handOf(fight, actor).map((tech) => {
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
      ready: cooldownLeft === 0 && affordable && stanceOk && castable(fight, tech),
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
    allies: sideBodies(fight).filter((b) => b !== actor && alive(b) && b.ally !== undefined).length,
    habituation: { ...fight.uses },
    ai: tier,
    visibleTraits: content.ai.visibleTraits,
    vocab: fightData(content).ai,
    pouch: (own ? fight.pouch : []).flatMap((slot, i) => {
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
      own && fight.medic !== null && (fight.pouch[fight.medic]?.n ?? 0) > 0
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
function decide(ctx: FightCtx, actor: Combatant): void {
  const { fight, content } = ctx;
  const player = actor;
  const own = actor === fight.player;
  const view = buildView(ctx, actor);
  const decision: Decision = ctx.rules.combatAi(view);
  if (decision.type === 'technique') {
    const chosen = view.techniques.find((r) => r.tech.id === decision.id && r.ready);
    const tech = chosen && handOf(fight, actor).find((t) => t.id === chosen.tech.id);
    if (tech) return startTechnique(ctx, actor, tech, decision.target);
  } else if (decision.type === 'item' && own) {
    if (startItem(ctx, decision.id, decision.target)) return;
  }
  if (decision.type === 'wait') return beginWait(ctx, actor);
  const cost = content.balance.K.basicCost;
  if (player.stamina >= cost) {
    return startBasic(ctx, actor, decision.type === 'basic' ? decision.target : undefined, cost);
  }
  // Rest only when neither the plain strike nor any technique can be paid for.
  const canPay = handOf(fight, actor).some(
    (t) => (t.pool === 'chakra' ? player.chakra : player.stamina) >= t.cost && castable(fight, t),
  );
  if (canPay) return beginWait(ctx, actor);
  // An ally has no breath to catch: with nothing left to pay for it is dispelled and what it has returns to the character.
  if (!own) return dispelAlly(ctx, actor);
  enter(
    fight,
    player,
    'rest',
    { kind: 'rest', id: null, target: null },
    needOf(secMs(content.balance.K.rest.s)),
    player.timer.progress,
  );
}

function beginWait(ctx: FightCtx, actor: Combatant): void {
  enter(ctx.fight, actor, 'wait', null, needOf(actor.waitMs), actor.timer.progress);
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

function startTechnique(
  ctx: FightCtx,
  actor: Combatant,
  tech: KitTechnique,
  target: string | undefined,
): void {
  const fight = ctx.fight;
  const player = actor;
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
  if (actor === fight.player) fight.target = target ?? null;
  // Mastery is paid for the fight time since the previous technique use (or the fight's start), by whichever body cast: an ally's cast is the character's.
  if (actor === fight.player) {
    count(fight.tally.masteryWork, tech.id, fight.t - fight.tally.lastUseAt);
    fight.tally.lastUseAt = fight.t;
    fight.tally.style = tech.skill;
  } else if (actor.ally) {
    // Each body earns by its own actions: an ally's Mastery work and style are held in it until it leaves the fight.
    const held = heldOf(actor, fight.t);
    count(held.work, tech.id, fight.t - held.last);
    held.last = fight.t;
    held.style = tech.skill;
  }
  note(fight, 'player', 'cast', tech.id, 0, player.id, undefined, allyOf(actor));
}

/** The plain strike is an action: it costs a little stamina, takes its own time and lands when it ends. */
function startBasic(
  ctx: FightCtx,
  actor: Combatant,
  targetId: string | undefined,
  cost: number,
): void {
  const fight = ctx.fight;
  const player = actor;
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
  if (actor === fight.player) {
    fight.tally.style = fightData(ctx.content).basicSkill ?? fight.tally.style;
  } else if (actor.ally) {
    const basic = fightData(ctx.content).basicSkill;
    if (basic) heldOf(actor, fight.t).style = basic;
  }
  note(fight, 'player', 'cast', null, 0, player.id, undefined, allyOf(actor));
}

function finishBasic(ctx: FightCtx, actor: Combatant, targetId: string | null): void {
  const fight = ctx.fight;
  const player = actor;
  fight.tally.basic++;
  const target = pickTarget(fight, targetId);
  if (!target) return;
  const chance = hitChance(
    stat(ctx, player, 'accuracy', player.accuracy),
    evasionAgainst(ctx, target, player),
    ctx.content,
  );
  const by = actor === fight.player ? undefined : actor.id;
  if (rollHit(ctx, target, chance)) {
    const damage = player.damage * stat(ctx, player, 'taiDamage', 1);
    note(
      fight,
      'player',
      'hit',
      null,
      dealDamage(ctx, target, damage, 'basic'),
      by,
      undefined,
      allyOf(actor),
    );
  } else note(fight, 'player', 'miss', null, 0, by, undefined, allyOf(actor));
}

/** A body's action ends: its effect happens now, then it waits again. */
function finishAct(ctx: FightCtx, actor: Combatant): void {
  const player = actor;
  const act = player.act;
  delete player.data['act.chakra'];
  delete player.data['act.stamina'];
  if (act) {
    resolveAs(ctx, player, act, () => {
      if (act.kind === 'technique') resolveCast(ctx, actor, act.id, act.target);
      else if (act.kind === 'basic') finishBasic(ctx, actor, act.target);
    });
  }
  // An ally that the action itself dispelled does not wait again.
  if (ctx.fight.result === 'ongoing' && alive(actor)) {
    enter(ctx.fight, player, 'wait', null, needOf(player.waitMs), player.timer.progress);
  }
}

function resolveCast(ctx: FightCtx, actor: Combatant, id: string | null, at: string | null): void {
  const { fight, content } = ctx;
  const player = actor;
  const tech = handOf(fight, actor).find((t) => t.id === id);
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
  applyTechniqueEffect(ctx, actor, tech);
  if (actor === fight.player) fight.target = at;
  const hurtsEnemy =
    tech.fx.kind !== 'summon' &&
    (tech.damage > 0 ||
      tech.state !== null ||
      tech.tags.some((tag) => (tags.get(tag)?.onHit.length ?? 0) > 0));
  if (!hurtsEnemy) {
    if (actor === fight.player) fight.target = null;
    return;
  }
  const aimed = pickTarget(fight, at);
  if (actor === fight.player) fight.target = null;
  const by = actor === fight.player ? undefined : actor.id;
  const ally = allyOf(actor);
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
      note(
        fight,
        'player',
        'hit',
        tech.id,
        applyHit(ctx, actor, tech, target, hab),
        by,
        undefined,
        ally,
      );
    } else note(fight, 'player', 'miss', tech.id, 0, by, undefined, ally);
  }
}

/** What a technique does to the player's side besides hurting an enemy, from its combat data. */
function applyTechniqueEffect(ctx: FightCtx, actor: Combatant, tech: KitTechnique): void {
  const fight = ctx.fight;
  const player = actor;
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
    case 'summon':
      if (actor === fight.player && fx.summon) summonAllies(ctx, tech, fx.summon);
      break;
    default:
      break;
  }
}

/** The key of a body's data that scales what its techniques do (absent: 1); an ally's strikes are a share of the caster's. */
const POWER_KEY = 'power';

/** The number of an ally body, for the lines of the log and the view; undefined for the character and for enemies. */
const allyOf = (c: Combatant): number | undefined => c.ally?.n;

/**
 * Puts the bodies a technique makes on the character's side. They take `share` of the character's
 * current chakra and stamina between them (evenly); each has `hp` of the character's maximum
 * health, the character's combat numbers, and waits and acts by the character's own timings. The
 * side holds at most `max` living bodies at once.
 */
function summonAllies(ctx: FightCtx, tech: KitTechnique, spec: SummonSpec): void {
  const { fight } = ctx;
  const player = fight.player;
  const living = alliesOf(fight).filter(alive).length;
  const n = Math.min(spec.count, Math.max(0, spec.max - living));
  if (n < 1 || !alive(player)) return;
  const chakra = player.chakra * spec.share;
  const stamina = player.stamina * spec.share;
  player.chakra -= chakra;
  player.stamina -= stamina;
  const allies = (fight.allies ??= []);
  for (let i = 0; i < n; i++) {
    const number = (fight.allied = (fight.allied ?? 0) + 1);
    const hp = player.maxHp * spec.hp;
    // What the character knows of the enemies, the clone knows: the same hit and dodge numbers.
    // The role of the clones may make the enemies mind them more or less (absent: as the technique made them).
    const threat = spec.threat * (fight.kit.cloneThreat ?? 1);
    const data: Record<string, number> = { threat, [POWER_KEY]: spec.dmg };
    for (const [key, value] of Object.entries(player.data)) {
      if (key.startsWith('know.')) data[key] = value;
    }
    allies.push({
      id: `ally#${number}`,
      side: 'player',
      entry: '',
      hp,
      maxHp: hp,
      chakra: chakra / n,
      maxChakra: chakra / n,
      stamina: stamina / n,
      maxStamina: stamina / n,
      accuracy: player.accuracy,
      evasion: player.evasion,
      damage: player.damage * spec.dmg,
      waitMs: player.waitMs,
      strikeMs: player.strikeMs,
      nature: null,
      traits: [],
      specials: [],
      effects: [],
      cd: {},
      phase: 'wait',
      act: null,
      phaseAt: fight.t,
      last: null,
      // The bodies that came together do not all act at the same moment.
      timer: {
        progress: 0,
        need: needOf(player.waitMs) + Math.round((needOf(player.waitMs) * i) / n),
      },
      timers: {},
      data,
      ward: 0,
      wardUntil: null,
      decoys: 0,
      decoyUntil: null,
      fleeAt: null,
      fled: false,
      ally: {
        n: number,
        kind: tech.id,
        held: {
          xp: {},
          work: {},
          last: fight.t,
          ...(fight.allyXpRate ? { xpAt: fight.t } : {}),
        },
      },
    });
  }
}

/** What an ally has earned and not yet handed over; made on first use. */
export function heldOf(ally: Combatant, now: number): AllyHeld {
  if (!ally.ally) throw new Error('only an ally holds what it earned');
  return (ally.ally.held ??= { xp: {}, work: {}, last: now });
}

/** What an ally still holds goes back to the character; once, however many times it is called. */
function releaseAlly(ctx: FightCtx, ally: Combatant): void {
  const player = ctx.fight.player;
  const held = ally.ally?.held;
  if (held) {
    accrueAllyXp(ctx, ally, held);
    // The XP and Mastery the body earned wait in the tally for the game to pay them, once.
    const tally = ctx.fight.tally;
    // The numbers come from the technique that summoned the body: what passes on, and how much of it tires the mind.
    const shares = sharesOf(ctx.content, ally.ally?.kind ?? '');
    for (const [skill, n] of Object.entries(held.xp)) {
      count((tally.allyXp ??= {}), skill, n * shares.pass);
      count((tally.allyTire ??= {}), skill, n * shares.pass * shares.fatigue);
    }
    for (const [id, n] of Object.entries(held.work)) {
      count((tally.allyWork ??= {}), id, n * shares.xp * shares.pass);
    }
    held.xp = {};
    held.work = {};
  }
  if (alive(player)) {
    player.chakra = Math.min(player.maxChakra, player.chakra + ally.chakra);
    player.stamina = Math.min(player.maxStamina, player.stamina + ally.stamina);
  }
  ally.chakra = 0;
  ally.stamina = 0;
}

/**
 * In a fight that counts its allies' combat XP by the clock (a mission's), what the body earned since the last count is
 * added to what it holds, by the skill of its style and the weights of combat XP, as a fight's own tick does.
 */
function accrueAllyXp(ctx: FightCtx, ally: Combatant, held: AllyHeld): void {
  const rate = ctx.fight.allyXpRate;
  if (!rate || held.xpAt === undefined) return;
  const dt = Math.max(0, ctx.fight.t - held.xpAt);
  // A body that has left earns no more.
  held.xpAt = alive(ally) ? ctx.fight.t : undefined;
  if (dt <= 0) return;
  const share = sharesOf(ctx.content, ally.ally?.kind ?? '').xp;
  for (const [key, mult] of Object.entries(ctx.content.balance.K.combatXp)) {
    const skill = key === 'style' ? (held.style ?? fightData(ctx.content).basicSkill) : key;
    if (skill) held.xp[skill] = (held.xp[skill] ?? 0) + mult * dt * rate * share;
  }
}

/** An ally leaves the fight without being struck down: its chakra runs dry. It does not come back. */
function dispelAlly(ctx: FightCtx, ally: Combatant): void {
  if (!alive(ally)) return;
  ally.hp = 0;
  if (ally.ally) ally.ally.out = 'dispelled';
  leave(ctx, ally);
  ally.effects = [];
  ally.act = null;
  ally.phase = 'wait';
  releaseAlly(ctx, ally);
}

const sum = (r: Record<string, number> | undefined): number =>
  Object.values(r ?? {}).reduce((n, x) => n + x, 0);

/** The fight ends: the allies that still stand give back what they have left, and hand over what they earned. */
export function releaseAllies(ctx: FightCtx): void {
  for (const a of alliesOf(ctx.fight)) {
    const counting = a.ally?.held?.xpAt !== undefined;
    if (
      a.chakra > 0 ||
      a.stamina > 0 ||
      counting ||
      sum(a.ally?.held?.xp) > 0 ||
      sum(a.ally?.held?.work) > 0
    ) {
      releaseAlly(ctx, a);
    }
  }
}

/** The body of the character's side that an enemy aims at: the character alone, or one of the living bodies drawn by weight (the character 1, an ally its `threat`) on the fight's own stream. */
export function pickVictim(ctx: FightCtx): Combatant {
  const fight = ctx.fight;
  const allies = alliesOf(fight).filter(alive);
  if (allies.length === 0) return fight.player;
  const bodies = [fight.player, ...allies];
  const weight = (c: Combatant): number => (c === fight.player ? 1 : (c.data.threat ?? 1));
  const total = bodies.reduce((n, c) => n + weight(c), 0);
  let at = nextFloatFrom(fight.rng) * total;
  for (const c of bodies) {
    at -= weight(c);
    if (at < 0) return c;
  }
  return bodies[bodies.length - 1] ?? fight.player;
}

/** What one technique does to one enemy it hit: tags, damage, status, then combos. Returns the direct damage dealt. */
function applyHit(
  ctx: FightCtx,
  actor: Combatant,
  tech: KitTechnique,
  target: Combatant,
  hab: number,
): number {
  const { content } = ctx;
  const data = fightData(content);
  // What the combos need of the body is read before the hit changes it.
  const priors = comboPriors(ctx, tech, target);
  for (const tag of tech.tags) {
    const def = data.tags.get(tag);
    if (def) runTagOps(ctx, target, def.onHit, tech.id, tech.rank);
  }
  const base =
    tech.damage *
    (actor.data[POWER_KEY] ?? 1) *
    hab *
    wheelFactor(tech.skill, target.nature, content) *
    (data.physical.has(tech.skill) ? stat(ctx, actor, 'taiDamage', 1) : 1);
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
function enemyAttack(ctx: FightCtx, enemy: Combatant, aimedAt: string | null): void {
  const fight = ctx.fight;
  // The body the wind-up was aimed at, if it still stands; otherwise the enemy aims anew.
  const player = sideBodies(fight).find((b) => b.id === aimedAt && alive(b)) ?? pickVictim(ctx);
  const ally = allyOf(player);
  if (resolving) resolving.struck = player.id;
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
    // What a defensive technique of the character did is the character's own: an ally's dodge has no name.
    const via = ally === undefined ? avoidedBy(ctx) : null;
    if (resolving) resolving.avoidedBy = via;
    note(fight, 'enemy', 'miss', null, 0, undefined, via ?? undefined, ally);
    return;
  }
  const dealt = dealDamage(ctx, player, plan.damage, enemy.id);
  note(fight, 'enemy', 'hit', null, dealt, undefined, undefined, ally);
  // An attack that carries the interrupt does what the interrupting tags of the content do to whoever it hits:
  // breaks the cast under way, and leaves the status that follows.
  if (plan.interrupts === true && alive(player)) {
    for (const tag of fightData(ctx.content).tags.values()) {
      if (tag.interrupts) runTagOps(ctx, player, tag.onHit, enemy.id);
    }
  }
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

/** A heavy blow, for hooks such as the caster's: like every incoming strike it rolls once, its accuracy against the evasion of the body it strikes. Returns that body when the blow lands, else null. */
export function heavyBlow(ctx: FightCtx, enemy: Combatant, damage: number): Combatant | null {
  const player = pickVictim(ctx);
  const ally = allyOf(player);
  if (resolving) resolving.struck = player.id;
  if (!rollHit(ctx, player, hitChanceOf(ctx, enemy, player))) {
    const via = ally === undefined ? avoidedBy(ctx) : null;
    note(ctx.fight, 'enemy', 'miss', null, 0, undefined, via ?? undefined, ally);
    return null;
  }
  note(
    ctx.fight,
    'enemy',
    'hit',
    null,
    dealDamage(ctx, player, damage, enemy.id),
    undefined,
    undefined,
    ally,
  );
  return player;
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
  for (const a of alliesOf(fight)) tickEffects(ctx, a);
  for (const e of fight.enemies) tickEffects(ctx, e);
  if (checkResult(fight)) return;
  expire(fight, player);
  for (const a of alliesOf(fight)) if (alive(a)) expire(fight, a);
  for (const e of fight.enemies) if (alive(e)) expire(fight, e);

  // Enemies spawned during the loop wait for the next event.
  for (const e of [...fight.enemies]) {
    if (!alive(e)) continue;
    while (e.timer.progress >= e.timer.need && alive(player)) {
      e.timer.progress -= e.timer.need;
      if (e.phase === 'wait') {
        // The wait is over: the body it will strike is chosen, and the wind-up of the attack begins, and can be seen.
        const victim = pickVictim(ctx);
        enter(
          fight,
          e,
          'act',
          { kind: 'attack', id: null, target: victim.id },
          needOf(e.strikeMs),
          e.timer.progress,
        );
        note(fight, 'enemy', 'cast', null, 0, e.id, undefined, allyOf(victim));
      } else {
        const act: FightAct = e.act ?? { kind: 'attack', id: null, target: player.id };
        resolveAs(ctx, e, act, () => enemyAttack(ctx, e, act.target));
        enter(fight, e, 'wait', null, needOf(e.waitMs), e.timer.progress);
      }
    }
    runTimers(ctx, e);
  }
  runTimers(ctx, player);
  // A timer a hook armed on an ally fires like the character's.
  for (const a of alliesOf(fight)) if (alive(a)) runTimers(ctx, a);
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
    if (player.phase === 'wait') decide(ctx, player);
    else if (player.phase === 'act') finishAct(ctx, player);
    else {
      finishRest(ctx);
      beginWait(ctx, player);
    }
    checkResult(fight);
  }
  // The allies, in the order they came in, after the character: each waits, then acts, the same way.
  for (const ally of [...alliesOf(fight)]) {
    while (fight.result === 'ongoing' && alive(ally) && ally.timer.progress >= ally.timer.need) {
      ally.timer.progress -= ally.timer.need;
      if (ally.phase === 'wait') decide(ctx, ally);
      else finishAct(ctx, ally);
      checkResult(fight);
    }
  }
}
