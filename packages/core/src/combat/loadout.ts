import {
  NATURE_IDS,
  NATURE_WHEEL,
  TRAIT_ANSWER,
  type Boss,
  type ContentDb,
  type Enemy,
  type Item,
  type NatureId,
  type Technique,
  type TraitId,
} from '@shinobi/content';
import { addItem } from '../bank.ts';
import { MS_PER_SECOND } from '../formulas.ts';
import type { CommandResult } from '../engine.ts';
import { indexOf } from '../lookup.ts';
import { RANK_ORDER } from '../requirements.ts';
import type { GameState } from '../state.ts';
import { wheelFactor } from './fight.ts';
import { pouchUse } from './fight-items.ts';
import { techniqueFigures, type PlayerSnapshot } from './numbers.ts';
import { ensurePouch, medicTier, refillPouch } from './pouch.ts';
import { knowledgeOf, planningSnapshot } from './snapshot.ts';
import { entryOf, fightTarget } from './zones.ts';

/*
 * The loadout and the pouch as planning. The plans are pure functions of a snapshot, so a bot or
 * a battle analysis can ask for the best loadout against any enemy; the commands apply them to
 * the game state.
 */

/** Slots and distinct natures a loadout may hold at a rank tier; null for a student, who takes everything. */
export interface LoadoutLimits {
  slots: number;
  natures: number;
}

export function loadoutLimits(tier: number, content: ContentDb): LoadoutLimits | null {
  const L = content.balance.K.loadout;
  if (tier >= RANK_ORDER.indexOf('chunin'))
    return { slots: L.slots.chunin, natures: L.natures.chunin };
  if (tier >= RANK_ORDER.indexOf('genin'))
    return { slots: L.slots.genin, natures: L.natures.genin };
  return null;
}

const natureOf = (tech: Technique): NatureId | null =>
  (NATURE_IDS as readonly string[]).includes(tech.skill) ? (tech.skill as NatureId) : null;

const isStance = (tech: Technique): boolean => tech.combat?.effect.kind === 'stance';

const isGuard = (tech: Technique): boolean => {
  const kind = tech.combat?.effect.kind;
  return kind === 'shield' || kind === 'decoy' || kind === 'evasionBuff';
};

/** Whether a technique answers a trait: it carries the answering tag, or burns (which stops Regeneration). */
function answersTrait(tech: Technique, trait: TraitId): boolean {
  return tech.tags.includes(TRAIT_ANSWER[trait]) || (trait === 'regen' && tech.state === 'burn');
}

interface Cand {
  tech: Technique;
  nature: NatureId | null;
  /** Damage per second the technique is expected to add, against the enemy's nature when it has one. */
  score: number;
}

function scoreOf(
  snap: PlayerSnapshot,
  tech: Technique,
  enemy: NatureId | null,
  content: ContentDb,
): number {
  const K = content.balance.K;
  const n = techniqueFigures(snap, tech, content);
  if (!(n.damage > 0)) return 0;
  // An area technique counts as hitting several bodies; burning adds its share on top.
  const bodies =
    tech.role === 'area' || tech.tags.includes('area') || tech.combat?.hitsAll
      ? K.loadout.areaBodies
      : 1;
  const burn = tech.state === 'burn' ? 1 + K.burn.share : 1;
  const seconds = (n.castMs + n.cooldownMs) / MS_PER_SECOND;
  return (
    (n.damage * bodies * burn * wheelFactor(tech.skill, enemy, content)) /
    Math.max(seconds, 1 / MS_PER_SECOND)
  );
}

/** Every subset of `all` with at most `size` members. */
function subsets<T>(all: readonly T[], size: number): T[][] {
  const out: T[][] = [[]];
  const walk = (from: number, taken: T[]): void => {
    if (taken.length >= size) return;
    for (let i = from; i < all.length; i++) {
      const next = [...taken, all[i] as T];
      out.push(next);
      walk(i + 1, next);
    }
  };
  walk(0, []);
  return out;
}

export interface PlanOptions {
  /** The technique that must stay in the loadout (the signature). */
  keep?: string | null;
  /** Traits of the enemy the player knows; the plan carries an answer to each it can. */
  traits?: readonly TraitId[];
  /** The enemy's nature: the wheel favours or spoils the player's natures. */
  nature?: NatureId | null;
  /** Traits whose answer the pouch will carry: a technique that only answers (does no damage) is skipped for them. */
  covered?: ReadonlySet<TraitId>;
}

/**
 * The best loadout the limits allow: answers to the known traits first, then the strongest
 * attacks by expected damage per second, with the natures that give the best total. `limits` null
 * (a student) takes every technique.
 */
