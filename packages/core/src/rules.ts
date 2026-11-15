import { PackError, type ContentDb, type ContentPack } from '@shinobi/content';
import { guardAi, guardKind, guardProvider, tagOrigin } from './guard.ts';
import { actionSystem, drillKind, practiceKind, type ActionKind } from './actions.ts';
import { COURSE_KIND, courseKind, obstacleProvider } from './athletics.ts';
import { defaultCombatAi } from './combat/fight-ai.ts';
import { defaultFightHooks } from './combat/fight-hooks.ts';
import type { CombatAi, FightRules } from './combat/fight-types.ts';
import { tonicProvider } from './buffs.ts';
import { checkpointProvider } from './checkpoints.ts';
import { fightKind, operationKind } from './combat/kind.ts';
import { combatSystem } from './combat/system.ts';
import { woundSystem } from './combat/wounds.ts';
import { senseiTestKind } from './exam.ts';
import { craftKind, gatherKind } from './field.ts';
import { gearProvider } from './gear.ts';
import { meditateKind, meditationProvider } from './meditation.ts';
import type { ModifierProvider } from './modifiers.ts';
import { natureProvider } from './natures.ts';
import { missionKind, MISSION_KIND } from './missions/index.ts';
import { questSystem } from './quests.ts';
import { villageProvider, villageSystem } from './village.ts';
import { EXPLORE_KIND, WALK_KIND, exploreKind, walkKind, worldProvider } from './world.ts';
import type { System } from './system.ts';

/**
 * Everything that defines how a game behaves, as one explicit value. The order of `systems` is
 * the order they run when events coincide. Nothing registers itself: later stages add their
 * system, kinds and providers to `defaultRules` below, in this one place.
 */
export interface Rules extends FightRules {
  systems: readonly System[];
  actionKinds: Readonly<Record<string, ActionKind>>;
  modifierProviders: readonly ModifierProvider[];
  /** Decides what the player does whenever the fight needs a choice. */
  combatAi: CombatAi;
}

/** A system under a name, so that a pack can wrap it. */
const named = (id: string, system: System): System => ({ ...system, id });

/** The rules of the built-in pack alone. A game with other packs builds its rules with `composeRules`. */
export const defaultRules: Rules = {
  systems: [
    named('action', actionSystem),
    named('combat', combatSystem),
    named('wound', woundSystem),
    named('village', villageSystem),
    named('quest', questSystem),
  ],
  actionKinds: {
    practice: practiceKind,
    drill: drillKind,
    meditate: meditateKind,
    [COURSE_KIND]: courseKind,
    fight: fightKind,
    operation: operationKind,
    [MISSION_KIND]: missionKind,
    gather: gatherKind,
    craft: craftKind,
    senseiTest: senseiTestKind,
    [EXPLORE_KIND]: exploreKind,
    [WALK_KIND]: walkKind,
  },
  modifierProviders: [
    tonicProvider,
    gearProvider,
    checkpointProvider,
    meditationProvider,
    obstacleProvider,
    natureProvider,
    worldProvider,
    villageProvider,
  ],
  combatAi: defaultCombatAi,
  fightHooks: defaultFightHooks,
};

// ---------- rules from packs ----------

/** The families of the rules a pack can add to or wrap an entry of. */
export type RuleFamily = 'systems' | 'actionKinds' | 'modifierProviders';

/**
 * Adds an entry to the rules and returns the extended rules; the rules given are not changed.
 * `systems` and `modifierProviders` append (they run after the entries already there);
 * `actionKinds` takes a key that must be free, so a pack can add a kind but never silently
 * replace one: replacing is `wrapRule`.
 */
export function addRule(rules: Rules, family: 'systems', entry: System): Rules;
export function addRule(rules: Rules, family: 'modifierProviders', entry: ModifierProvider): Rules;
export function addRule(rules: Rules, family: 'actionKinds', key: string, entry: ActionKind): Rules;
export function addRule(
  rules: Rules,
  family: RuleFamily,
  keyOrEntry: string | System | ModifierProvider,
  kind?: ActionKind,
): Rules {
  if (family === 'systems') return { ...rules, systems: [...rules.systems, keyOrEntry as System] };
  if (family === 'modifierProviders') {
    return {
      ...rules,
      modifierProviders: [...rules.modifierProviders, keyOrEntry as ModifierProvider],
    };
  }
  const key = String(keyOrEntry);
  if (Object.hasOwn(rules.actionKinds, key)) throw new Error(`the action kind "${key}" exists`);
  if (!kind) throw new Error(`no action kind given for "${key}"`);
  return { ...rules, actionKinds: { ...rules.actionKinds, [key]: kind } };
}

