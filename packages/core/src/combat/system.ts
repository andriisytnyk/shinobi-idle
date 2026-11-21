import {
  FIRST_FIGHT_FLAG,
  type Boss,
  type ContentDb,
  type Enemy,
  type Operation,
} from '@shinobi/content';
import { stopSlot } from '../actions.ts';
import { chakraDivisor } from '../clone.ts';
import { actingBody, allFights, asPerformer, fightOf } from '../performer.ts';
import { bump, defeatsKey, killsKey } from '../counters.ts';
import { emit } from '../events.ts';
import { MS_PER_HOUR, MS_PER_SECOND, masteryLevel, masteryXpPerSecond, rate } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { raidPackFell } from '../raid.ts';
import { nextInt, nextSeed } from '../rng.ts';
import type { Rules } from '../rules.ts';
import { SHARE_FULL, type GameState } from '../state.ts';
import type { System } from '../system.ts';
import { encounterFor } from './fight-encounter.ts';
import { bossNature } from '../natures.ts';
import { noteBounty, noteFight, noteSighting } from './bingo.ts';
import { dropPending, earnMastery, earnXp, payPending } from './pending.ts';
import { addFatigue, fatigueFor } from '../clone-life.ts';
import { grantLoot, rollLoot } from './loot.ts';
import { recordFight, recordItems, recordLoot, recordWounds, stampDefeat } from './report.ts';
import { payOperation } from './rewards.ts';
import type { TeamSupport } from './fight-types.ts';
import {
  createFight,
  fightAdvance,
  fightNextEventIn,
  fightOutcome,
  makeCtx,
  releaseAllies,
} from './fight.ts';
import { CHAKRA_DIVISOR_KEY, secMs } from './numbers.ts';
import { ensurePouch, refillPouch, syncPouch } from './pouch.ts';
import { snapshotPlayer } from './snapshot.ts';
import { keepPerformerHp, performerHp, setPerformerHp } from './vitality.ts';
import type { CombatState, RunState } from './types.ts';
import { WORK_PER_MS, workOf } from './units.ts';
import { addWounds, shortenWounds } from './wounds.ts';
import { approachMs, entryOf, opSteps, type OpStep } from './zones.ts';

/** Names of the action kinds that occupy a slot while a fight runs. */
export const FIGHT_KIND = 'fight';
export const OPERATION_KIND = 'operation';

/** Whether an action kind is one the combat system drives. */
export const isCombatKind = (kind: string): boolean =>
  kind === FIGHT_KIND || kind === OPERATION_KIND;

/** The action kind of a mission; its slot holds a fight only while one of its combat stages runs. */
export const MISSION_KIND = 'mission';

/** The slot's work units for `ms` of game time. Fights run on work units, like action progress. */
export const combatUnits = (ms: number): number => workOf(ms);

/** Whether the performer of `slot` runs an action that can hold a fight: a fight, an operation, a mission. */
export function holdsFight(state: GameState, slot: number): boolean {
  const kind = state.slots[slot]?.action?.kind;
  return kind !== undefined && (isCombatKind(kind) || kind === MISSION_KIND);
}

/**
 * Index of the slot of `slot`'s performer when it runs a fight or an operation (or a mission stage that
 * fights), or -1. Every performer has its own fight: the character's is `state.combat`, a clone's is its own.
 */
export function fightSlotIndex(state: GameState, slot = 0): number {
  return fightOf(state, slot) !== null && holdsFight(state, slot) ? slot : -1;
}

type Pools = { hp: number; chakra: number; stamina: number };

/**
 * Starts a fight against `entry` from the player's current state. `pools` carries health and
 * pools over from the previous fight; without it the player starts full. The entry counts as
 * seen from here on.
 */
function startFight(
  state: GameState,
  entry: Enemy | Boss,
  content: ContentDb,
  rules: Rules,
  pools?: Pools,
  support: readonly TeamSupport[] = [],
): CombatState['fight'] {
  noteSighting(state, entry.id, content);
  // Health is the performer's own state (it carries over); the pools of the previous fight, when there is one, only add chakra and stamina.
  const snapshot = snapshotPlayer(
    state,
    content,
    rules,
    pools ? { ...pools, hp: performerHp(state) } : undefined,
    [entry.id],
  );
  // The fight gets its own seed from the game's combat stream and runs on a stream of its own.
  return createFight(
    snapshot,
    encounterFor(entry, content, [], 'special' in entry ? bossNature(state, entry) : null, support),
    nextSeed(state.rng, 'combat'),
    content,
    rules,
  );
}

