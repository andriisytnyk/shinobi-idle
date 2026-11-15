import { NATURE_IDS, NATURE_WHEEL } from '@shinobi/content';
import type { ComboId, ContentDb, NatureId, Rank, SkillId } from '@shinobi/content';
import { createStream, nextFloatFrom } from '../rng.ts';
import { addEffect, findEffect, isSuppressed, removeEffect, statOf } from './fight-effects.ts';
import type {
  Combatant,
  Decision,
  Encounter,
  FightCtx,
  FightHook,
  FightRules,
  FightState,
  FightTally,
  FightView,
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
  basicAttackOf,
  chakraRegenOf,
  enemyStats,
  evasionOf,
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

function emptyTally(): FightTally {
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
    style: 'tai',
    lastUseAt: 0,
    masteryWork: {},
  };
}

/** A deep copy of plain JSON. */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const count = (record: Record<string, number>, key: string, n = 1): void => {
  record[key] = (record[key] ?? 0) + n;
};

/** What hooks and helpers work with. */
export const makeCtx = (fight: FightState, content: ContentDb, rules: FightRules): FightCtx => ({
  fight,
  content,
  rules,
});

/** The hooks a combatant carries, in the order of the rule set. */
export function hooksOf(ctx: FightCtx, c: Combatant): FightHook[] {
  const out: FightHook[] = [];
  for (const hook of ctx.rules.fightHooks) {
    if (c.traits.includes(hook.id as never) || c.specials.includes(hook.id)) out.push(hook);
  }
  return out;
}

/** A stat after effects and hooks. */
export function stat(ctx: FightCtx, c: Combatant, which: ModStat, base: number): number {
  let value = statOf(c, which, base);
  for (const hook of hooksOf(ctx, c)) if (hook.stat) value *= hook.stat(ctx, c, which);
  return value;
}

/** Timer speed in thousandths of full speed; 0 while stunned. */
export const speed = (ctx: FightCtx, c: Combatant): number =>
  Math.max(0, Math.round(stat(ctx, c, 'speed', RATE_FULL)));

export function roll(fight: FightState, chance: number): boolean {
  return nextFloatFrom(fight.rng) < chance;
}

// ---------- creation ----------

function buildKit(snap: PlayerSnapshot, content: ContentDb): PlayerKit {
  const K = content.balance.K;
  const known = new Set(snap.known);
  const loadout = snap.loadout ? new Set(snap.loadout) : null;
  const techniques: KitTechnique[] = [];
  for (const tech of content.techniques) {
    if (!known.has(tech.id) || tech.rank === null) continue;
    if (loadout && !loadout.has(tech.id)) continue;
    const n = techniqueFigures(snap, tech, content);
    const mastery = snap.mastery[tech.id] ?? 1;
    techniques.push({
      id: tech.id,
      skill: tech.skill,
      role: tech.role,
      rank: tech.rank,
      tags: [...tech.tags],
      state: tech.state,
      damage: n.damage,
      castMs: n.castMs,
      cooldownMs: n.cooldownMs,
      pool: n.pool,
      cost: n.cost,
      accuracy: accuracyOf(snap.levels, tech.skill, content),
      comboChance: Math.min(
        K.combo.cap,
        K.combo.base + K.combo.perLevel * snap.levels[tech.skill] + K.combo.perMastery * mastery,
      ),
      hitsAll: tech.role === 'area' || tech.tags.includes('area') || tech.combat?.hitsAll === true,
      guaranteedCombo: tech.combat?.guaranteedCombo ?? null,
      habituationMult: snap.signature === tech.id ? K.signatureHabituation : 1,
    });
  }
  return {
    techniques,
    med: snap.levels.med,
    chakraRegen: chakraRegenOf(snap.levels, content),
    staminaRegen: staminaRegenOf(snap.levels, content),
  };
}

