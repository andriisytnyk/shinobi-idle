import { content } from '@shinobi/content';
import {
  advance,
  analyzeFight,
  defaultRules,
  dispatch,
  unlockBoss,
  type Analysis,
  type AnalysisTarget,
  type GameState,
} from '../src/index.ts';
import { K } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { wellStocked } from './prep-helpers.ts';
import {
  fighter,
  ids,
  know,
  run,
  startFight,
  startOperation,
  stock,
  unlock,
} from './prep-state.ts';

/** Shared by the analysis tests: the cases, the state they are built from and real play. */

/** Pills the player keeps in the bank besides the pouch: a few hundred broths is what a few hours of play can buy. */
export const BROTHS = 150;

export interface Case {
  name: string;
  target: AnalysisTarget;
  level: number;
  bank: Record<string, number>;
  knows?: string[];
  /** A drill in the second slot halves the share of the fight. */
  shared?: boolean;
  prepare: (state: GameState) => void;
}

export const analyze = (state: GameState, target: AnalysisTarget, opts = {}): Analysis => {
  const result = analyzeFight(state, target, opts, content, defaultRules);
  if (!result) throw new Error('no analysis');
  return result;
};

export const boss = (level: number, broths = BROTHS): Case => ({
  name: `the hunter boss at level ${level}`,
  target: { kind: 'boss', id: 'core:zone_boss_hunter' },
  level,
  bank: { [ids.heal]: broths },
  knows: ['core:boss_hunter'],
  prepare: (s) => {
    unlockBoss(s, 'core:boss_hunter', content);
    run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_hunter' });
  },
});

export const zone = (shared: boolean): Case => ({
  name: shared ? 'a plain zone with a drill in the other slot' : 'a plain zone',
  target: { kind: 'zone', id: 'core:zone_wolfmask' },
  level: 2,
  bank: { [ids.heal]: BROTHS },
  shared,
  prepare: (s) => run(s, { type: 'loadout.prepare', encounter: 'core:zone_wolfmask' }),
});

export const hideout: Case = {
  name: 'the hideout operation',
  target: { kind: 'operation', id: 'core:op_hideout' },
  level: 50,
  bank: Object.fromEntries(Object.keys(wellStocked(50)).map((id) => [id, 200])),
  knows: ['core:guard_pack', 'core:boss_twins', 'core:boss_mist'],
  prepare: (s) => {
    unlock(s, 'op.hideout.unlocked');
    run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_twins' });
  },
};

export function build(c: Case, seed: number): GameState {
  const state = fighter(seed, c.level, 'katon');
  setLevel(state, 'futon', c.level);
  setLevel(state, 'raiton', c.level);
  for (const id of c.knows ?? []) know(state, id);
  stock(state, c.bank);
  c.prepare(state);
  if (c.shared) {
    state.slots.push({ action: null, progress: 0, share: 1000, data: null });
    const drill = content.exercises[0];
    if (!drill) throw new Error('no drill');
    const started = dispatch(
      state,
      { type: 'action.start', slot: 1, kind: 'drill', id: drill.id },
      content,
    );
    if (!started.ok) throw new Error(`drill refused: ${started.reason}`);
  }
  return state;
}

export interface Played {
  /** Wins and fights, hour by hour. */
  hours: { wins: number; fights: number }[];
  /** Minutes at which the last healing unit (pouch and bank) was used, or null. */
  outAt: number | null;
  /** Minutes to the first defeat, or null when there was none. */
  firstDefeat: number | null;
}

export const rateOf = (h: { wins: number; fights: number }): number =>
  h.fights === 0 ? 0 : h.wins / h.fights;

/** Plays the real game for `minutes`: start the action, restart it after a defeat, keep nothing fixed. */
export function play(c: Case, seed: number, minutes: number): Played {
  const state = build(c, seed);
  const start = (): void => {
    const result =
      c.target.kind === 'operation'
        ? startOperation(state, c.target.id)
        : startFight(state, c.target.id);
    if (!result.ok) throw new Error(`cannot start ${c.target.id}: ${result.reason}`);
  };
  start();
  const win = c.target.kind === 'operation' ? 'operationCleared' : 'enemyDefeated';
  const hours: Played['hours'] = [];
  let outAt: number | null = null;
  let firstDefeat: number | null = null;
  const heal = (): number =>
    (state.bank[ids.heal] ?? 0) +
    state.pouch.slots.reduce((n, s) => n + (s.id === ids.heal ? s.n : 0), 0);
  for (let t = 0; t < minutes * 60_000; t += 1000) {
    advance(state, 1000, content);
    const h = (hours[Math.floor(t / 3_600_000)] ??= { wins: 0, fights: 0 });
    for (const e of state.events) {
      if (e.type === win) {
        h.wins++;
        h.fights++;
      } else if (e.type === 'playerDefeated') {
        h.fights++;
        firstDefeat ??= (t + 1000) / 60_000;
      }
    }
    state.events = [];
    if (outAt === null && heal() === 0) outAt = t / 60_000;
    if (!state.slots.some((s) => s.action?.kind === 'fight' || s.action?.kind === 'operation')) {
      start();
    }
  }
  return { hours, outAt, firstDefeat };
}

export const total = (p: Played): { wins: number; fights: number } => ({
  wins: p.hours.reduce((n, h) => n + h.wins, 0),
  fights: p.hours.reduce((n, h) => n + h.fights, 0),
});

export const inBand = (v: number, p10: number, p90: number): boolean =>
  v >= p10 - 0.05 && v <= p90 + 0.05;