function blank(
  entry: Enemy | Boss,
  fight: CombatState['fight'],
  run: RunState | null,
  owner: number,
): CombatState {
  return {
    enemy: entry.id,
    phase: 'fight',
    fight,
    work: 0,
    pause: 0,
    paid: {},
    carry: 0,
    style: fight.tally.style,
    owner,
    run,
  };
}

/** A zone fight that has just begun: full pools and the health the performer has. */
export function newCombat(
  state: GameState,
  entry: Enemy | Boss,
  content: ContentDb,
  rules: Rules,
  owner: number,
): CombatState {
  return blank(entry, startFight(state, entry, content, rules), null, owner);
}

/** A fight of a mission's combat stage: full pools, the health the performer has, the current loadout and pouch (no refill), and the teammates' support. */
export function newMissionCombat(
  state: GameState,
  entry: Enemy | Boss,
  support: readonly TeamSupport[],
  content: ContentDb,
  rules: Rules,
  owner: number,
): CombatState {
  state.flags[FIRST_FIGHT_FLAG] = true;
  // The pouch is topped up from the bank on the way into the fight, as for any fight.
  ensurePouch(state, content);
  refillPouch(state, content);
  const fight = startFight(state, entry, content, rules, undefined, support);
  // A mission has no combat tick: the bodies of the character's side earn by the clock at the rate a fight's tick pays.
  fight.allyXpRate = rate(entry.cl, content) / MS_PER_HOUR / WORK_PER_MS;
  return blank(entry, fight, null, owner);
}

/** The enemy of an operation step; a step that draws from a pool draws on the combat stream. */
function enemyOfStep(state: GameState, step: OpStep | undefined): string | null {
  if (!step || step.t === 'approach') return null;
  if (step.t === 'fight') return step.enemy;
  return step.pool[nextInt(state.rng, 'combat', step.pool.length)] ?? null;
}

/**
 * The first moment of an operation run: the approach (if it has one) and the first fight, prepared at full pools.
 * `resume` starts the fight of that step instead, with no approach: the run of a save whose fight could not be
 * carried over goes on from the step it was at.
 */
export function newOperation(
  state: GameState,
  op: Operation,
  content: ContentDb,
  rules: Rules,
  owner: number,
  resume?: number,
): CombatState | null {
  const steps = opSteps(op);
  const resumed =
    resume !== undefined && steps[resume] !== undefined && steps[resume].t !== 'approach';
  const approach = !resumed && steps[0]?.t === 'approach';
  const at = resumed ? resume : approach ? 1 : 0;
  const enemy = enemyOfStep(state, steps[at]);
  const entry = enemy ? entryOf(content, enemy) : undefined;
  if (!entry) return null;
  const c = blank(entry, startFight(state, entry, content, rules), { op: op.id, step: at }, owner);
  if (approach) {
    c.phase = 'approach';
    c.pause = workOf(approachMs(state, op, content));
  }
  return c;
}

/**
 * What the allies that have left the fight (fallen, dispelled, or the fight's end) earned by their own actions goes to the
 * character, once: combat XP by the skill of the style each body had, and Mastery for the techniques it cast. The numbers
 * (`xpShare`, `passShare`, `fatigueShare` of the `K.techFx` row of the technique that summoned the body) were applied when
 * the body handed its earnings to the tally (`releaseAlly`), so what is paid here is what passes on.
 */
function payAllies(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
  clone: boolean,
): void {
  const tally = c.fight.tally;
  const xp = tally.allyXp;
  const work = tally.allyWork;
  const tire = tally.allyTire;
  delete tally.allyXp;
  delete tally.allyWork;
  delete tally.allyTire;
  for (const [skill, amount] of Object.entries(xp ?? {})) {
    earnXp(state, skill, amount, content, rules);
  }
  // The knowledge that reaches the character tires the mind as a clone does (a clone's fight keeps it for its dispel, which tires then).
  if (!clone) {
    const ms = fatigueFor(state, tire ?? {}, content);
    if (ms > 0) addFatigue(state, ms, content);
  }
  for (const [id, units] of Object.entries(work ?? {})) {
    const tech = indexOf(content).techniques.get(id);
    if (!tech || !(units > 0)) continue;
    earnMastery(
      state,
      c,
      clone,
      id,
      tech.skill,
      (masteryXpPerSecond(masteryLevel(state, id, content), content) * units) /
        WORK_PER_MS /
        MS_PER_SECOND,
      content,
      rules,
    );
  }
}