/**
 * Replaces an entry of the rules by what `wrap` makes of it and returns the extended rules. An
 * action kind is found by its key, a system by its `id`; an entry that is not there is an error,
 * so a wrap cannot quietly miss.
 */
export function wrapRule(
  rules: Rules,
  family: 'actionKinds',
  key: string,
  wrap: (original: ActionKind) => ActionKind,
): Rules;
export function wrapRule(
  rules: Rules,
  family: 'systems',
  id: string,
  wrap: (original: System) => System,
): Rules;
export function wrapRule(
  rules: Rules,
  family: 'actionKinds' | 'systems',
  key: string,
  wrap: ((original: ActionKind) => ActionKind) | ((original: System) => System),
): Rules {
  if (family === 'systems') {
    const at = rules.systems.findIndex((x) => x.id === key);
    const original = rules.systems[at];
    if (!original) throw new Error(`there is no system "${key}" to wrap`);
    const systems = [...rules.systems];
    systems[at] = (wrap as (original: System) => System)(original);
    return { ...rules, systems };
  }
  if (!Object.hasOwn(rules.actionKinds, key))
    throw new Error(`there is no action kind "${key}" to wrap`);
  const original = rules.actionKinds[key];
  if (!original) throw new Error(`there is no action kind "${key}" to wrap`);
  const wrapped = (wrap as (original: ActionKind) => ActionKind)(original);
  return { ...rules, actionKinds: { ...rules.actionKinds, [key]: wrapped } };
}

/** What a pack's `rules` function is: it gets the rules built so far and the composed content. */
export type PackRulesFn = (base: Rules, content: ContentDb) => Rules;

const isRules = (x: unknown): x is Rules =>
  typeof x === 'object' &&
  x !== null &&
  Array.isArray((x as Rules).systems) &&
  Array.isArray((x as Rules).modifierProviders) &&
  typeof (x as Rules).actionKinds === 'object' &&
  (x as Rules).actionKinds !== null;

/**
 * Builds the rules of a game from the rules of the built-in pack and the `rules` function of each
 * pack, in the load order of `content.packs` (the order of `packs` does not matter; packs that the
 * content does not hold are ignored). Each function receives the rules built so far and returns the
 * extended set: it may add entries and wrap or replace existing ones (`addRule`, `wrapRule`, or
 * spreading the rules for the fight hooks and the AI). A function must be deterministic and must
 * not read the clock or `Math.random`; the engine cannot enforce that. A pack without `rules`
 * changes nothing, so `composeRules(defaultRules, [corePack], content)` is `defaultRules`.
 */
export function composeRules(
  base: Rules,
  packs: readonly ContentPack[],
  content: ContentDb,
): Rules {
  const byId = new Map(packs.map((p) => [p.manifest.id, p]));
  let rules = base;
  for (const manifest of content.packs) {
    const fn = byId.get(manifest.id)?.rules as unknown as PackRulesFn | undefined;
    if (fn === undefined) continue;
    let next: unknown;
    try {
      next = fn(rules, content);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new PackRulesError(
        manifest.id,
        `the rules of the pack "${manifest.id}" failed: ${why}`,
      );
    }
    if (!isRules(next)) {
      throw new PackRulesError(
        manifest.id,
        `the rules of the pack "${manifest.id}" are not a rule set`,
      );
    }
    rules = adopt(rules, next, manifest.id);
  }
  return rules;
}

/** An error in the rules function of a pack (or in a rule it adds); `pack` names the pack. */
export class PackRulesError extends PackError {
  constructor(pack: string, message: string) {
    super(pack, message);
    this.name = 'PackRulesError';
  }
}

/**
 * What a pack's function made of the rules: every entry that is new or replaced is recorded as the
 * pack's and guarded (see `guard.ts`), so nothing a pack adds can stop or corrupt `advance`.
 */
function adopt(before: Rules, after: Rules, pack: string): Rules {
  const systems = after.systems.map((s) => (before.systems.includes(s) ? s : tagOrigin(s, pack)));
  const actionKinds: Record<string, ActionKind> = {};
  for (const [key, kind] of Object.entries(after.actionKinds)) {
    const old = Object.hasOwn(before.actionKinds, key) ? before.actionKinds[key] : undefined;
    actionKinds[key] = old === kind ? kind : guardKind(kind, pack);
  }
  const modifierProviders = after.modifierProviders.map((p) =>
    before.modifierProviders.includes(p) ? p : guardProvider(p, pack),
  );
  // A player AI that a pack set is guarded: when it fails, the AI it replaced decides.
  const combatAi =
    after.combatAi === before.combatAi
      ? after.combatAi
      : guardAi(after.combatAi, pack, before.combatAi);
  return { ...after, systems, actionKinds, modifierProviders, combatAi };
}
