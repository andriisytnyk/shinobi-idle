import type { ContentDb } from '@shinobi/content';
import {
  alliesOf,
  combatantStatus,
  fightSlotIndex,
  SHARE_FULL,
  WORK_PER_MS,
  type Combatant,
  type CombatantStatus,
  type FightAct,
  type GameState,
  type Rules,
} from '@shinobi/core';
import { IDLE_TIMING, MIN_SEAL_MS, type PracticePhases, type PracticeView } from './timing.ts';
import type { ProgressTiming } from './time-progress.ts';

/*
 * What the fight screen draws, worked out from the state: for every body what it is doing, how far
 * the action has got (as the timing the shared progress primitive animates), the statuses it
 * carries with the time they have left, and how its last action ended. It reads the fight; it
 * changes nothing, and it prints no text: the components choose the words.
 */

/** How long, in fight milliseconds, the outcome of an action stays on its target as a flying figure. */
export const OUTCOME_SHOWN_MS = 1500;

/** A status on a body with the time it has left; `null` while it lasts the whole fight. */
export interface StatusView {
  /** The id of the status of the content the effect belongs to. */
  id: string;
  remainingMs: number | null;
  stacks: number;
}

/** How a body's last action ended, and how long ago (fight milliseconds). */
export interface LastView {
  kind: FightAct['kind'];
  id: string | null;
  outcome: 'hit' | 'miss' | 'interrupted' | 'none';
  damage: number;
  statuses: readonly string[];
  combos: readonly string[];
  avoidedBy: string | null;
  atMs: number;
  ageMs: number;
}

export interface FighterView {
  /** The id of the body in the fight. */
  key: string;
  side: 'player' | 'enemy';
  /** The content id of the enemy or boss the body came from; null for the player and for an ally. */
  entry: string | null;
  /** For an ally of the player's side (a combat clone): its number in the fight; null for every other body. */
  ally: number | null;
  /** Which body of its kind this is (1-based) and how many the fight has of that kind. */
  nth: number;
  of: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  chakra: number;
  maxChakra: number;
  stamina: number;
  maxStamina: number;
  phase: 'wait' | 'act' | 'rest';
  /** The status (or `hook`) that stops the clock of the phase; null while it runs. */
  heldBy: string | null;
  action: FightAct | null;
  /** The progress of the phase: a wait, a cast, a strike, a rest. */
  timing: ProgressTiming;
  /** The seals of the technique being cast, in order; empty for any other action. */
  seals: readonly string[];
  /** The cast as the seal strip draws it; null when no technique is being cast. */
  cast: PracticeView | null;
  statuses: readonly StatusView[];
  last: LastView | null;
}

export interface Scene {
  /** The slot that owns the fight. */
  slot: number;
  /** `fight`, or the pause before the next body (`respawn`) or an operation's first fight (`approach`). */
  phase: 'fight' | 'respawn' | 'approach';
  player: FighterView;
  /** The bodies on the player's side besides the character, in the order they came in; fallen ones stay, down. */
  allies: FighterView[];
  enemies: FighterView[];
  /** The fight clock, in ms, as the screen sees it. */
  nowMs: number;
}

/** The timing of a body's phase from the fight's own timer; the work the slot has received since the last event is counted. */
export function phaseTiming(
  state: GameState,
  c: Combatant,
  status: CombatantStatus,
  share: number,
): ProgressTiming {
  const combat = state.combat;
  if (!combat || combat.phase !== 'fight' || c.timer.need <= 0) return IDLE_TIMING;
  const done = Math.min(1, Math.max(0, c.timer.progress / c.timer.need));
  if (status.endsMs === null || share <= 0) {
    return { fraction: done, cycleMs: 0, running: false, repeat: false };
  }
  // What is left of the phase at the speed it has now, as of the last event of the fight.
  const left = Math.max(0, status.endsMs - Math.floor(combat.fight.t / WORK_PER_MS));
  if (done >= 1 || left <= 0) return { fraction: 1, cycleMs: 0, running: false, repeat: false };
  const cycleFight = left / (1 - done);
  const pending = combat.work / WORK_PER_MS;
  return {
    fraction: Math.min(1, done + pending / cycleFight),
    // Real time: the fight clock runs at the share the slot has.
    cycleMs: cycleFight / share,
    running: true,
    repeat: false,
  };
}