export function planLoadout(
  snap: PlayerSnapshot,
  limits: LoadoutLimits | null,
  options: PlanOptions,
  content: ContentDb,
): string[] {
  const index = indexOf(content);
  const enemy = options.nature ?? null;
  const traits = options.traits ?? [];
  const cands: Cand[] = [];
  for (const id of snap.known) {
    const tech = index.techniques.get(id);
    if (!tech || tech.rank === null || tech.combat?.outOfLoadout) continue;
    // Stances cost Wounds: they, and the techniques that need one, are for the player to take by
    // hand, or as the signature (the player has opted in to the price).
    if ((isStance(tech) || tech.combat?.requiresStance) && tech.id !== options.keep) continue;
    cands.push({ tech, nature: natureOf(tech), score: scoreOf(snap, tech, enemy, content) });
  }
  // A signature that needs a stance brings the best stance the player knows.
  let stance: Cand | undefined;
  const signature = cands.find((c) => c.tech.id === options.keep);
  if (signature?.tech.combat?.requiresStance) {
    for (const id of snap.known) {
      const tech = index.techniques.get(id);
      if (
        tech &&
        isStance(tech) &&
        tech.rank !== null &&
        (!stance || tech.level > stance.tech.level)
      ) {
        stance = { tech, nature: natureOf(tech), score: 0 };
      }
    }
    if (stance) cands.push(stance);
  }
  if (!limits) return cands.map((c) => c.tech.id).sort();

  const natures = NATURE_IDS.filter((n) => cands.some((c) => c.nature === n));
  // The signature stays: only the nature sets that include its nature are considered.
  const keepNature = options.keep
    ? (cands.find((c) => c.tech.id === options.keep)?.nature ?? null)
    : null;
  const choices = subsets(natures, limits.natures).filter(
    (s) => keepNature === null || s.includes(keepNature),
  );
  const byScore = (a: Cand, b: Cand) => b.score - a.score || (a.tech.id < b.tech.id ? -1 : 1);
  let bestPlan: { ids: string[]; total: number; size: number } | null = null;

  for (const choice of choices) {
    const pool = cands.filter((c) => c.nature === null || choice.includes(c.nature));
    const chosen: Cand[] = [];
    const add = (c: Cand | undefined): void => {
      if (c && !chosen.includes(c) && chosen.length < limits.slots) chosen.push(c);
    };
    if (options.keep) add(pool.find((c) => c.tech.id === options.keep));
    if (stance) add(pool.find((c) => c.tech === stance?.tech));
    let covered = 0;
    for (const trait of traits) {
      if (chosen.some((c) => answersTrait(c.tech, trait))) {
        covered++;
        continue;
      }
      let answering = pool.filter(
        (c) => answersTrait(c.tech, trait) && !c.tech.combat?.requiresStance,
      );
      // A heavy caster is also met with a guard when nothing interrupts it.
      if (answering.length === 0 && trait === 'caster')
        answering = pool.filter((c) => isGuard(c.tech));
      const pick = answering.sort(byScore)[0];
      // An answer that only answers, when the pouch has a tool for it, leaves its slot to an attack.
      if (!pick || (pick.score <= 0 && options.covered?.has(trait))) continue;
      add(pick);
      covered++;
    }
    for (const c of [...pool].filter((x) => x.score > 0).sort(byScore)) {
      if (chosen.length >= limits.slots) break;
      add(c);
    }
    for (const c of [...pool].filter((x) => isGuard(x.tech)).sort(byScore)) add(c);
    const top = pool.reduce((m, c) => Math.max(m, c.score), 0);
    const total = chosen.reduce((s, c) => s + c.score, 0) + covered * top;
    const ids = chosen.map((c) => c.tech.id).sort();
    const better =
      !bestPlan ||
      total > bestPlan.total ||
      (total === bestPlan.total && choice.length < bestPlan.size);
    if (better) bestPlan = { ids, total, size: choice.length };
  }
  return bestPlan?.ids ?? [];
}

/** The loadout the game builds on its own: the best attacks with the best natures, the signature kept. */
export const autoLoadout = (
  snap: PlayerSnapshot,
  limits: LoadoutLimits | null,
  signature: string | null,
  content: ContentDb,
): string[] => planLoadout(snap, limits, { keep: signature }, content);

// ---------- the pouch ----------

