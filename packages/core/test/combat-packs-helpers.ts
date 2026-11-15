import { composeContent, corePack, type ContentDb } from '@shinobi/content';
import { testmodPack } from '@shinobi/content/testmod';
import {
  createFight,
  defaultRules,
  encounterFor,
  fightAdvance,
  fightNextEventIn,
  workOf,
  type CombatAi,
  type Encounter,
  type FightState,
  type PlayerSnapshot,
  type Rules,
} from '../src/index.ts';

/** The core pack alone, and the core pack with the test pack: what a fight is played against. */
export const core: ContentDb = composeContent([corePack]);
export const mod: ContentDb = composeContent([corePack, testmodPack]);

/**
 * The rules of the core pack with the behaviour of the test pack added: the pack's `rules` function
 * applied to the base rules, the way the composed rules of a game are made.
 */
export const modRules: Rules = (testmodPack.rules?.({ ...defaultRules }) ?? defaultRules) as Rules;

export const TECH = 'testmod:ember_pulse';
export const sec = (s: number): number => workOf(Math.round(s * 1000));

/** A player with the given techniques, level 40 in every skill of the content in hand and mastery 20. */
export function player(
  known: string[],
  content: ContentDb = mod,
  levels: Record<string, number> = {},
): PlayerSnapshot {
  const all: Record<string, number> = {};
  for (const skill of content.skills) all[skill.id] = 40;
  return {
    levels: { ...all, ...levels } as PlayerSnapshot['levels'],
    mastery: Object.fromEntries(known.map((id) => [id, 20])),
    known,
    natures: ['katon'],
    costMod: { chakra: 1, stamina: 1 },
    tier: 2,
  };
}

export function entryOf(id: string, content: ContentDb = mod) {
  const entry = [...content.enemies, ...content.bosses].find((e) => e.id === id);
  if (!entry) throw new Error(`no entry ${id}`);
  return entry;
}

export const encounter = (id: string, content: ContentDb = mod): Encounter =>
  encounterFor(entryOf(id, content), content);

/** An AI that casts the technique whenever it is ready and otherwise waits. */
export const caster =
  (id: string): CombatAi =>
  (view) =>
    view.techniques.some((r) => r.ready && r.tech.id === id)
      ? { type: 'technique', id }
      : { type: 'wait' };

export const withAi = (combatAi: CombatAi, base: Rules = modRules): Rules => ({
  ...base,
  combatAi,
});

/** Endless health for the player, none of his basic damage, and huge health for the enemies. */
export function quiet(fight: FightState): FightState {
  fight.player.hp = fight.player.maxHp = 1e9;
  fight.player.damage = 0;
  for (const e of fight.enemies) e.hp = e.maxHp = 1e9;
  return fight;
}

/** Stops the ordinary attacks of the enemies. */
export function pacify(fight: FightState): FightState {
  for (const e of fight.enemies) e.timer.need = 1e15;
  return fight;
}

/** Plays event by event until `done` holds, the fight is over or `limit` work units have passed. */
export function runUntil(
  fight: FightState,
  done: (f: FightState) => boolean,
  rules: Rules,
  content: ContentDb = mod,
  limit = sec(600),
): FightState {
  while (!done(fight) && fight.result === 'ongoing' && fight.t < limit) {
    fightAdvance(fight, fightNextEventIn(fight, content, rules) ?? 1, content, rules);
  }
  return fight;
}

/**
 * Plays seeds until `technique` has been cast `times` times and has landed (damage was dealt by
 * it), and returns that fight at the moment of the last cast.
 */
export function landed(
  id: string,
  technique: string,
  times: number,
  setup: (f: FightState) => void = () => undefined,
  known: string[] = [technique],
): FightState {
  for (let seed = 1; seed < 200; seed++) {
    const rules = withAi(caster(technique));
    const fight = createFight(player(known), encounter(id), seed, mod, rules);
    quiet(fight);
    pacify(fight);
    setup(fight);
    runUntil(fight, (f) => (f.tally.uses[technique] ?? 0) >= times, rules);
    if ((fight.tally.damage[technique] ?? 0) > 0) return fight;
  }
  throw new Error(`no seed lands ${technique}`);
}