/** The cast of a technique as the seal strip reads it: the seals spread evenly over the action. */
export function castView(timing: ProgressTiming, count: number): PracticeView {
  const phases: PracticePhases = { focusEnd: 0, sealsEnd: 1, releaseEnd: 1, count };
  const sealMs = count > 0 ? timing.cycleMs / count : 0;
  const seal = count > 0 ? Math.min(count - 1, Math.floor(timing.fraction * count)) : -1;
  return {
    timing,
    phases,
    phase:
      count > 0 && timing.fraction < 1 ? { name: 'seal', seal } : { name: 'release', seal: -1 },
    sealMs,
    // Seals that would each be on screen for under a quarter of a second light as one sweep.
    sweep: count > 0 && sealMs > 0 && sealMs < MIN_SEAL_MS,
  };
}

/** The base id of a status effect: the further effects of a status are `<id>#<n>`. */
const baseId = (id: string): string => id.split('#')[0] ?? id;

function statusesOf(fight: { t: number }, c: Combatant, content: ContentDb): StatusView[] {
  const known = new Set(content.statuses.map((s) => s.id));
  const out = new Map<string, StatusView>();
  for (const e of c.effects) {
    const id = baseId(e.id);
    if (!known.has(id)) continue;
    const remainingMs = e.until === null ? null : Math.max(0, (e.until - fight.t) / WORK_PER_MS);
    const old = out.get(id);
    out.set(id, {
      id,
      remainingMs:
        old === undefined
          ? remainingMs
          : old.remainingMs === null || remainingMs === null
            ? null
            : Math.max(old.remainingMs, remainingMs),
      stacks: e.stacks ?? old?.stacks ?? 1,
    });
  }
  return [...out.values()];
}

function fighterOf(
  state: GameState,
  c: Combatant,
  nth: number,
  of: number,
  content: ContentDb,
  rules: Rules,
  share: number,
  nowMs: number,
): FighterView {
  const fight = state.combat!.fight;
  const status = combatantStatus(fight, c, content, rules);
  const timing = phaseTiming(state, c, status, share);
  const tech =
    status.action?.kind === 'technique' && status.action.id !== null
      ? content.techniques.find((t) => t.id === status.action?.id)
      : undefined;
  const seals = tech?.sealSeq ?? [];
  const last = status.last;
  return {
    key: c.id,
    side: c.side,
    entry: c.side === 'enemy' ? c.entry : null,
    ally: c.ally?.n ?? null,
    nth,
    of,
    alive: c.hp > 0,
    hp: Math.max(0, c.hp),
    maxHp: c.maxHp,
    chakra: c.chakra,
    maxChakra: c.maxChakra,
    stamina: c.stamina,
    maxStamina: c.maxStamina,
    phase: status.phase,
    heldBy: status.suspendedBy,
    action: status.action,
    timing,
    seals,
    cast: tech ? castView(timing, seals.length) : null,
    statuses: statusesOf(fight, c, content),
    last: last
      ? {
          kind: last.kind,
          id: last.id,
          outcome: last.outcome,
          damage: last.damage,
          statuses: last.statuses,
          combos: last.combos,
          avoidedBy: last.avoidedBy,
          atMs: last.atMs,
          ageMs: Math.max(0, nowMs - last.atMs),
        }
      : null,
  };
}