/**
 * A fight is dropped without its normal end (the action stops, a clone is dispelled): the allies that still stand are
 * released and what they hold is paid, once, by the same route as at the end of a fight. In a clone's fight it goes to
 * the clone's pending knowledge, which the stop then pays. Call it before the fight is discarded.
 */
export function releaseFight(
  state: GameState,
  slot: number,
  content: ContentDb,
  rules: Rules,
): void {
  const c = state.combat;
  if (c?.owner !== slot) return;
  releaseAllies(makeCtx(c.fight, content, rules));
  payAllies(state, c, content, rules, slot > 0);
}

/**
 * What `releaseFight` would pay for the allies of the fight in `c` (the XP and the Mastery the standing bodies hold
 * or have earned by the clock, plus what the tally holds for bodies that already left), computed on a copy: the fight
 * is left as it is. The amounts are those that reach the character's pending knowledge, before the modifiers.
 */
export function previewAllyEarnings(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
): { xp: Record<string, number>; mastery: Record<string, { skill: string; amount: number }> } {
  // A fight is plain data (it is saved as JSON), so a round trip is a deep copy.
  const copy = JSON.parse(JSON.stringify(c.fight)) as typeof c.fight;
  releaseAllies(makeCtx(copy, content, rules));
  const xp = { ...copy.tally.allyXp };
  const mastery: Record<string, { skill: string; amount: number }> = {};
  for (const [id, units] of Object.entries(copy.tally.allyWork ?? {})) {
    const tech = indexOf(content).techniques.get(id);
    if (!tech || !(units > 0)) continue;
    mastery[id] = {
      skill: tech.skill,
      amount:
        (masteryXpPerSecond(masteryLevel(state, id, content), content) * units) /
        WORK_PER_MS /
        MS_PER_SECOND,
    };
  }
  return { xp, mastery };
}

/** Pays mastery XP for the technique time the fight has tallied since the last payment. */
function settle(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
  clone: boolean,
): void {
  const K = content.balance.K;
  const tally = c.fight.tally;
  c.style = tally.style;
  payAllies(state, c, content, rules, clone);
  for (const [id, work] of Object.entries(tally.masteryWork)) {
    const due = work - (c.paid[id] ?? 0);
    const tech = indexOf(content).techniques.get(id);
    if (!tech || (due <= 0 && c.carry <= 0)) continue;
    c.paid[id] = work;
    const paying = Math.max(0, due) + c.carry;
    c.carry = 0;
    // The signature technique learns a little faster.
    const bonus = state.loadouts.signature === id ? 1 + K.signature.xpBonus : 1;
    earnMastery(
      state,
      c,
      clone,
      id,
      tech.skill,
      (bonus * masteryXpPerSecond(masteryLevel(state, id, content), content) * paying) /
        WORK_PER_MS /
        MS_PER_SECOND,
      content,
      rules,
    );
  }
}

/** Hands the fight's battle log lines to the event queue, emptying the fight's own. */
function report(state: GameState, c: CombatState): void {
  const lines = c.fight.log;
  if (!lines) return;
  for (const line of lines.splice(0))
    emit(state, { type: 'combatLog', enemy: c.enemy, slot: c.owner, ...line });
}

/**
 * The Wounds a finished fight costs: the stances it used, losing, and falling low in a won fight;
 * items then shorten the healing. A clone's body is not the player's: its defeat and its near
 * defeat cost no Wound (the price of a stance the clone chose still counts).
 */
function woundsAfter(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
  lost: boolean,
  key: string,
  clone: boolean,
): void {
  const tally = c.fight.tally;
  const low = c.fight.player.data.low === 1 && !lost && !clone ? 1 : 0;
  const n = (lost && !clone ? 1 : 0) + low + tally.wounds;
  addWounds(state, n, content, rules);
  recordWounds(state, key, n);
  if (tally.woundMin > 0) shortenWounds(state, tally.woundMin, content);
}