/** The nature an enemy fights with; `wheel` is the one that beats the player's first nature. */
function natureOf(spawn: Spawn, natures: readonly NatureId[]): NatureId | null {
  if (spawn.nature !== 'wheel') return spawn.nature;
  const first = natures[0];
  if (!first) return null;
  return NATURE_IDS.find((n) => NATURE_WHEEL[n] === first) ?? null;
}

const idleTimer = (): Timer => ({ progress: 0, need: 0 });

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

function addBodies(ctx: FightCtx, spawn: Spawn, n: number, staggered: boolean): Combatant[] {
  const { fight, content } = ctx;
  const K = content.balance.K;
  fight.enemies = fight.enemies.filter(alive);
  const room = Math.max(0, K.combat.maxEnemies - fight.enemies.length);
  const bodies = Math.min(n, room);
  const stats = enemyStats(spawn, content);
  const maxHp = stats.maxHp * spawn.hpMult;
  const added: Combatant[] = [];
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
      accuracy: stats.accuracy,
      evasion: stats.evasion,
      damage: stats.damage * spawn.dmgMult,
      intervalMs: stats.intervalMs,
      nature: natureOf(spawn, fight.natures),
      traits: [...spawn.traits],
      specials: [...fight.encounter.specials],
      effects: [],
      cd: {},
      phase: 'attack',
      cast: null,
      // Bodies that start together are staggered so they do not all strike at once.
      timer: {
        progress: 0,
        need: staggered
          ? Math.round((needOf(stats.intervalMs) * (bodies + i)) / bodies)
          : needOf(stats.intervalMs),
      },
      timers: {},
      data: {},
      ward: 0,
      wardUntil: null,
      decoys: 0,
      fleeAt: spawn.fleeAt,
      fled: false,
    };
    fight.enemies.push(c);
    added.push(c);
    for (const hook of hooksOf(ctx, c)) hook.init?.(ctx, c);
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
  const levels = snap.levels;
  const maxHp = maxHpOf(levels, content);
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
    accuracy: basic.accuracy,
    evasion: evasionOf(levels, content),
    damage: basic.damage,
    intervalMs: basic.intervalMs,
    nature: null,
    traits: [],
    specials: [],
    effects: [],
    cd: {},
    phase: 'idle',
    cast: null,
    timer: idleTimer(),
    timers: {},
    data: {},
    ward: 0,
    wardUntil: null,
    decoys: 0,
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
    uses: {},
    poolAt: workOf(K.combat.regenMs),
    tally: emptyTally(),
    log: [],
  };
  const ctx = makeCtx(fight, content, rules);
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
  if (player.phase === 'idle') return 0;
  const ctx = makeCtx(fight, content, rules);
  let best = Math.min(fight.poolAt, fight.cap) - fight.t;
  const take = (n: number | null): void => {
    if (n !== null && n < best) best = n;
  };
  const dueOf = (c: Combatant): void => {
    for (const e of c.effects) {
      if (e.kind === 'periodic' && (e.until === null || e.next <= e.until)) take(e.next - fight.t);
      if (e.until !== null) take(e.until - fight.t);
    }
    if (c.ward > 0 && c.wardUntil !== null) take(c.wardUntil - fight.t);
    const rate = speed(ctx, c);
    for (const name in c.timers) {
      const timer = c.timers[name];
      if (timer) take(timeTo(timer, rate));
    }
    if (c.phase !== 'idle') take(timeTo(c.timer, rate));
  };
  dueOf(player);
  for (const e of fight.enemies) if (alive(e)) dueOf(e);
  return Math.max(0, best);
}

