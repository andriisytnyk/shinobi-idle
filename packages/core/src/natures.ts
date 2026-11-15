import type { Boss, Cell, ContentDb, Mission, MissionStage, NatureId } from '@shinobi/content';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { indexOf } from './lookup.ts';
import type { Modifier, ModifierProvider } from './modifiers.ts';
import { skillLevel } from './requirements.ts';
import { nextInt } from './rng.ts';
import type { GameState } from './state.ts';
import { activitySkill, isAcademyRank, isNature, ownsNature } from './vocab.ts';

/** The player's team mates' natures, fixed when the native nature is chosen. */
export interface TeamNatures {
  rival: NatureId;
  aya: NatureId;
}

/** A choice of nature: the id of a nature, or `'random'` (the chakra paper decides). */
export type NatureChoice = string;

/** The nature that beats `nature` on the wheel: the first nature of the content that is strong against it. */
export function natureBeating(content: ContentDb, nature: string): NatureId {
  return (content.natures.find((n) => n.strongAgainst.includes(nature))?.id ?? nature) as NatureId;
}

/** The nature `nature` beats on the wheel; itself when it beats none. */
export function natureBeaten(content: ContentDb, nature: string): NatureId {
  return (indexOf(content).natures.get(nature)?.strongAgainst[0] ?? nature) as NatureId;
}

/** The rival's nature: the one that beats the player's native nature. */
export function rivalNatureFor(content: ContentDb, native: string): NatureId {
  return natureBeating(content, native);
}

/** Aya's nature: the `ayaNature` of the native nature. */
export function ayaNatureFor(content: ContentDb, native: string): NatureId {
  return (indexOf(content).natures.get(native)?.ayaNature ?? native) as NatureId;
}