/** The id the battle report of the running fight is filed under: the zone, enemy or operation the slot holds. */
function reportKey(state: GameState, index: number): string {
  return state.slots[index]?.action?.id ?? '';
}

/** Copies the fight's pouch to the state and returns the units it used since the last copy. */
function syncAndCount(state: GameState, c: CombatState): Record<string, number> {
  const before = state.pouch.slots.map((s) => s.n);
  syncPouch(state, c.fight);
  const used: Record<string, number> = {};
  state.pouch.slots.forEach((s, i) => {
    const spent = (before[i] ?? 0) - s.n;
    if (spent > 0 && s.id !== '') used[s.id] = (used[s.id] ?? 0) + spent;
  });
  return used;
}

/** The player recovers a share of health and both pools. */
function recover(player: CombatState['fight']['player'], share: number): void {
  player.hp = Math.min(player.maxHp, player.hp + share * player.maxHp);
  player.chakra = Math.min(player.maxChakra, player.chakra + share * player.maxChakra);
  player.stamina = Math.min(player.maxStamina, player.stamina + share * player.maxStamina);
}

/** An operation was finished: its first-clear flag is raised and the event the rewards will hang on is sent. */
function cleared(state: GameState, op: Operation, content: ContentDb): void {
  const first = state.flags[op.clearFlag] === undefined;
  state.flags[op.clearFlag] = true;
  bump(state, `ops.${op.id}`);
  emit(state, { type: 'operationCleared', op: op.id, first });
  payOperation(state, op, first, content);
}

/**
 * An enemy fell: count it, pay the Wounds, and let the player recover. In a zone the player
 * regains health, pools and the pouch before the same enemy comes again; in an operation only a
 * share, the pouch is not refilled and the next step's enemy comes. Returns true when the
 * operation is over.
 */
function victory(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
  key: string,
  clone: boolean,
): boolean {
  const K = content.balance.K;
  const player = c.fight.player;
  c.phase = 'respawn';
  c.pause = workOf(secMs(K.respawn));
  // The time since the last technique use and the pause are paid with the next fight's first one.
  c.carry += c.fight.t - c.fight.tally.lastUseAt + c.pause;
  // A clone's fight pays when it is won.
  payPending(state, c, content, rules);
  bump(state, killsKey(c.enemy));
  emit(state, { type: 'enemyDefeated', enemy: c.enemy, slot: c.owner });
  // Loot is rolled before the book counts the win, so the first win pays the full bounty. A
  // fight that ended with an enemy leaving counts as won.
  const fallen = entryOf(content, c.enemy);
  if (fallen) {
    const loot = rollLoot(state, fallen);
    grantLoot(state, c.enemy, loot, content);
    recordLoot(state, key, loot);
    noteBounty(state, c.enemy, loot.bounty);
  }
  noteFight(state, c.enemy, 'win', content);
  recordFight(state, key, c.fight, 'win', content, clone);
  woundsAfter(state, c, content, rules, false, key, clone);
  if (!c.run) {
    // Health carries over to the next fight (regeneration and food restore it); `zoneHpRegen` is a lump heal knob, 0 in the data.
    // A training enemy (by its region) also puts the health back: a new character is not worn down by the dummy.
    const region = fallen !== undefined && 'region' in fallen ? fallen.region : '';
    const heal = K.zoneHpRegen + (K.regionHeal[region] ?? 0);
    player.hp = Math.min(player.maxHp, player.hp + heal * player.maxHp);
    setPerformerHp(state, player.hp, content);
    player.chakra = player.maxChakra;
    player.stamina = player.maxStamina;
    refillPouch(state, content);
    // A pack of a raid at the village gates counts for the defence; the last one ends the raid and the fight with it.
    return raidPackFell(state, key, content);
  }
  const op = indexOf(content).operations.get(c.run.op);
  if (!op) return true;
  recover(player, K[op.regen]);
  setPerformerHp(state, player.hp, content);
  c.run.step++;
  const next = enemyOfStep(state, opSteps(op)[c.run.step]);
  if (next === null) {
    cleared(state, op, content);
    return true;
  }
  c.enemy = next;
  return false;
}

/**
 * A lost fight. The player's defeat is counted (event, counter, Bingo book, Wound); a clone's is
 * not: it is marked in the event and in the battle report and costs the player nothing.
 */