/** Whether an item answers a trait when used from the pouch. */
function itemAnswers(item: Item, trait: TraitId): boolean {
  const use = pouchUse(item);
  switch (trait) {
    case 'caster':
      return (use === 'throw' || use === 'bomb') && item.tags.includes('interrupt');
    case 'pack':
      return use === 'area';
    case 'evasive':
      return use === 'bind';
    case 'regen':
      return use === 'dot';
    case 'illusionist':
      return use === 'dispel';
    case 'poisoner':
      return item.fx?.kind === 'cleanse' && item.fx.statuses.includes('poison');
    default:
      return false;
  }
}

export interface PouchPlanInput {
  bank: Readonly<Record<string, number>>;
  slots: number;
  traits: readonly TraitId[];
  /** Techniques of the loadout: a trait one of them answers needs no tool. */
  loadout: readonly string[];
}

/**
 * What to carry: the strongest healing item first, then a tool for each known trait that no
 * technique of the loadout answers, then a guard against heavy casts, a restoring pill and a
 * throwing tool to fill the rest. Each slot takes a full stack, as far as the bank goes.
 */
export function planPouch(input: PouchPlanInput, content: ContentDb): { id: string; n: number }[] {
  const index = indexOf(content);
  const cap = content.balance.K.pouchStack;
  const owned = content.items.filter((i) => (input.bank[i.id] ?? 0) > 0 && pouchUse(i) !== null);
  const slots: { id: string; n: number }[] = [];
  const take = (item: Item | undefined): void => {
    if (!item || slots.length >= input.slots || slots.some((s) => s.id === item.id)) return;
    slots.push({ id: item.id, n: Math.min(cap, input.bank[item.id] ?? 0) });
  };
  let heal: Item | undefined;
  for (const i of owned) {
    if (pouchUse(i) === 'heal' && i.fx?.kind === 'heal') {
      if (!heal || (heal.fx?.kind === 'heal' && i.fx.hp > heal.fx.hp)) heal = i;
    }
  }
  take(heal);
  const techs = input.loadout
    .map((id) => index.techniques.get(id))
    .filter((t): t is Technique => !!t);
  const toolFor = (trait: TraitId) =>
    owned.find((i) => itemAnswers(i, trait) && pouchUse(i) !== 'sleep');
  // A tool for a trait nothing in the loadout answers first, then a spare for those the loadout answers when its technique is cooling down.
  for (const trait of input.traits)
    if (!techs.some((t) => answersTrait(t, trait))) take(toolFor(trait));
  for (const trait of input.traits) take(toolFor(trait));
  if (input.traits.includes('caster')) {
    take(owned.find((i) => pouchUse(i) === 'bomb' && i.tags.includes('guard')));
  }
  take(owned.find((i) => pouchUse(i) === 'restore'));
  take(owned.find((i) => pouchUse(i) === 'throw'));
  return slots;
}

/**
 * What a plan can use of an enemy entry: the traits the player knows (`known` is the list of
 * trait ids, with `special` for a known boss mechanic), and the nature the entry fights with
 * against a player whose first nature is `first`.
 */
export function planTarget(
  entry: Enemy | Boss,
  known: readonly string[],
  first: NatureId | undefined,
): { traits: TraitId[]; nature: NatureId | null } {
  const traits = entry.traits.filter((t) => known.includes(t));
  // A boss whose mechanic is known and that casts heavily is met like a caster.
  if ('special' in entry && entry.special.kind === 'heavyCast' && known.includes('special')) {
    if (!traits.includes('caster')) traits.push('caster');
  }
  let nature: NatureId | null;
  if (entry.nature === 'wheel') {
    nature = first ? (NATURE_IDS.find((n) => NATURE_WHEEL[n] === first) ?? null) : null;
  } else nature = entry.nature;
  return { traits, nature };
}

/** What the player knows of an entry that a plan can use, from the game state. */
export function targetOf(
  state: GameState,
  entryId: string,
  content: ContentDb,
): { traits: TraitId[]; nature: NatureId | null } | null {
  const entry = entryOf(content, entryId);
  if (!entry) return null;
  const known = knowledgeOf(state, content, [entryId])[entryId] ?? [];
  return planTarget(entry, known, state.player.natures[0]);
}

/**
 * The loadout and the pouch for one enemy from what is known about it, the player's techniques
 * and masteries, and what is in the bank. A pure function of its arguments, for the game and for
 * simulations alike.
 */