export function teamFor(content: ContentDb, native: string): TeamNatures {
  return { rival: rivalNatureFor(content, native), aya: ayaNatureFor(content, native) };
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
 * Resolves the rival boss rule `beatsPlayerFirst` (and the plain `wheel`) to a nature: the one that
 * beats the player's first nature, which the state keeps as the rival's nature. Null while the
 * player has no nature.
 */
export function resolveBossNature(
  state: GameState,
  _rule: 'beatsPlayerFirst' | 'wheel',
): NatureId | null {
  return state.team?.rival ?? null;
}

/** The nature a boss fights with for this player, resolving the rival's rule through the state. */
export function bossNature(state: GameState, boss: Boss): NatureId | null {
  if (boss.special.kind === 'rival' && boss.special.nature) {
    return resolveBossNature(state, boss.special.nature);
  }
  if (boss.nature === 'wheel') return resolveBossNature(state, 'wheel');
  return boss.nature;
}

/**
 * The skill level a technique's cast time grows with, when the technique is of a non-native
 * nature: its own skill's level. Undefined for native, non-elemental techniques and for a player
 * with no nature yet (no native nature, nothing to be foreign to).
 */
export function nonNativeLevel(
  skill: string,
  natures: readonly string[],
  level: number,
  content?: ContentDb,
): number | undefined {
  if (natures.length === 0 || natures[0] === skill) return undefined;
  // Without the content (the fight code has not been given it yet) a nature is one the player owns.
  const nature = content ? isNature(content, skill) : natures.includes(skill);
  return nature ? level : undefined;
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
  const owned: readonly string[] = state.player.natures;
  const control = activitySkill(content, 'drill');
  const cc = control === null ? 0 : skillLevel(state, control, content);
  const free = indexOf(content).natureIds.filter((n) => !owned.includes(n)) as NatureId[];
  if (isAcademyRank(content, state.player.rank))
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

function pick(state: GameState, choice: NatureChoice, free: readonly string[]): NatureId | null {
  if (choice === 'random')
    return (free[nextInt(state.rng, 'world', free.length)] ?? null) as NatureId | null;
  return free.includes(choice) ? (choice as NatureId) : null;
}

/** `nature.choose`: the chakra paper test, once, as a genin. Sets the native nature and the team's. */
export function chooseNature(
  state: GameState,
  choice: NatureChoice,
  content: ContentDb,
): CommandResult {
  if (typeof choice !== 'string' || (choice !== 'random' && !isNature(content, choice))) {
    return { ok: false, reason: 'error.invalidNature' };
  }
  if (isAcademyRank(content, state.player.rank)) {
    return { ok: false, reason: 'error.natureNotGenin' };
  }
  if (state.player.natures.length > 0) return { ok: false, reason: 'error.natureChosen' };
  const nature = pick(state, choice, indexOf(content).natureIds);
  if (!nature) return { ok: false, reason: 'error.invalidNature' };
  state.player.natures = [nature];
  state.team = teamFor(content, nature);
  emit(state, { type: 'natureGained', nature, first: true });
  return { ok: true };
}

/** `nature.add`: a second nature at Chakra Control 20, a third at 40; only natures not owned. */
export function addNature(
  state: GameState,
  choice: NatureChoice,
  content: ContentDb,
): CommandResult {
  if (typeof choice !== 'string' || (choice !== 'random' && !isNature(content, choice))) {
    return { ok: false, reason: 'error.invalidNature' };
  }
  const status = natureStatus(state, content);
  if (status.stage === 'locked' || status.stage === 'test') {
    return { ok: false, reason: 'error.natureNeedsNative' };
  }
  if (status.stage === 'full') return { ok: false, reason: 'error.natureMax' };
  if (choice !== 'random' && ownsNature(state, choice)) {
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
  const open = (skill: string): boolean => !isNature(content, skill) || natures.has(skill);
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
  return content.missions.filter((m) => m.resource !== null);
}

/** Whether a mission can be done by someone who owns exactly `natures`. */
export function missionDoable(
  mission: Mission,
  natures: readonly string[],
  content: ContentDb,
): boolean {
  const set = new Set<string>(natures);
  return mission.stages.every((s) => stageDoable(s, set, content));
}

/** Key cells that need a nature (rock and water cells need none). */
export function natureKeyCells(content: ContentDb): Cell[] {
  const keyNatures = indexOf(content).keyNatures;
  return content.cells.filter((c) => c.key !== null && (keyNatures.get(c.key)?.length ?? 0) > 0);
}

const cellOpen = (cell: Cell, natures: readonly string[], content: ContentDb): boolean =>
  cell.key !== null &&
  (indexOf(content).keyNatures.get(cell.key) ?? []).some((n) => natures.some((o) => o === n));

/** Resources the village missions doable with `natures` bring in. */
function reachableResources(natures: readonly string[], content: ContentDb): Set<string> {
  const out = new Set<string>();
  for (const m of villageMissions(content)) {
    if (m.resource && missionDoable(m, natures, content)) out.add(m.resource);
  }
  return out;
}

/** Level-6 buildings (those that need resources) whose every resource can be brought in. */
function reachableBuildings(natures: readonly string[], content: ContentDb): string[] {
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
export function natureSetSummary(natures: readonly string[], content: ContentDb): NatureSetSummary {
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
      ids: cells.filter((c) => cellOpen(c, natures, content)).map((c) => c.id),
      total: cells.length,
    },
  };
}

export interface NatureConsequences {
  nature: string;
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
  traits: string[];
  strongAgainst: string;
  weakAgainst: string;
  /** The rival's and Aya's natures if this one were the native nature. */
  rival: string;
  aya: string;
  /** Status combos this nature takes part in: it triggers them or applies the state they need. */
  combos: string[];
}

/**
 * What choosing `nature` means, from the content: the village missions, level-6 buildings and map
 * cells it opens, the enemy traits its techniques answer, its place on the wheel, the team
 * natures that follow from it as the native nature, and its status combos.
 */
export function natureConsequences(
  nature: string,
  state: GameState,
  content: ContentDb,
): NatureConsequences {
  const none: readonly string[] = [];
  const alone: readonly string[] = [nature];
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
  const traits = content.traits.filter((t) => tags.has(t.answer)).map((t) => t.id);
  return {
    nature,
    owned: ownsNature(state, nature),
    native: nativeNature(state) === nature,
    missions,
    buildings,
    cells: natureKeyCells(content)
      .filter((c) => cellOpen(c, alone, content))
      .map((c) => c.id),
    traits,
    strongAgainst: natureBeaten(content, nature),
    weakAgainst: natureBeating(content, nature),
    rival: rivalNatureFor(content, nature),
    aya: ayaNatureFor(content, nature),
    // A combo is joined by the nature that triggers it and by the nature whose techniques apply its state.
    combos: content.combos
      .filter((c) => c.nature === nature || states.has(c.onState))
      .map((c) => c.id),
  };
}
