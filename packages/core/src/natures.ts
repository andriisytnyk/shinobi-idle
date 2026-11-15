import {
  KEY_NATURES,
  NATURE_IDS,
  NATURE_WHEEL,
  TRAIT_ANSWER,
  type Boss,
  type Cell,
  type ComboId,
  type ContentDb,
  type Mission,
  type MissionStage,
  type NatureId,
  type SkillId,
  type TraitId,
} from '@shinobi/content';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { indexOf } from './lookup.ts';
import type { Modifier, ModifierProvider } from './modifiers.ts';
import { skillLevel } from './requirements.ts';
import { nextInt } from './rng.ts';
import type { GameState } from './state.ts';

/** The player's team mates' natures, fixed when the native nature is chosen. */
export interface TeamNatures {
  rival: NatureId;
  aya: NatureId;
}

/** A choice of nature: a given one, or `'random'` (the chakra paper decides). */
export type NatureChoice = NatureId | 'random';

const isNature = (x: unknown): x is NatureId => (NATURE_IDS as readonly unknown[]).includes(x);

/** The nature that beats `nature` on the wheel. */
export function natureBeating(nature: NatureId): NatureId {
  return NATURE_IDS.find((n) => NATURE_WHEEL[n] === nature) ?? nature;
}

/** The rival's nature: the one that beats the player's native nature. */
export function rivalNatureFor(native: NatureId): NatureId {
  return natureBeating(native);
}

/** Aya's nature: Suiton when the native nature is Raiton or Doton, otherwise Raiton. */
export function ayaNatureFor(native: NatureId): NatureId {
  return native === 'raiton' || native === 'doton' ? 'suiton' : 'raiton';
}

export function teamFor(native: NatureId): TeamNatures {
  return { rival: rivalNatureFor(native), aya: ayaNatureFor(native) };
}

/** The first, native nature; null before the nature test. */
export function nativeNature(state: GameState): NatureId | null {
  return state.player.natures[0] ?? null;
}

/** The rival's nature, or null before the native nature is chosen. */
export function rivalNature(state: GameState): NatureId | null {
  return state.team?.rival ?? null;
}

/** Aya's nature, or null before the native nature is chosen. */
export function ayaNature(state: GameState): NatureId | null {
  return state.team?.aya ?? null;
}

/**
 * Resolves the rival boss rule `beatsPlayerFirst` to a nature: the one that beats the player's
 * first nature. Null while the player has no nature.
 */
export function resolveBossNature(
  state: GameState,
  rule: 'beatsPlayerFirst' | 'wheel',
): NatureId | null {
  const team = state.team;
  if (rule === 'beatsPlayerFirst' && team) return team.rival;
  const native = nativeNature(state);
  return native ? natureBeating(native) : null;
}

/** The nature a boss fights with for this player, resolving the rival's rule through the state. */
export function bossNature(state: GameState, boss: Boss): NatureId | null {
  if (boss.special.kind === 'rival') return resolveBossNature(state, boss.special.nature);
  if (boss.nature === 'wheel') return resolveBossNature(state, 'wheel');
  return boss.nature;
}

/**
 * The skill level a technique's cast time grows with, when the technique is of a non-native
 * nature: its own skill's level. Undefined for native, non-elemental techniques and for a player
 * with no nature yet (no native nature, nothing to be foreign to).
 */
export function nonNativeLevel(
  skill: SkillId,
  natures: readonly NatureId[],
  level: number,
): number | undefined {
  if (!isNature(skill) || natures.length === 0 || natures[0] === skill) return undefined;
  return level;
}

/** The native nature trains with extra XP; the modifier names the nature as its visible source. */
export const natureProvider: ModifierProvider = (state, content) => {
  const native = nativeNature(state);
  if (!native) return NONE;
  const mod: Modifier = {
    key: `xp.skill.${native}`,
    op: 'add',
    value: content.balance.K.nativeXp - 1,
    group: 'character',
    source: 'mod.source.nativeNature',
  };
  return [mod];
};

const NONE: Modifier[] = [];

// ---------- the nature test: commands ----------

export type NatureStage = 'locked' | 'test' | 'second' | 'third' | 'full';

export interface NatureStatus {
  stage: NatureStage;
  /** The nature may be chosen now (the test, or an extra nature). */
  canChoose: boolean;
  /** Chakra Control level asked for the next extra nature; null when none is due. */
  needCc: number | null;
  /** Chakra Control level of the player. */
  cc: number;
  /** Natures that may still be chosen. */
  free: NatureId[];
}