function lose(
  state: GameState,
  c: CombatState,
  key: string,
  content: ContentDb,
  rules: Rules,
  clone: boolean,
): void {
  // What a clone's lost fight earned is dropped: a lost fight pays nothing.
  dropPending(c);
  emit(state, {
    type: 'playerDefeated',
    enemy: c.enemy,
    slot: c.owner,
    ...(clone ? { clone: true } : {}),
  });
  if (!clone) {
    bump(state, defeatsKey(c.enemy));
    noteFight(state, c.enemy, 'loss', content);
  }
  recordFight(state, key, c.fight, 'loss', content, clone);
  stampDefeat(state, key);
  woundsAfter(state, c, content, rules, true, key, clone);
  // The character does not go on at nothing: it wakes with a share of the maximum health.
  const body = c.fight.player;
  body.hp = Math.max(body.hp, content.balance.K.defeatHp * body.maxHp);
  setPerformerHp(state, body.hp, content);
}

/**
 * The chakra pool of the fight in progress follows the clones that exist (the character's pool
 * divided by `n + 1`): the maximum changes at once, the chakra the performer has now is kept,
 * cut only to a smaller maximum.
 */
export function followChakraPool(state: GameState, content: ContentDb): void {
  const c = state.combat;
  if (!c) return;
  const player = c.fight.player;
  // The body remembers what its pool was divided by; the pool is scaled from that to the divisor now.
  // A saved divisor is trusted no further than a sane range: a doctored save cannot zero or negate the pool.
  const saved = player.data[CHAKRA_DIVISOR_KEY];
  const had =
    typeof saved === 'number' && Number.isFinite(saved)
      ? Math.min(Math.max(1, Math.floor(saved)), Math.max(1, state.slots.length))
      : 1;
  // One slot, no clone: nothing to follow (the common case, kept cheap).
  if (had === 1 && state.slots.length < 2) return;
  const now = chakraDivisor(state, content);
  if (had === now) return;
  player.maxChakra = (player.maxChakra * had) / now;
  player.chakra = Math.min(player.chakra, player.maxChakra);
  if (now > 1) player.data[CHAKRA_DIVISOR_KEY] = now;
  else delete player.data[CHAKRA_DIVISOR_KEY];
}

/**
 * Real-time combat. A fight runs at full speed whoever fights (the clone's slot share does not
 * slow it); the fight engine spends the work on its own clock, so the system only wakes at the
 * fight's next event or the end of the pause.
 */
export const combatSystem: System = {
  nextEventIn(state, content, rules) {
    let best: number | null = null;
    for (const { slot: index, fight: c } of allFights(state)) {
      const slot = state.slots[index];
      if (!slot || !holdsFight(state, index) || slot.share <= 0) continue;
      const wait = c.phase === 'fight' ? fightNextEventIn(c.fight, content, rules) : c.pause;
      const left = wait === null ? 0 : Math.max(0, Math.ceil((wait - c.work) / SHARE_FULL));
      if (best === null || left < best) best = left;
    }
    return best;
  },

  elapse(state, dt) {
    for (const { slot: index, fight: c } of allFights(state)) {
      if (state.slots[index] && holdsFight(state, index)) c.work += dt * SHARE_FULL;
    }
  },

  run(state, content, rules) {
    // Every performer fights its own fight; each is run as its performer (its bag, pouch and knowledge).
    for (const { slot } of allFights(state)) {
      asPerformer(state, slot, () => runFight(state, slot, content, rules));
    }
  },
};

