import { NATURE_IDS, NATURE_WHEEL } from '@shinobi/content';
import type { ComboId, ContentDb, Enemy, NatureId, Rank, SkillId, TraitId } from '@shinobi/content';
import { createStream, nextFloatFrom } from '../rng.ts';
import {
  addEffect,
  findEffect,
  isSuppressed,
  isWorking,
  removeEffect,
  speedOf,
  statOf,
} from './fight-effects.ts';
import type {
  Combatant,
  Decision,
  FightRules,
  FightState,
  FightTally,
  FightView,
  KitTechnique,
  PeriodicEffect,
  PlayerKit,
  ReadyTechnique,
  Timer,
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
import { needOf, TICK_MS, WORK_PER_MS, workOf } from './units.ts';

/** Zero-length steps tolerated in a row before the engine declares itself stuck. */
const STALL_LIMIT = 10_000;

const alive = (c: Combatant): boolean => c.hp > 0;

/** Work units in a number of seconds of the balance object. */
const secWork = (seconds: number): number => workOf(secMs(seconds));

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

const count = (record: Record<string, number>, key: string, n = 1): void => {
  record[key] = (record[key] ?? 0) + n;
};

// ---------- creation ----------

function buildKit(snap: PlayerSnapshot, content: ContentDb): PlayerKit {
  const K = content.balance.K;
  const known = new Set(snap.known);
  const techniques: KitTechnique[] = [];
  for (const tech of content.techniques) {
    if (!known.has(tech.id) || tech.rank === null) continue;
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
function natureOf(enemy: Enemy, snap: PlayerSnapshot): NatureId | null {
  if (enemy.nature !== 'wheel') return enemy.nature;
  const first = snap.natures[0];
  if (!first) return null;
  return NATURE_IDS.find((n) => NATURE_WHEEL[n] === first) ?? null;
}

const idleTimer = (): Timer => ({ progress: 0, need: 0 });

function buildEnemies(
  snap: PlayerSnapshot,
  enemy: Enemy,
  content: ContentDb,
  t: number,
): Combatant[] {
  const K = content.balance.K;
  const stats = enemyStats(enemy, content);
  const pack = enemy.traits.includes('pack');
  const bodies = pack ? K.pack.n : 1;
  const maxHp = stats.maxHp * (pack ? K.pack.hp : 1);
  const nature = natureOf(enemy, snap);
  const out: Combatant[] = [];
  for (let i = 0; i < bodies; i++) {
    const c: Combatant = {
      id: `${enemy.id}#${i}`,
      side: 'enemy',
      hp: maxHp,
      maxHp,
      chakra: 0,
      maxChakra: 0,
      stamina: 0,
      maxStamina: 0,
      accuracy: stats.accuracy,
      evasion: stats.evasion,
      damage: stats.damage * (pack ? K.pack.dmg : 1),
      intervalMs: stats.intervalMs,
      nature,
      traits: [...enemy.traits],
      effects: [],
      cd: {},
      phase: 'attack',
      cast: null,
      // Pack members start staggered so they do not all strike at once.
      timer: {
        progress: 0,
        need: Math.round((needOf(stats.intervalMs) * (bodies + i)) / bodies),
      },
      heavy: null,
      illusion: null,
      opening: enemy.traits.includes('hidden'),
    };
    const has = (trait: TraitId) => enemy.traits.includes(trait);
    if (has('armor')) {
      c.effects.push({
        kind: 'modifier',
        id: 'armor',
        src: 'trait:armor',
        until: null,
        stat: 'damageTaken',
        op: 'mul',
        value: 1 - K.trait.armor,
      });
    }
    if (has('evasive')) {
      c.effects.push({
        kind: 'modifier',
        id: 'evasive',
        src: 'trait:evasive',
        until: null,
        stat: 'evasion',
        op: 'mul',
        value: K.trait.evasive,
      });
    }
    if (has('regen')) {
      c.effects.push({
        kind: 'periodic',
        id: 'regen',
        src: 'trait:regen',
        until: null,
        mode: 'heal',
        amount: K.trait.regenPct * maxHp,
        every: workOf(TICK_MS),
        next: t + workOf(TICK_MS),
      });
    }
    if (has('caster')) {
      c.heavy = { phase: 'wait', progress: 0, need: needOf(secMs(K.trait.casterEvery)) };
    }
    if (has('illusionist')) {
      c.illusion = { progress: 0, need: needOf(secMs(K.trait.illusionEvery)) };
    }
    out.push(c);
  }
  return out;
}

/**
 * Starts a fight between the player described by `snap` and one enemy entry, with its own
 * random stream seeded from `seed`. Touches nothing outside the returned state.
 */
export function createFight(
  snap: PlayerSnapshot,
  enemy: Enemy,
  seed: number,
  content: ContentDb,
  _rules: FightRules,
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
    effects: [],
    cd: {},
    phase: 'idle',
    cast: null,
    timer: idleTimer(),
    heavy: null,
    illusion: null,
    opening: false,
  };
  if (enemy.traits.includes('hidden')) {
    player.effects.push({
      kind: 'modifier',
      id: 'hidden',
      src: 'trait:hidden',
      until: secWork(K.trait.hidden),
      stat: 'accuracy',
      op: 'mul',
      value: K.trait.hiddenAcc,
    });
  }
  return {
    t: 0,
    rng: createStream(seed, 'fight'),
    result: 'ongoing',
    enemy: enemy.id,
    player,
    enemies: buildEnemies(snap, enemy, content, 0),
    kit: buildKit(snap, content),
    uses: {},
    poolAt: workOf(K.combat.regenMs),
    tally: emptyTally(),
    log: [],
  };
}

// ---------- time ----------

/** Work units until `timer` is full at `speed`, or null when it never fills. */
function timeTo(timer: Timer, speed: number): number | null {
  if (speed <= 0) return null;
  const rest = timer.need - timer.progress;
  return rest <= 0 ? 0 : Math.ceil(rest / speed);
}

/**
 * Work units until something happens in the fight: a combatant's timer fills, an effect ticks or
 * ends, pools regenerate. Zero when the player is free to act. Null once the fight is decided.
 */
export function fightNextEventIn(fight: FightState): number | null {
  if (fight.result !== 'ongoing') return null;
  const player = fight.player;
  if (player.phase === 'idle') return 0;
  let best = fight.poolAt - fight.t;
  const take = (n: number | null): void => {
    if (n !== null && n < best) best = n;
  };
  const effectsOf = (c: Combatant): void => {
    for (const e of c.effects) {
      if (e.kind === 'periodic' && (e.until === null || e.next <= e.until)) take(e.next - fight.t);
      if (e.until !== null) take(e.until - fight.t);
    }
  };
  take(timeTo(player.timer, speedOf(player)));
  effectsOf(player);
  for (const e of fight.enemies) {
    if (!alive(e)) continue;
    const speed = speedOf(e);
    take(timeTo(e.timer, speed));
    if (e.heavy) take(timeTo(e.heavy, speed));
    if (e.illusion) take(timeTo(e.illusion, speed));
    effectsOf(e);
  }
  return Math.max(0, best);
}

function fill(c: Combatant, dt: number): void {
  const speed = speedOf(c);
  if (speed === 0) return;
  const add = dt * speed;
  if (c.phase !== 'idle') c.timer.progress += add;
  if (c.heavy) c.heavy.progress += add;
  if (c.illusion) c.illusion.progress += add;
}

function step(fight: FightState, dt: number): void {
  if (dt <= 0) return;
  fight.t += dt;
  fight.tally.time = fight.t;
  fill(fight.player, dt);
  for (const e of fight.enemies) if (alive(e)) fill(e, dt);
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
  let left = work;
  let stalled = 0;
  while (fight.result === 'ongoing') {
    const next = fightNextEventIn(fight);
    if (next === null || next > left) {
      step(fight, left);
      return 0;
    }
    stalled = next === 0 ? stalled + 1 : 0;
    if (stalled > STALL_LIMIT) throw new Error('fight made no progress: an event repeats at once');
    step(fight, next);
    left -= next;
    handle(fight, content, rules);
  }
  return left;
}

/** `ongoing`, `victory` (every enemy fell) or `defeat` (the player fell). */
export function fightOutcome(fight: FightState): FightState['result'] {
  return fight.result;
}

/** Fight time so far, in ms. */
export const fightTimeMs = (fight: FightState): number => Math.floor(fight.t / WORK_PER_MS);

// ---------- damage and effects ----------

function roll(fight: FightState, chance: number): boolean {
  return nextFloatFrom(fight.rng) < chance;
}

/** Whether a combo whose rule is met fires: always for its guaranteed technique, else by chance. Counts it. */
function combo(fight: FightState, tech: KitTechnique, id: ComboId): boolean {
  const fires = tech.guaranteedCombo === id || roll(fight, tech.comboChance);
  if (fires) count(fight.tally.combos, id);
  return fires;
}

function checkResult(fight: FightState): boolean {
  if (fight.result !== 'ongoing') return true;
  if (!fight.enemies.some(alive)) fight.result = 'victory';
  else if (!alive(fight.player)) fight.result = 'defeat';
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
 * Takes `amount` of `target`'s health, credited to `src` when the target is an enemy. Returns
 * the health actually taken.
 */
function hurt(fight: FightState, target: Combatant, amount: number, src: string): number {
  if (!alive(target) || !(amount > 0)) return 0;
  const applied = Math.min(amount, target.hp);
  target.hp -= applied;
  if (target.side === 'enemy') {
    count(fight.tally.damage, src, applied);
    if (!alive(target)) fight.tally.kills++;
  } else {
    fight.tally.taken += applied;
  }
  return applied;
}

function cancelCast(target: Combatant, content: ContentDb): void {
  if (target.heavy?.phase !== 'cast') return;
  target.heavy = {
    phase: 'wait',
    progress: 0,
    need: needOf(secMs(content.balance.K.trait.casterEvery)),
  };
}

/** Bind lowers evasion and switches Evasive off; a weaker bind never replaces a stronger one. */
function applyBind(
  fight: FightState,
  target: Combatant,
  evasion: number,
  src: string,
  content: ContentDb,
): void {
  const until = fight.t + secWork(content.balance.K.bind.dur);
  const old = findEffect(target, 'bind');
  const strength = old?.kind === 'modifier' ? Math.min(old.value, evasion) : evasion;
  addEffect(target, {
    kind: 'modifier',
    id: 'bind',
    src,
    until: Math.max(until, old?.until ?? until),
    suppresses: 'evasive',
    stat: 'evasion',
    op: 'mul',
    value: strength,
  });
  count(fight.tally.statuses, 'bind');
}

function applyPoison(fight: FightState, target: Combatant, content: ContentDb): void {
  const K = content.balance.K;
  addEffect(target, {
    kind: 'periodic',
    id: 'poison',
    src: 'trait:poisoner',
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

/** Damage multiplier of habituation after `previous` uses of the technique against this enemy. */
function habituation(previous: number, content: ContentDb): number {
  const K = content.balance.K;
  return 1 - Math.min(K.habituationCap, K.habituation * previous);
}

function lowestHp(enemies: readonly Combatant[]): Combatant | undefined {
  let best: Combatant | undefined;
  for (const e of enemies) if (alive(e) && (!best || e.hp < best.hp)) best = e;
  return best;
}

// ---------- the player's side ----------

function buildView(fight: FightState, content: ContentDb): FightView {
  const player = fight.player;
  const living = fight.enemies.filter(alive);
  const primary = lowestHp(living);
  const ready: ReadyTechnique[] = [];
  for (const tech of fight.kit.techniques) {
    if ((player.cd[tech.id] ?? 0) > fight.t) continue;
    if ((tech.pool === 'chakra' ? player.chakra : player.stamina) < tech.cost) continue;
    const wheel = wheelFactor(tech.skill, primary?.nature ?? null, content);
    const targets = tech.hitsAll ? living.length : 1;
    ready.push({
      tech,
      expected: tech.damage * habituation(fight.uses[tech.id] ?? 0, content) * wheel * targets,
    });
  }
  let castEndsIn: number | null = null;
  let nextCastIn: number | null = null;
  let casterAlive = false;
  for (const e of living) {
    if (!e.heavy) continue;
    casterAlive = true;
    const wait = timeTo(e.heavy, speedOf(e));
    if (wait === null) continue;
    if (e.heavy.phase === 'cast')
      castEndsIn = castEndsIn === null ? wait : Math.min(castEndsIn, wait);
    else nextCastIn = nextCastIn === null ? wait : Math.min(nextCastIn, wait);
  }
  return {
    t: fight.t,
    player,
    enemies: living,
    ready,
    castEndsIn,
    nextCastIn,
    casterAlive,
    hidden: findEffect(player, 'hidden') !== undefined,
    illusion: findEffect(player, 'illusion') !== undefined,
    poisoned: findEffect(player, 'poison') !== undefined,
    evasive: living.some((e) => isWorking(e, 'evasive')),
    armored: living.some((e) => isWorking(e, 'armor')),
    regenUnchecked: living.some((e) => isWorking(e, 'regen')),
  };
}

function act(fight: FightState, content: ContentDb, rules: FightRules): void {
  const view = buildView(fight, content);
  const decision: Decision = rules.combatAi(view);
  const chosen =
    decision.kind === 'technique'
      ? view.ready.find((r) => r.tech.id === decision.id)?.tech
      : undefined;
  if (chosen) startCast(fight, chosen);
  else basicAttack(fight, content);
}

function startCast(fight: FightState, tech: KitTechnique): void {
  const player = fight.player;
  if (tech.pool === 'chakra') player.chakra -= tech.cost;
  else player.stamina -= tech.cost;
  player.phase = 'cast';
  player.cast = tech.id;
  player.timer.need = needOf(tech.castMs);
  // Mastery is paid for the fight time since the previous technique use (or the fight's start).
  count(fight.tally.masteryWork, tech.id, fight.t - fight.tally.lastUseAt);
  fight.tally.lastUseAt = fight.t;
  fight.tally.style = tech.skill;
  note(fight, 'player', 'cast', tech.id, 0);
}

function basicAttack(fight: FightState, content: ContentDb): void {
  const player = fight.player;
  player.phase = 'recover';
  player.timer.need = needOf(player.intervalMs);
  fight.tally.style = 'tai';
  fight.tally.basic++;
  const target = lowestHp(fight.enemies);
  if (!target) return;
  const chance = hitChance(
    statOf(player, 'accuracy', player.accuracy),
    statOf(target, 'evasion', target.evasion),
    content,
  );
  if (roll(fight, chance)) {
    const dealt = hurt(fight, target, player.damage * statOf(target, 'damageTaken', 1), 'basic');
    note(fight, 'player', 'hit', null, dealt);
  } else note(fight, 'player', 'miss', null, 0);
}

function resolveCast(fight: FightState, content: ContentDb): void {
  const player = fight.player;
  const tech = fight.kit.techniques.find((t) => t.id === player.cast);
  player.cast = null;
  if (!tech) return;
  player.cd[tech.id] = fight.t + workOf(tech.cooldownMs);
  const previous = fight.uses[tech.id] ?? 0;
  fight.uses[tech.id] = previous + 1;
  count(fight.tally.uses, tech.id);
  const hab = habituation(previous, content);
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
  const first = lowestHp(fight.enemies);
  const targets = tech.hitsAll ? fight.enemies.filter(alive) : first ? [first] : [];
  for (const target of targets) {
    const chance = hitChance(
      statOf(player, 'accuracy', tech.accuracy),
      statOf(target, 'evasion', target.evasion),
      content,
    );
    if (roll(fight, chance)) {
      const dealt = applyHit(fight, tech, target, hab, content);
      note(fight, 'player', 'hit', tech.id, dealt);
    } else note(fight, 'player', 'miss', tech.id, 0);
  }
}

/** What one technique does to one enemy it hit: tags, damage, status, then combos. Returns the direct damage dealt. */
function applyHit(
  fight: FightState,
  tech: KitTechnique,
  target: Combatant,
  hab: number,
  content: ContentDb,
): number {
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
  if (tech.tags.includes('bind')) applyBind(fight, target, K.bindEva, tech.id, content);
  if (tech.tags.includes('interrupt') && target.heavy?.phase === 'cast') {
    cancelCast(target, content);
    fight.tally.interrupts++;
  }
  const base = tech.damage * hab * wheelFactor(tech.skill, target.nature, content);
  const dealt = hurt(fight, target, base * statOf(target, 'damageTaken', 1), tech.id);
  if (!alive(target)) return dealt;

  if (tech.state === 'burn') {
    addEffect(target, {
      kind: 'periodic',
      id: 'burn',
      src: tech.id,
      until: now + secWork(K.burn.dur),
      suppresses: 'regen',
      mode: 'damage',
      amount: (K.burn.share * base) / K.burn.dur,
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
    cancelCast(target, content);
    count(fight.tally.statuses, 'stun');
  }

  if (tech.skill === 'futon' && burnBefore?.kind === 'periodic') {
    if (combo(fight, tech, 'fanBurn')) {
      burnBefore.amount *= K.combo.fanBurn;
      burnBefore.until = now + secWork(K.burn.dur);
    }
  }
  if (tech.skill === 'doton' && wetBefore && combo(fight, tech, 'mudEva')) {
    applyBind(fight, target, K.combo.mudEva, tech.id, content);
  }
  if (tech.skill === 'katon' && wetBefore && combo(fight, tech, 'steam')) {
    removeEffect(target, 'wet');
    hurt(fight, target, K.combo.steam * base * statOf(target, 'damageTaken', 1), tech.id);
  }
  return dealt;
}

// ---------- the enemies' side and the clock's ----------

function enemyAttack(fight: FightState, enemy: Combatant, content: ContentDb): void {
  const K = content.balance.K;
  const player = fight.player;
  let chance = hitChance(enemy.accuracy, statOf(player, 'evasion', player.evasion), content);
  let damage = enemy.damage;
  if (enemy.opening) {
    enemy.opening = false;
    // A hidden enemy's opening blow, while the player has not yet found it, is stronger and sure.
    if (findEffect(player, 'hidden')) {
      damage *= K.trait.hiddenFirst;
      chance = K.hitMax;
    }
  }
  if (!roll(fight, chance)) {
    note(fight, 'enemy', 'miss', null, 0);
    return;
  }
  note(fight, 'enemy', 'hit', null, hurt(fight, player, damage, enemy.id));
  if (enemy.traits.includes('poisoner') && alive(player) && roll(fight, K.trait.poisonChance)) {
    applyPoison(fight, player, content);
  }
}

function tickEffects(fight: FightState, c: Combatant): void {
  for (const e of c.effects) {
    if (e.kind !== 'periodic') continue;
    while (alive(c) && e.next <= fight.t && (e.until === null || e.next <= e.until)) {
      if (!isSuppressed(c, e.id)) tick(fight, c, e);
      e.next += e.every;
    }
  }
}

function tick(fight: FightState, c: Combatant, e: PeriodicEffect): void {
  if (e.mode === 'damage') hurt(fight, c, e.amount, e.src);
  else c.hp = Math.min(c.maxHp, c.hp + e.amount);
}

function expire(fight: FightState, c: Combatant): void {
  if (c.effects.some((e) => e.until !== null && e.until <= fight.t)) {
    c.effects = c.effects.filter((e) => e.until === null || e.until > fight.t);
  }
}

/** Handles everything that is due at the fight clock, in a fixed order. */
function handle(fight: FightState, content: ContentDb, rules: FightRules): void {
  const K = content.balance.K;
  const player = fight.player;

  tickEffects(fight, player);
  for (const e of fight.enemies) tickEffects(fight, e);
  if (checkResult(fight)) return;
  expire(fight, player);
  for (const e of fight.enemies) if (alive(e)) expire(fight, e);

  for (const e of fight.enemies) {
    if (!alive(e)) continue;
    while (e.timer.progress >= e.timer.need && alive(player)) {
      e.timer.progress -= e.timer.need;
      e.timer.need = needOf(e.intervalMs);
      enemyAttack(fight, e, content);
    }
    while (e.heavy && e.heavy.progress >= e.heavy.need && alive(player)) {
      const carry = e.heavy.progress - e.heavy.need;
      if (e.heavy.phase === 'wait') {
        e.heavy = { phase: 'cast', progress: carry, need: needOf(secMs(K.trait.casterCast)) };
      } else {
        note(fight, 'enemy', 'hit', null, hurt(fight, player, e.damage * K.trait.casterMult, e.id));
        e.heavy = { phase: 'wait', progress: carry, need: needOf(secMs(K.trait.casterEvery)) };
      }
    }
    while (e.illusion && e.illusion.progress >= e.illusion.need) {
      e.illusion.progress -= e.illusion.need;
      // Meditation resists the illusion: `illusionResist` per level.
      if (roll(fight, fight.kit.med * K.illusionResist)) continue;
      addEffect(player, {
        kind: 'modifier',
        id: 'illusion',
        src: 'trait:illusionist',
        until: fight.t + secWork(K.trait.illusionDur),
        stat: 'accuracy',
        op: 'mul',
        value: K.trait.illusionAcc,
      });
      count(fight.tally.statuses, 'illusion');
    }
  }
  if (checkResult(fight)) return;

  while (fight.poolAt <= fight.t) {
    fight.poolAt += workOf(K.combat.regenMs);
    player.chakra = Math.min(player.maxChakra, player.chakra + fight.kit.chakraRegen);
    player.stamina = Math.min(player.maxStamina, player.stamina + fight.kit.staminaRegen);
  }

  if (player.timer.progress >= player.timer.need) {
    if (player.phase === 'cast') {
      player.timer.progress -= player.timer.need;
      resolveCast(fight, content);
      player.phase = 'idle';
    } else if (player.phase === 'recover') {
      player.timer.progress -= player.timer.need;
      player.phase = 'idle';
    }
  }
  if (checkResult(fight)) return;
  while (player.phase === 'idle' && fight.result === 'ongoing') {
    act(fight, content, rules);
    checkResult(fight);
  }
}