/** Where the player stands: not yet a genin, at the test, or choosing extra natures. */
export function natureStatus(state: GameState, content: ContentDb): NatureStatus {
  const K = content.balance.K.natures;
  const owned = state.player.natures;
  const cc = skillLevel(state, 'cc', content);
  const free = NATURE_IDS.filter((n) => !owned.includes(n));
  if (state.player.rank === 'student')
    return { stage: 'locked', canChoose: false, needCc: null, cc, free };
  if (owned.length === 0) return { stage: 'test', canChoose: true, needCc: null, cc, free };
  if (owned.length >= K.max) return { stage: 'full', canChoose: false, needCc: null, cc, free };
  const needCc = owned.length === 1 ? K.second : K.third;
  return {
    stage: owned.length === 1 ? 'second' : 'third',
    canChoose: cc >= needCc && free.length > 0,
    needCc,
    cc,
    free,
  };
}

function pick(state: GameState, choice: NatureChoice, free: readonly NatureId[]): NatureId | null {
  if (choice === 'random') return free[nextInt(state.rng, 'world', free.length)] ?? null;
  return free.includes(choice) ? choice : null;
}

/** `nature.choose`: the chakra paper test, once, as a genin. Sets the native nature and the team's. */
export function chooseNature(state: GameState, choice: NatureChoice): CommandResult {
  if (choice !== 'random' && !isNature(choice)) return { ok: false, reason: 'error.invalidNature' };
  if (state.player.rank === 'student') return { ok: false, reason: 'error.natureNotGenin' };
  if (state.player.natures.length > 0) return { ok: false, reason: 'error.natureChosen' };
  const nature = pick(state, choice, NATURE_IDS);
  if (!nature) return { ok: false, reason: 'error.invalidNature' };
  state.player.natures = [nature];
  state.team = teamFor(nature);
  emit(state, { type: 'natureGained', nature, first: true });
  return { ok: true };
}

/** `nature.add`: a second nature at Chakra Control 20, a third at 40; only natures not owned. */
export function addNature(
  state: GameState,
  choice: NatureChoice,
  content: ContentDb,
): CommandResult {
  if (choice !== 'random' && !isNature(choice)) return { ok: false, reason: 'error.invalidNature' };
  const status = natureStatus(state, content);
  if (status.stage === 'locked' || status.stage === 'test') {
    return { ok: false, reason: 'error.natureNeedsNative' };
  }
  if (status.stage === 'full') return { ok: false, reason: 'error.natureMax' };
  if (choice !== 'random' && state.player.natures.includes(choice)) {
    return { ok: false, reason: 'error.natureOwned' };
  }
  if (!status.canChoose) return { ok: false, reason: 'error.natureControlLow' };
  const nature = pick(state, choice, status.free);
  if (!nature) return { ok: false, reason: 'error.invalidNature' };
  state.player.natures.push(nature);
  emit(state, { type: 'natureGained', nature, first: false });
  return { ok: true };
}

// ---------- consequences ----------

/** Whether one mission stage can be met with the natures owned; skills that are not natures are always open. */
function stageDoable(
  stage: MissionStage,
  natures: ReadonlySet<string>,
  content: ContentDb,
): boolean {
  const open = (skill: string): boolean => !isNature(skill) || natures.has(skill);
  switch (stage.t) {
    case 'skill':
      return open(stage.skill);
    case 'tech':
      return stage.any.some((a) => open(a.skill));
    case 'named': {
      const techniques = indexOf(content).techniques;
      return [stage.technique, ...stage.alts].some((id) => {
        const tech = techniques.get(id);
        return tech !== undefined && open(tech.skill);
      });
    }
    default:
      return true;
  }
}

/** The village missions of the slice: the ones that bring a resource to the village. */
export function villageMissions(content: ContentDb): Mission[] {
  return content.missions.filter((m) => m.rank === 'V');
}

/** Whether a mission can be done by someone who owns exactly `natures`. */
export function missionDoable(
  mission: Mission,
  natures: readonly NatureId[],
  content: ContentDb,
): boolean {
  const set = new Set<string>(natures);
  return mission.stages.every((s) => stageDoable(s, set, content));
}

/** Key cells that need a nature (rock and water cells need none). */
export function natureKeyCells(content: ContentDb): Cell[] {
  return content.cells.filter((c) => c.key !== null && KEY_NATURES[c.key].length > 0);
}

const cellOpen = (cell: Cell, natures: readonly NatureId[]): boolean =>
  cell.key !== null && KEY_NATURES[cell.key].some((n) => natures.some((o) => o === n));