/** Runs the fight of the performer of slot `index` (the state holds it as `state.combat` for the time). */
function runFight(state: GameState, index: number, content: ContentDb, rules: Rules): void {
  {
    const c = state.combat;
    if (!c) return;
    if (!holdsFight(state, index)) {
      releaseFight(state, index, content, rules);
      state.combat = null;
      return;
    }
    const clone = index > 0;
    followChakraPool(state, content);
    for (;;) {
      const entry = entryOf(content, c.enemy);
      if (!entry) return stopSlot(state, index, 'missing', content, rules);
      if (c.phase !== 'fight') {
        if (c.work < c.pause) {
          c.pause -= c.work;
          c.work = 0;
          return;
        }
        c.work -= c.pause;
        c.pause = 0;
        // After an approach the fight is already prepared; after a win the next one begins.
        if (c.phase === 'respawn') {
          const p = c.fight.player;
          c.fight = startFight(state, entry, content, rules, {
            hp: p.hp,
            chakra: p.chakra,
            stamina: p.stamina,
          });
          c.paid = {};
        } else {
          // An approach: the fight was prepared before it, and the health has regenerated on the way.
          const p = c.fight.player;
          p.hp = Math.min(p.maxHp, performerHp(state));
        }
        c.phase = 'fight';
      }
      c.work = fightAdvance(c.fight, c.work, content, rules);
      // The state keeps the health the fight has, so that whatever ends the fight leaves it where it is.
      keepPerformerHp(state, c.fight.player.hp);
      settle(state, c, content, rules, clone);
      const key = reportKey(state, index);
      recordItems(state, key, syncAndCount(state, c));
      report(state, c);
      const result = fightOutcome(c.fight);
      if (result === 'ongoing') return;
      if (result === 'void') {
        // A hook of a pack failed: no win, no loss, no loot, no Wound. A new fight starts at once, without the hook.
        emit(state, {
          type: 'ruleDisabled',
          pack: c.fight.fault?.pack ?? '',
          rule: `fightHook.${c.fight.fault?.hook ?? ''}`,
          reason: c.fight.fault?.reason ?? '',
        });
        c.carry += c.fight.t - c.fight.tally.lastUseAt;
        payPending(state, c, content, rules);
        const p = c.fight.player;
        const allyXpRate = c.fight.allyXpRate;
        c.fight = startFight(
          state,
          entry,
          content,
          rules,
          { hp: p.hp, chakra: p.chakra, stamina: p.stamina },
          c.fight.encounter.support,
        );
        // A mission's bodies keep earning by the clock in the fight that replaces this one.
        if (allyXpRate !== undefined) c.fight.allyXpRate = allyXpRate;
        c.paid = {};
        continue;
      }
      if (result === 'timeout') {
        // A fight that ran out of time pays nothing and costs nothing: a new one starts at once.
        noteFight(state, c.enemy, 'timeout', content);
        recordFight(state, key, c.fight, 'timeout', content, clone);
        c.carry += c.fight.t - c.fight.tally.lastUseAt;
        payPending(state, c, content, rules);
        const p = c.fight.player;
        const allyXpRate = c.fight.allyXpRate;
        c.fight = startFight(
          state,
          entry,
          content,
          rules,
          { hp: p.hp, chakra: p.chakra, stamina: p.stamina },
          c.fight.encounter.support,
        );
        // A mission's bodies keep earning by the clock in the fight that replaces this one.
        if (allyXpRate !== undefined) c.fight.allyXpRate = allyXpRate;
        c.paid = {};
        continue;
      }
      const owner = rules.actionKinds[state.slots[index]?.action?.kind ?? ''];
      if (owner?.combatEnded) {
        // The action that started the fight decides what follows (a mission's combat stage).
        if (result === 'defeat') {
          lose(state, c, key, content, rules, clone);
          // A clone that fell is dispelled whatever its action is: the mission does not start the stage again.
          if (clone) return doom(state, index);
        } else {
          bump(state, killsKey(c.enemy));
          emit(state, { type: 'enemyDefeated', enemy: c.enemy, slot: c.owner });
          // A mission pays its own rewards; the book and the report still count the fight.
          noteFight(state, c.enemy, 'win', content);
          recordFight(state, key, c.fight, 'win', content, clone);
          woundsAfter(state, c, content, rules, false, key, clone);
          payPending(state, c, content, rules);
        }
        return owner.combatEnded(
          state,
          index,
          result === 'defeat' ? 'defeat' : 'victory',
          content,
          rules,
        );
      }
      if (result === 'defeat') {
        lose(state, c, key, content, rules, clone);
        // A clone that fell is dispelled, with no new try: what it knew returns except what the lost fight earned.
        if (clone) return doom(state, index);
        // A defeat ends an operation run with the action: nothing of it is kept.
        return stopSlot(state, index, 'defeated', content, rules);
      }
      if (victory(state, c, content, rules, key, clone))
        return stopSlot(state, index, 'finished', content, rules);
    }
  }
}

/** The clone of the performer being computed fell: it is dispelled at the end of this moment (`cloneSystem`). */
function doom(state: GameState, index: number): void {
  const body = actingBody(state) ?? state.clones[index];
  if (body) body.doomed = 'death';
}