export function prepareFor(
  snap: PlayerSnapshot,
  limits: LoadoutLimits | null,
  target: { traits: readonly TraitId[]; nature: NatureId | null },
  bank: Readonly<Record<string, number>>,
  slots: number,
  signature: string | null,
  content: ContentDb,
): { techniques: string[]; pouch: { id: string; n: number }[] } {
  // Traits a tool of the bank can answer, for the loadout to spare a slot for an attack.
  const owned = content.items.filter((i) => (bank[i.id] ?? 0) > 0 && pouchUse(i) !== null);
  const covered = new Set<TraitId>(
    target.traits.filter((t) => owned.some((i) => itemAnswers(i, t) && pouchUse(i) !== 'sleep')),
  );
  const techniques = planLoadout(
    snap,
    limits,
    { keep: signature, traits: target.traits, nature: target.nature, covered },
    content,
  );
  const pouch = planPouch({ bank, slots, traits: target.traits, loadout: techniques }, content);
  return { techniques, pouch };
}

// ---------- commands ----------

const tierOf = (state: GameState): number => RANK_ORDER.indexOf(state.player.rank);

/** Why a list of techniques cannot be a loadout of this player, or null when it can. */
function invalidLoadout(
  state: GameState,
  ids: readonly string[],
  content: ContentDb,
): string | null {
  const limits = loadoutLimits(tierOf(state), content);
  if (!limits) return 'error.noLoadoutYet';
  const index = indexOf(content);
  if (new Set(ids).size !== ids.length) return 'error.duplicateTechnique';
  const natures = new Set<NatureId>();
  for (const id of ids) {
    const tech = index.techniques.get(id);
    if (!tech || !state.known[id] || tech.rank === null) return 'error.unknownTechnique';
    if (tech.combat?.outOfLoadout) return 'error.alwaysAvailable';
    const nature = natureOf(tech);
    if (nature) natures.add(nature);
  }
  if (ids.length > limits.slots) return 'error.tooManyTechniques';
  if (natures.size > limits.natures) return 'error.tooManyNatures';
  return null;
}

/** What the automatic loadout is built from: the rank and how many techniques are known. */
function basisOf(state: GameState, content: ContentDb): string {
  const known = content.techniques.filter((t) => state.known[t.id] && t.rank !== null).length;
  return `${tierOf(state)}:${known}`;
}

function buildAuto(state: GameState, content: ContentDb): string[] {
  const limits = loadoutLimits(tierOf(state), content);
  return limits
    ? autoLoadout(planningSnapshot(state, content), limits, state.loadouts.signature, content)
    : [];
}

/** The invariant: a signature that is set is in the active loadout. */
export function ensureSignature(state: GameState): void {
  const l = state.loadouts;
  if (l.signature !== null && !l.active.includes(l.signature)) l.signature = null;
}

/** Rebuilds the automatic loadout when the rank or the known techniques changed since it was built. */
export function syncLoadout(state: GameState, content: ContentDb): void {
  const l = state.loadouts;
  const basis = basisOf(state, content);
  if (!l.auto || l.basis === basis) return;
  l.basis = basis;
  l.active = buildAuto(state, content);
  ensureSignature(state);
}

/**
 * The loadout a fight starts with. An automatic loadout that went stale (a technique added with no
 * refresh in between) is rebuilt here without touching the state.
 */
export function effectiveLoadout(state: GameState, content: ContentDb): string[] {
  const l = state.loadouts;
  if (!l.auto || l.basis === basisOf(state, content)) return l.active;
  return buildAuto(state, content);
}

export function setLoadout(
  state: GameState,
  ids: readonly string[],
  content: ContentDb,
): CommandResult {
  if (!Array.isArray(ids)) return { ok: false, reason: 'error.invalidLoadout' };
  const reason = invalidLoadout(state, ids, content);
  if (reason) return { ok: false, reason };
  // A manual change ends the automatic loadout; a signature that left the slots is dropped.
  state.loadouts.active = [...ids].sort();
  state.loadouts.auto = false;
  if (state.loadouts.signature && !ids.includes(state.loadouts.signature)) {
    state.loadouts.signature = null;
  }
  return { ok: true };
}

export function setAutoLoadout(state: GameState, on: boolean, content: ContentDb): CommandResult {
  if (typeof on !== 'boolean') return { ok: false, reason: 'error.invalidLoadout' };
  state.loadouts.auto = on;
  if (on) {
    state.loadouts.basis = '';
    syncLoadout(state, content);
  }
  return { ok: true };
}