/** Resources the village missions doable with `natures` bring in. */
function reachableResources(natures: readonly NatureId[], content: ContentDb): Set<string> {
  const out = new Set<string>();
  for (const m of villageMissions(content)) {
    if (m.resource && missionDoable(m, natures, content)) out.add(m.resource);
  }
  return out;
}

/** Level-6 buildings (those that need resources) whose every resource can be brought in. */
function reachableBuildings(natures: readonly NatureId[], content: ContentDb): string[] {
  const have = reachableResources(natures, content);
  return content.buildings
    .filter((b) => b.tier6 !== null && Object.keys(b.tier6).every((r) => have.has(r)))
    .map((b) => b.id);
}

export interface NatureSetSummary {
  missions: { ids: string[]; total: number };
  buildings: { ids: string[]; total: number };
  cells: { ids: string[]; total: number };
}

/** What a set of natures lets the player do: village missions, level-6 buildings and key cells. */
export function natureSetSummary(
  natures: readonly NatureId[],
  content: ContentDb,
): NatureSetSummary {
  const missions = villageMissions(content);
  const cells = natureKeyCells(content);
  return {
    missions: {
      ids: missions.filter((m) => missionDoable(m, natures, content)).map((m) => m.id),
      total: missions.length,
    },
    buildings: {
      ids: reachableBuildings(natures, content),
      total: content.buildings.filter((b) => b.tier6 !== null).length,
    },
    cells: {
      ids: cells.filter((c) => cellOpen(c, natures)).map((c) => c.id),
      total: cells.length,
    },
  };
}

export interface NatureConsequences {
  nature: NatureId;
  /** The player owns the nature / it is the native one. */
  owned: boolean;
  native: boolean;
  /** Village missions that only a nature opens and this one does. */
  missions: string[];
  /** Level-6 buildings whose resources this nature helps bring in. */
  buildings: string[];
  /** Key cells of the map this nature opens. */
  cells: string[];
  /** Enemy traits answered by tags of this nature's techniques. */
  traits: TraitId[];
  strongAgainst: NatureId;
  weakAgainst: NatureId;
  /** The rival's and Aya's natures if this one were the native nature. */
  rival: NatureId;
  aya: NatureId;
  /** Status combos this nature takes part in: it triggers them or applies the state they need. */
  combos: ComboId[];
}

/**
 * What choosing `nature` means, from the content: the village missions, level-6 buildings and map
 * cells it opens, the enemy traits its techniques answer, its place on the wheel, the team
 * natures that follow from it as the native nature, and its status combos.
 */
export function natureConsequences(
  nature: NatureId,
  state: GameState,
  content: ContentDb,
): NatureConsequences {
  const none: readonly NatureId[] = [];
  const alone: readonly NatureId[] = [nature];
  const baseMissions = new Set(
    villageMissions(content)
      .filter((m) => missionDoable(m, none, content))
      .map((m) => m.id),
  );
  const missions = villageMissions(content)
    .filter((m) => !baseMissions.has(m.id) && missionDoable(m, alone, content))
    .map((m) => m.id);
  const baseResources = reachableResources(none, content);
  const withResources = reachableResources(alone, content);
  const buildings = content.buildings
    .filter(
      (b) =>
        b.tier6 !== null &&
        Object.keys(b.tier6).some((r) => !baseResources.has(r) && withResources.has(r)),
    )
    .map((b) => b.id);
  const tags = new Set<string>();
  const states = new Set<string>();
  for (const t of content.techniques) {
    if (t.skill !== nature) continue;
    for (const tag of t.tags) tags.add(tag);
    if (t.state) states.add(t.state);
  }
  const traits = (Object.keys(TRAIT_ANSWER) as TraitId[]).filter((id) =>
    tags.has(TRAIT_ANSWER[id]),
  );
  return {
    nature,
    owned: state.player.natures.includes(nature),
    native: nativeNature(state) === nature,
    missions,
    buildings,
    cells: natureKeyCells(content)
      .filter((c) => cellOpen(c, alone))
      .map((c) => c.id),
    traits,
    strongAgainst: NATURE_WHEEL[nature],
    weakAgainst: natureBeating(nature),
    rival: rivalNatureFor(nature),
    aya: ayaNatureFor(nature),
    // A combo is joined by the nature that triggers it and by the nature whose techniques apply its state.
    combos: content.combos
      .filter((c) => c.nature === nature || states.has(c.onState))
      .map((c) => c.id),
  };
}