function fill(ctx: FightCtx, c: Combatant, dt: number): void {
  const rate = speed(ctx, c);
  if (rate === 0) return;
  const add = dt * rate;
  if (c.phase !== 'idle') c.timer.progress += add;
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
  while (fight.result === 'ongoing') {
    const next = fightNextEventIn(fight, content, rules);
    if (next === null || next > left) {
      step(ctx, left);
      return 0;
    }
    stalled = next === 0 ? stalled + 1 : 0;
    if (stalled > STALL_LIMIT) throw new Error('fight made no progress: an event repeats at once');
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

/** Whether a combo whose rule is met fires: always for its guaranteed technique, else by chance. Counts it. */
function combo(fight: FightState, tech: KitTechnique, id: ComboId): boolean {
  const fires = tech.guaranteedCombo === id || roll(fight, tech.comboChance);
  if (fires) count(fight.tally.combos, id);
  return fires;
}

/** The player's fall wins over the last enemy's in the same moment; a leaving enemy ends the fight as `fled`. */
function checkResult(fight: FightState): boolean {
  if (fight.result !== 'ongoing') return true;
  if (!alive(fight.player)) fight.result = 'defeat';
  else if (!fight.enemies.some(alive)) {
    fight.result = fight.enemies.some((e) => e.fled) ? 'fled' : 'victory';
  }
  return fight.result !== 'ongoing';
}

function note(
  fight: FightState,
  side: 'player' | 'enemy',
  act: 'cast' | 'hit' | 'miss',
  tech: string | null,
  dmg: number,
): void {
  fight.log?.push({ side, act, tech, dmg });
}

/**
 * Takes `amount` of `target`'s health (ward and modifiers have been applied by the caller),
 * credited to `src` when the target is an enemy. Tells the hooks, and sends an enemy that falls
 * to its flee share away. Returns the health actually taken.
 */
function hurt(ctx: FightCtx, target: Combatant, amount: number, src: string): number {
  const fight = ctx.fight;
  if (!alive(target) || !(amount > 0)) return 0;
  const applied = Math.min(amount, target.hp);
  target.hp -= applied;
  if (target.side === 'enemy') count(fight.tally.damage, src, applied);
  else fight.tally.taken += applied;
  for (const hook of hooksOf(ctx, target)) hook.onDamaged?.(ctx, target, applied, src);
  if (!alive(target)) {
    if (target.side === 'enemy') fight.tally.kills++;
    for (const hook of hooksOf(ctx, target)) hook.onDeath?.(ctx, target);
  } else if (target.fleeAt !== null && target.hp <= target.maxHp * target.fleeAt) {
    target.fled = true;
    target.hp = 0;
  }
  return applied;
}

/**
 * The first step of every incoming attack: the hit roll (`null` chance: a sure hit), then a decoy
 * charge, which turns a hit into a miss. Returns whether the attack gets through.
 */
export function rollHit(ctx: FightCtx, target: Combatant, chance: number | null): boolean {
  if (chance !== null && !roll(ctx.fight, chance)) return false;
  if (target.decoys > 0) {
    target.decoys--;
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

/** Cancels every cast of a combatant's hooks that is under way; returns whether any was. */
function cancelCasts(ctx: FightCtx, target: Combatant): boolean {
  let any = false;
  for (const hook of hooksOf(ctx, target)) {
    if (hook.castInfo?.(ctx, target)?.casting) {
      hook.onCancel?.(ctx, target);
      any = true;
    }
  }
  return any;
}

/** Bind lowers evasion and switches Evasive off; a weaker bind never replaces a stronger one. */
function applyBind(ctx: FightCtx, target: Combatant, evasion: number, src: string): void {
  const fight = ctx.fight;
  const until = fight.t + secWork(ctx.content.balance.K.bind.dur);
  const old = findEffect(target, 'bind');
  const stronger = old?.kind === 'modifier' && old.value < evasion;
  addEffect(target, {
    kind: 'modifier',
    id: 'bind',
    src: stronger ? old.src : src,
    // A weaker bind leaves the stronger one as it is.
    until: stronger ? old.until : until,
    suppresses: 'evasive',
    stat: 'evasion',
    op: 'mul',
    value: stronger ? old.value : evasion,
  });
  count(fight.tally.statuses, 'bind');
}

/** Poisons a combatant: a share of its maximum health every second for the configured time. */
export function applyPoison(ctx: FightCtx, target: Combatant, src: string): void {
  const K = ctx.content.balance.K;
  const fight = ctx.fight;
  addEffect(target, {
    kind: 'periodic',
    id: 'poison',
    src,
    until: fight.t + secWork(K.poison.dur),
    suppresses: 'regen',
    mode: 'damage',
    amount: K.poison.pctPerSec * target.maxHp,
    every: workOf(TICK_MS),
    next: fight.t + workOf(TICK_MS),
  });
  count(fight.tally.statuses, 'poison');
}

function stunSeconds(rank: Rank, content: ContentDb): number {
  const stun = content.balance.K.stun;
  if (rank === 'E' || rank === 'D') return stun.D;
  return rank === 'C' ? stun.C : stun.B;
}

/** The nature wheel: +wheel against a nature the technique beats, -wheel against one that beats it. */
function wheelFactor(skill: SkillId, nature: NatureId | null, content: ContentDb): number {
  if (nature === null || !(NATURE_IDS as readonly string[]).includes(skill)) return 1;
  const wheel = content.balance.K.wheel;
  const own = skill as NatureId;
  if (NATURE_WHEEL[own] === nature) return 1 + wheel;
  if (NATURE_WHEEL[nature] === own) return 1 - wheel;
  return 1;
}

/** Damage multiplier of habituation after `previous` uses of a technique against this enemy. */
function habituation(previous: number, mult: number, content: ContentDb): number {
  const K = content.balance.K;
  return 1 - Math.min(K.habituationCap, K.habituation * mult * previous);
}

function lowestHp(enemies: readonly Combatant[]): Combatant | undefined {
  let best: Combatant | undefined;
  for (const e of enemies) if (alive(e) && (!best || e.hp < best.hp)) best = e;
  return best;
}

/** The body an attack is aimed at: the one the AI named if it lives, else the weakest. */
function pickTarget(fight: FightState, id: string | null | undefined): Combatant | undefined {
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
  const player = fight.player;
  const living = fight.enemies.filter(alive);
  const primary = lowestHp(living);
  const techniques: ViewTechnique[] = fight.kit.techniques.map((tech) => {
    const cooldownLeft = Math.max(0, (player.cd[tech.id] ?? 0) - fight.t);
    const affordable = (tech.pool === 'chakra' ? player.chakra : player.stamina) >= tech.cost;
    const uses = fight.uses[tech.id] ?? 0;
    const wheel = wheelFactor(tech.skill, primary?.nature ?? null, content);
    const targets = tech.hitsAll ? living.length : 1;
    return {
      tech: { ...tech, tags: [...tech.tags] },
      cooldownLeft,
      affordable,
      ready: cooldownLeft === 0 && affordable,
      uses,
      expected: tech.damage * habituation(uses, tech.habituationMult, content) * wheel * targets,
    };
  });
  const enemies: ViewEnemy[] = living.map((e) => {
    const known = fight.knowledge[e.entry];
    const knownTraits = known ? e.traits.filter((t) => known.includes(t)) : [...e.traits];
    const workingTraits = knownTraits.filter((trait) => {
      const hook = ctx.rules.fightHooks.find((h) => h.id === trait);
      return hook?.working ? hook.working(ctx, e) : !isSuppressed(e, trait);
    });
    let cast: ViewEnemy['cast'] = null;
    let nextCastIn: number | null = null;
    for (const hook of hooksOf(ctx, e)) {
      const info = hook.castInfo?.(ctx, e);
      if (!info || info.inWork === null) continue;
      if (info.casting) cast = { kind: info.kind, remaining: info.inWork };
      else nextCastIn = info.inWork;
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
    },
    techniques,
    enemies,
    habituation: { ...fight.uses },
  };
}

function act(ctx: FightCtx): void {
  const fight = ctx.fight;
  const view = buildView(ctx);
  const decision: Decision = ctx.rules.combatAi(view);
  if (decision.type === 'technique') {
    const chosen = view.techniques.find((r) => r.tech.id === decision.id && r.ready);
    const tech = chosen && fight.kit.techniques.find((t) => t.id === chosen.tech.id);
    if (tech) return startCast(fight, tech, decision.target);
  }
  if (decision.type === 'wait') {
    fight.player.phase = 'recover';
    fight.player.timer.need = needOf(TICK_MS);
    return;
  }
  basicAttack(ctx, decision.type === 'basic' ? decision.target : undefined);
}

function startCast(fight: FightState, tech: KitTechnique, target: string | undefined): void {
  const player = fight.player;
  if (tech.pool === 'chakra') player.chakra -= tech.cost;
  else player.stamina -= tech.cost;
  player.phase = 'cast';
  player.cast = tech.id;
  player.timer.need = needOf(tech.castMs);
  fight.target = target ?? null;
  // Mastery is paid for the fight time since the previous technique use (or the fight's start).
  count(fight.tally.masteryWork, tech.id, fight.t - fight.tally.lastUseAt);
  fight.tally.lastUseAt = fight.t;
  fight.tally.style = tech.skill;
  note(fight, 'player', 'cast', tech.id, 0);
}

function basicAttack(ctx: FightCtx, targetId: string | undefined): void {
  const fight = ctx.fight;
  const player = fight.player;
  player.phase = 'recover';
  player.timer.need = needOf(player.intervalMs);
  fight.tally.style = 'tai';
  fight.tally.basic++;
  const target = pickTarget(fight, targetId);
  if (!target) return;
  const chance = hitChance(
    stat(ctx, player, 'accuracy', player.accuracy),
    stat(ctx, target, 'evasion', target.evasion),
    ctx.content,
  );
  if (rollHit(ctx, target, chance)) {
    note(fight, 'player', 'hit', null, dealDamage(ctx, target, player.damage, 'basic'));
  } else note(fight, 'player', 'miss', null, 0);
}

function resolveCast(ctx: FightCtx): void {
  const { fight, content } = ctx;
  const player = fight.player;
  const tech = fight.kit.techniques.find((t) => t.id === player.cast);
  player.cast = null;
  if (!tech) return;
  player.cd[tech.id] = fight.t + workOf(tech.cooldownMs);
  const previous = fight.uses[tech.id] ?? 0;
  fight.uses[tech.id] = previous + 1;
  count(fight.tally.uses, tech.id);
  const hab = habituation(previous, tech.habituationMult, content);
  // Tags that work on the player rather than on an enemy act when the cast ends.
  if (tech.tags.includes('reveal')) removeEffect(player, 'hidden');
  if (tech.tags.includes('dispel')) removeEffect(player, 'illusion');
  if (tech.tags.includes('cleanse')) removeEffect(player, 'poison');
  const hurtsEnemy =
    tech.damage > 0 ||
    tech.state !== null ||
    tech.tags.includes('bind') ||
    tech.tags.includes('interrupt') ||
    tech.tags.includes('pierce');
  if (!hurtsEnemy) return;
  const aimed = pickTarget(fight, fight.target);
  fight.target = null;
  const targets = tech.hitsAll ? fight.enemies.filter(alive) : aimed ? [aimed] : [];
  for (const target of targets) {
    const chance = hitChance(
      stat(ctx, player, 'accuracy', tech.accuracy),
      stat(ctx, target, 'evasion', target.evasion),
      content,
    );
    if (rollHit(ctx, target, chance)) {
      note(fight, 'player', 'hit', tech.id, applyHit(ctx, tech, target, hab));
    } else note(fight, 'player', 'miss', tech.id, 0);
  }
}

/** What one technique does to one enemy it hit: tags, damage, status, then combos. Returns the direct damage dealt. */
function applyHit(ctx: FightCtx, tech: KitTechnique, target: Combatant, hab: number): number {
  const { fight, content } = ctx;
  const K = content.balance.K;
  const now = fight.t;
  const wetBefore = findEffect(target, 'wet') !== undefined;
  const burnBefore = findEffect(target, 'burn');
  if (tech.tags.includes('pierce')) {
    addEffect(target, {
      kind: 'modifier',
      id: 'armorOff',
      src: tech.id,
      until: now + secWork(K.trait.armorOff),
      suppresses: 'armor',
      stat: 'damageTaken',
      op: 'mul',
      value: 1,
    });
    if (target.traits.includes('armor')) count(fight.tally.statuses, 'armorBreak');
  }
  if (tech.tags.includes('bind')) applyBind(ctx, target, K.bindEva, tech.id);
  if (tech.tags.includes('interrupt') && cancelCasts(ctx, target)) fight.tally.interrupts++;
  const base = tech.damage * hab * wheelFactor(tech.skill, target.nature, content);
  const dealt = dealDamage(ctx, target, base, tech.id);
  if (!alive(target)) return dealt;

  if (tech.state === 'burn') {
    const amount = (K.burn.share * base) / K.burn.dur;
    addEffect(target, {
      kind: 'periodic',
      id: 'burn',
      src: tech.id,
      until: now + secWork(K.burn.dur),
      suppresses: 'regen',
      mode: 'damage',
      amount,
      base: amount,
      every: workOf(TICK_MS),
      next: now + workOf(TICK_MS),
    });
    count(fight.tally.statuses, 'burn');
  }
  if (tech.state === 'wet') {
    addEffect(target, {
      kind: 'modifier',
      id: 'wet',
      src: tech.id,
      until: now + secWork(K.wet.dur),
      stat: 'speed',
      op: 'mul',
      value: 1 - K.wet.slow,
    });
    count(fight.tally.statuses, 'wet');
  }
  if (tech.state === 'stun') {
    const shock = tech.skill === 'raiton' && wetBefore && combo(fight, tech, 'shockWet');
    const length = secWork(stunSeconds(tech.rank, content)) * (shock ? K.combo.shockWet : 1);
    const old = findEffect(target, 'stun');
    addEffect(target, {
      kind: 'modifier',
      id: 'stun',
      src: tech.id,
      until: Math.max(now + length, old?.until ?? 0),
      stat: 'speed',
      op: 'mul',
      value: 0,
    });
    cancelCasts(ctx, target);
    count(fight.tally.statuses, 'stun');
  }

  if (tech.skill === 'futon' && burnBefore?.kind === 'periodic' && combo(fight, tech, 'fanBurn')) {
    // The boost is applied to the burn's own strength, once, however many times it fires.
    const own = burnBefore.base ?? burnBefore.amount;
    burnBefore.base = own;
    burnBefore.amount = own * K.combo.fanBurn;
    burnBefore.until = now + secWork(K.burn.dur);
  }
  if (tech.skill === 'doton' && wetBefore && combo(fight, tech, 'mudEva')) {
    applyBind(ctx, target, K.combo.mudEva, tech.id);
  }
  if (tech.skill === 'katon' && wetBefore && combo(fight, tech, 'steam')) {
    removeEffect(target, 'wet');
    dealDamage(ctx, target, K.combo.steam * base, tech.id);
  }
  return dealt;
}

// ---------- the enemies' side and the clock's ----------

/** One basic attack of an enemy body on the player: hooks may change it, then the incoming pipeline runs. */
function enemyAttack(ctx: FightCtx, enemy: Combatant): void {
  const fight = ctx.fight;
  const player = fight.player;
  const plan = {
    chance: hitChance(enemy.accuracy, stat(ctx, player, 'evasion', player.evasion), ctx.content),
    damage: enemy.damage,
  };
  const hooks = hooksOf(ctx, enemy);
  for (const hook of hooks) hook.onAttack?.(ctx, enemy, plan);
  if (!rollHit(ctx, player, plan.chance)) {
    note(fight, 'enemy', 'miss', null, 0);
    return;
  }
  const dealt = dealDamage(ctx, player, plan.damage, enemy.id);
  note(fight, 'enemy', 'hit', null, dealt);
  for (const hook of hooks) hook.onAttackHit?.(ctx, enemy, player, dealt);
}

/** A heavy blow that always lands (unless a decoy takes it), for hooks such as the caster's. */
export function heavyBlow(ctx: FightCtx, enemy: Combatant, damage: number): void {
  const player = ctx.fight.player;
  if (!rollHit(ctx, player, null)) {
    note(ctx.fight, 'enemy', 'miss', null, 0);
    return;
  }
  note(ctx.fight, 'enemy', 'hit', null, dealDamage(ctx, player, damage, enemy.id));
}

function tickEffects(ctx: FightCtx, c: Combatant): void {
  const fight = ctx.fight;
  for (const e of c.effects) {
    if (e.kind !== 'periodic') continue;
    while (alive(c) && e.next <= fight.t && (e.until === null || e.next <= e.until)) {
      if (!isSuppressed(c, e.id)) tick(ctx, c, e);
      e.next += e.every;
    }
  }
}

function tick(ctx: FightCtx, c: Combatant, e: PeriodicEffect): void {
  if (e.mode === 'damage') hurt(ctx, c, e.amount, e.src);
  else c.hp = Math.min(c.maxHp, c.hp + e.amount);
}

function expire(fight: FightState, c: Combatant): void {
  if (c.effects.some((e) => e.until !== null && e.until <= fight.t)) {
    c.effects = c.effects.filter((e) => e.until === null || e.until > fight.t);
  }
  if (c.ward > 0 && c.wardUntil !== null && c.wardUntil <= fight.t) {
    c.ward = 0;
    c.wardUntil = null;
  }
}

/** Runs the hook timers of a combatant that have filled, in name order. */
function runTimers(ctx: FightCtx, c: Combatant): void {
  const names = Object.keys(c.timers).sort();
  for (const name of names) {
    for (;;) {
      const timer = c.timers[name];
      if (!timer || timer.progress < timer.need || !alive(ctx.fight.player)) break;
      timer.progress -= timer.need;
      for (const hook of hooksOf(ctx, c)) hook.onTimer?.(ctx, c, name);
      const after = c.timers[name];
      if (after && after.need < 1) throw new Error(`timer ${name} has no size`);
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
      e.timer.need = needOf(e.intervalMs);
      enemyAttack(ctx, e);
    }
    runTimers(ctx, e);
  }
  if (checkResult(fight)) return;

  while (fight.poolAt <= fight.t) {
    fight.poolAt += workOf(K.combat.regenMs);
    // The regeneration numbers are per second; a step of another length scales them.
    const scale = K.combat.regenMs / TICK_MS;
    player.chakra = Math.min(player.maxChakra, player.chakra + fight.kit.chakraRegen * scale);
    player.stamina = Math.min(player.maxStamina, player.stamina + fight.kit.staminaRegen * scale);
  }

  if (player.timer.progress >= player.timer.need) {
    if (player.phase === 'cast') {
      player.timer.progress -= player.timer.need;
      resolveCast(ctx);
      player.phase = 'idle';
    } else if (player.phase === 'recover') {
      player.timer.progress -= player.timer.need;
      player.phase = 'idle';
    }
  }
  if (checkResult(fight)) return;
  if (fight.t >= fight.cap) {
    fight.result = 'timeout';
    return;
  }
  while (player.phase === 'idle' && fight.result === 'ongoing') {
    act(ctx);
    checkResult(fight);
  }
}