/** The scene of the running fight; null when no fight is running. */
export function buildScene(state: GameState, content: ContentDb, rules: Rules): Scene | null {
  const combat = state.combat;
  const slot = fightSlotIndex(state);
  if (!combat || slot < 0) return null;
  const fight = combat.fight;
  const share = Math.max(0, (state.slots[slot]?.share ?? 0) / SHARE_FULL);
  const nowMs = (fight.t + combat.work) / WORK_PER_MS;
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const e of fight.enemies) total.set(e.entry, (total.get(e.entry) ?? 0) + 1);
  const enemies = fight.enemies.map((e) => {
    const n = (seen.get(e.entry) ?? 0) + 1;
    seen.set(e.entry, n);
    return fighterOf(state, e, n, total.get(e.entry) ?? 1, content, rules, share, nowMs);
  });
  const allies = alliesOf(fight).map((a, i, all) =>
    fighterOf(state, a, i + 1, all.length, content, rules, share, nowMs),
  );
  return {
    slot,
    phase: combat.phase,
    player: fighterOf(state, fight.player, 1, 1, content, rules, share, nowMs),
    allies,
    enemies,
    nowMs,
  };
}

/** What an action did to the body it landed on, for the figure that flies off it for about a second. */
export interface Outcome {
  /** One per resolved action: the actor and the time it resolved, so a figure is drawn once. */
  key: string;
  kind: 'damage' | 'dodge' | 'interrupted' | 'effect';
  amount: number;
  /** The defensive technique that made a dodge, when there is one. */
  via: string | null;
  statuses: readonly string[];
  combos: readonly string[];
}

/**
 * The body an action of `actor` lands on: for an enemy the body of the player's side it was aimed at
 * (the character when it names none that is there); for the player's side the enemy it names while
 * that one stands, else the first one standing.
 */
function targetOfAction(scene: Scene, actor: FighterView): string {
  const named = actor.action?.target ?? null;
  if (actor.side === 'enemy') {
    const side = [scene.player, ...scene.allies];
    return side.find((b) => b.key === named)?.key ?? scene.player.key;
  }
  const aimed = named ? scene.enemies.find((e) => e.key === named && e.alive) : undefined;
  return (aimed ?? scene.enemies.find((e) => e.alive) ?? scene.enemies[0])?.key ?? actor.key;
}

/**
 * The enemy the player's action is aimed at: the one the action names while it stands, else the first
 * one standing (the engine's pick), else the first body; null when the fight has no enemy.
 */
export function targetedKey(scene: Scene): string | null {
  const named = scene.player.action?.target;
  const aimed = named ? scene.enemies.find((e) => e.key === named && e.alive) : undefined;
  return (aimed ?? scene.enemies.find((e) => e.alive) ?? scene.enemies[0])?.key ?? null;
}

/**
 * The outcomes still young enough to show, by the key of the body they land on. An interrupted action
 * lands on its own actor; a miss on an attack lands on the one who avoided it.
 */
export function outcomesOf(scene: Scene): Record<string, Outcome[]> {
  const out: Record<string, Outcome[]> = {};
  for (const actor of [scene.player, ...scene.allies, ...scene.enemies]) {
    const last = actor.last;
    if (!last || last.ageMs >= OUTCOME_SHOWN_MS) continue;
    const key = `${actor.key}@${last.atMs}`;
    let onto = targetOfAction(scene, actor);
    let outcome: Outcome | null = null;
    if (last.outcome === 'interrupted') {
      onto = actor.key;
      outcome = { key, kind: 'interrupted', amount: 0, via: null, statuses: [], combos: [] };
    } else if (last.outcome === 'miss') {
      outcome = { key, kind: 'dodge', amount: 0, via: last.avoidedBy, statuses: [], combos: [] };
    } else if (last.damage > 0) {
      outcome = {
        key,
        kind: 'damage',
        amount: last.damage,
        via: null,
        statuses: last.statuses,
        combos: last.combos,
      };
    } else if (last.statuses.length > 0 || last.combos.length > 0) {
      outcome = {
        key,
        kind: 'effect',
        amount: 0,
        via: null,
        statuses: last.statuses,
        combos: last.combos,
      };
    }
    if (outcome) (out[onto] ??= []).push(outcome);
  }
  return out;
}