export function setSignature(
  state: GameState,
  technique: string | null,
  content: ContentDb,
): CommandResult {
  const l = state.loadouts;
  if (technique === null) {
    l.signature = null;
    return { ok: true };
  }
  if (typeof technique !== 'string') return { ok: false, reason: 'error.unknownTechnique' };
  // Any known technique may be the signature, a stance or one that needs a stance included: the
  // player takes the Wound price on. The signature is always in a slot, so a manual loadout
  // must hold it already, and an automatic one is rebuilt around it.
  const tech = indexOf(content).techniques.get(technique);
  if (!tech || tech.rank === null || tech.combat?.outOfLoadout || !state.known[technique]) {
    return { ok: false, reason: 'error.unknownTechnique' };
  }
  if (!l.auto && !l.active.includes(technique)) return { ok: false, reason: 'error.notInLoadout' };
  const mastery = planningSnapshot(state, content).mastery[technique] ?? 1;
  if (mastery < content.balance.K.signature.minMastery) {
    return { ok: false, reason: 'error.masteryTooLow' };
  }
  l.signature = technique;
  if (l.auto) {
    l.basis = '';
    syncLoadout(state, content);
  }
  ensureSignature(state);
  return { ok: true };
}

export function saveLoadout(state: GameState, name: string, content: ContentDb): CommandResult {
  const l = state.loadouts;
  const clean = typeof name === 'string' ? name.trim() : '';
  // A name is a key of an object: nothing that is already a property of every object.
  if (
    clean.length < 1 ||
    clean.length > content.balance.K.loadout.nameMax ||
    /\p{Cc}/u.test(clean) ||
    clean in Object.prototype
  ) {
    return { ok: false, reason: 'error.invalidName' };
  }
  if (tierOf(state) < 1) return { ok: false, reason: 'error.noLoadoutYet' };
  if (!(clean in l.saved) && Object.keys(l.saved).length >= content.balance.K.loadout.saved) {
    return { ok: false, reason: 'error.tooManyLoadouts' };
  }
  l.saved[clean] = { techniques: [...l.active], signature: l.signature };
  return { ok: true };
}

/** A saved loadout of this very name: never a property every object has. */
function savedOf(
  state: GameState,
  name: string,
): GameState['loadouts']['saved'][string] | undefined {
  return Object.hasOwn(state.loadouts.saved, name) ? state.loadouts.saved[name] : undefined;
}

export function loadSavedLoadout(
  state: GameState,
  name: string,
  content: ContentDb,
): CommandResult {
  const saved = typeof name === 'string' ? savedOf(state, name) : undefined;
  if (!saved) return { ok: false, reason: 'error.noSuchLoadout' };
  const result = setLoadout(state, saved.techniques, content);
  if (!result.ok) return result;
  const sig = saved.signature;
  state.loadouts.signature = sig && state.loadouts.active.includes(sig) ? sig : null;
  return result;
}

export function deleteSavedLoadout(state: GameState, name: string): CommandResult {
  if (typeof name !== 'string' || !savedOf(state, name)) {
    return { ok: false, reason: 'error.noSuchLoadout' };
  }
  delete state.loadouts.saved[name];
  return { ok: true };
}

/**
 * Builds the best loadout and pouch for an enemy, boss or zone and makes them the player's. The
 * pouch is repacked from the bank, so this is refused during a fight; the automatic loadout is
 * switched off, like any manual change.
 */
export function prepareLoadout(
  state: GameState,
  encounter: string,
  content: ContentDb,
): CommandResult {
  if (state.combat) return { ok: false, reason: 'error.fighting' };
  const limits = loadoutLimits(tierOf(state), content);
  if (!limits) return { ok: false, reason: 'error.noLoadoutYet' };
  const entry = fightTarget(content, encounter)?.enemy ?? entryOf(content, encounter);
  const target = entry ? targetOf(state, entry.id, content) : null;
  if (!target) return { ok: false, reason: 'error.unknownAction' };
  ensurePouch(state, content);
  // Everything carried goes back to the bank first, so the plan sees all the player owns.
  for (const slot of state.pouch.slots) {
    if (slot.id !== '') addItem(state, slot.id, slot.n);
    slot.id = '';
    slot.n = 0;
  }
  const plan = prepareFor(
    planningSnapshot(state, content),
    limits,
    target,
    state.bank,
    state.pouch.slots.length,
    state.loadouts.signature,
    content,
  );
  state.loadouts.active = plan.techniques;
  state.loadouts.auto = false;
  if (state.loadouts.signature && !plan.techniques.includes(state.loadouts.signature)) {
    state.loadouts.signature = null;
  }
  plan.pouch.forEach((p, i) => {
    const slot = state.pouch.slots[i];
    if (slot) slot.id = p.id;
  });
  refillPouch(state, content);
  // With the medic pouch the first healing slot is emptied on its own.
  const heal = plan.pouch.findIndex((p) => {
    const def = indexOf(content).items.get(p.id);
    return def !== undefined && pouchUse(def) === 'heal';
  });
  state.pouch.medic = heal >= 0 && medicTier(state, content) >= 1 ? heal : null;
  return { ok: true };
}
