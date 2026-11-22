import type { AiRuleId } from '@shinobi/content';
import { secMs } from './numbers.ts';
import type {
  CombatAi,
  Decision,
  FightView,
  ViewEnemy,
  ViewPouch,
  ViewTechnique,
} from './fight-types.ts';

/*
 * The player AI. It reads only the view. The priority list, and how each rule behaves, come from
 * the content: `view.ai` is the tier that plays (a rank-wise ordered list of rule ids), so a
 * different list gives a different player without touching this file. Each rule below returns a
 * decision, or null to let the next rule of the list speak.
 */

type Rule = (view: FightView) => Decision | null;

/** The strongest ready technique among those that pass `test`, or undefined. */
function best(
  view: FightView,
  test: (r: ViewTechnique) => boolean = () => true,
  score: (r: ViewTechnique) => number = (r) => r.expected,
): ViewTechnique | undefined {
  let top: ViewTechnique | undefined;
  for (const r of view.techniques) {
    if (r.ready && test(r) && (!top || score(r) > score(top))) top = r;
  }
  return top;
}

const use = (r: ViewTechnique | undefined): Decision | null =>
  r ? { type: 'technique', id: r.tech.id } : null;

/** The first pouch item that passes `test`, as a decision. */
function item(view: FightView, test: (p: ViewPouch) => boolean): Decision | null {
  const found = view.pouch.find((p) => p.n > 0 && test(p));
  return found ? { type: 'item', id: found.id } : null;
}

const status = (view: FightView, id: string): boolean =>
  view.player.effects.some((e) => e.id === id);

/** Whether the tier answers the trait: the player must know it (visible traits are known on sight). */
const answers = (view: FightView, trait: string): boolean =>
  view.enemies.some((e) => e.knownTraits.includes(trait));

const works = (view: FightView, trait: string): boolean =>
  view.enemies.some((e) => e.workingTraits.includes(trait));

/** The effect id a status put on a body: the effects after the first are `<id>#<n>`. */
const statusOf = (effect: string): string => effect.split('#')[0] ?? effect;

/** The casts under way that the AI can see when it decides: a cast shows from its start, and the wait is the AI's reaction. */
function noticed(view: FightView): { remaining: number; total: number; interruptible: boolean }[] {
  const out: { remaining: number; total: number; interruptible: boolean }[] = [];
  for (const e of view.enemies) if (e.cast) out.push(e.cast);
  return out;
}

/** Whether an enemy happens to be casting something an interrupt can stop, at the moment the AI decides. */
const interruptibleNow = (view: FightView): boolean => noticed(view).some((c) => c.interruptible);

const heal: Rule = (view) => {
  const medic = view.medic;
  const slot = medic ? view.pouch.find((p) => p.slot === medic.slot) : undefined;
  if (!medic || !slot) return null;
  const low = (now: number, max: number) => now < max * medic.below;
  const p = view.player;
  const needed =
    slot.use === 'heal'
      ? low(p.hp, p.maxHp)
      : slot.use === 'restore' && (low(p.chakra, p.maxChakra) || low(p.stamina, p.maxStamina));
  return needed ? { type: 'item', id: slot.id } : null;
};

/**
 * An interrupting technique, or a tool that interrupts, when an enemy happens to be casting at the
 * moment of the decision. The AI does not plan around when a cast ends: interrupting is a property
 * of the attack, and this is only a preference for it while it can still matter.
 */
const interrupt: Rule = (view) => {
  if (!interruptibleNow(view)) return null;
  const tech = use(best(view, (r) => r.interrupts));
  if (tech) return tech;
  return item(view, (p) => p.interrupts && (p.use === 'throw' || p.use === 'bomb'));
};

/** The effects the traits of the content put on the player are answered with the trait's answer, then the rest by the techniques that take them off. */
const answer: Rule = (view) => {
  for (const { trait, effects } of view.vocab.inflicted) {
    if (!effects.some((effect) => status(view, effect))) continue;
    const decision =
      use(best(view, (r) => r.answers.includes(trait))) ??
      item(view, (p) => p.answers.includes(trait));
    if (decision) return decision;
  }
  for (const effect of view.player.effects) {
    const id = statusOf(effect.id);
    const decision = use(best(view, (r) => r.tech.fx.statuses.includes(id)));
    if (decision) return decision;
  }
  const attackReady = view.techniques.some((r) => r.ready && r.expected > 0);
  for (const trait of view.vocab.answered) {
    if (!answers(view, trait) || !works(view, trait)) continue;
    // A tool that snares pays only when there is something ready to strike the snared body with.
    const decision =
      use(best(view, (r) => r.answers.includes(trait))) ??
      item(view, (p) => p.answers.includes(trait) && (p.use !== 'snare' || attackReady));
    if (decision) return decision;
  }
  // Several bodies are in plain sight: that needs no knowledge.
  if (view.enemies.length > 1) {
    const decision =
      use(best(view, (r) => r.tech.hitsAll && r.expected > 0)) ??
      item(view, (p) => p.use === 'sweep');
    if (decision) return decision;
  }
  return null;
};

const maintain: Rule = (view) => {
  if (view.enemies.length === 0) return null;
  // A stance is worth its stamina and its Wound only for a technique that needs one.
  if (view.stance === null) {
    const wanted = view.techniques.some(
      (r) => r.tech.requiresStance && r.cooldownLeft === 0 && r.affordable,
    );
    if (wanted) {
      const stance = use(
        best(
          view,
          (r) => r.tech.fx.kind === 'stance',
          (r) => r.tech.fx.mult,
        ),
      );
      if (stance) return stance;
    }
  }
  // A timed bonus the pouch carries for the player (a smoke bomb's evasion) is thrown when it is not active and there is something to be hit by.
  const bonus = item(view, (p) => p.selfBonus !== null && !status(view, p.selfBonus));
  if (bonus) return bonus;
  // A technique that puts allies on the player's side is worth it while there is a fight to take them into and none stands.
  if ((view.allies ?? 0) === 0) {
    const summon = use(best(view, (r) => r.tech.fx.kind === 'summon'));
    if (summon) return summon;
  }
  // A hastened cast is worth it only when it saves more time than the buff takes.
  if (!view.hastened) {
    const hasten = best(view, (r) => r.tech.fx.kind === 'nextCast');
    const attack = best(view, (r) => r.expected > 0);
    if (hasten && attack && attack.tech.castMs * (1 - hasten.tech.fx.mult) > hasten.tech.castMs) {
      return use(hasten);
    }
  }
  return null;
};

const signature: Rule = (view) =>
  use(best(view, (r) => r.tech.habituationMult < 1 && r.expected > 0));

const bestAttack: Rule = (view) => {
  const tactical = view.ai.tactical;
  const score = (r: ViewTechnique) =>
    tactical ? r.expected : r.power * (r.tech.hitsAll ? view.enemies.length : 1);
  return use(best(view, (r) => r.expected > 0, score));
};

/**
 * A tool thrown in a gap. A tool that interrupts is kept for the casts of an enemy that has them,
 * and the one thrown here is the plainest.
 */
const filler: Rule = (view) => {
  const casts = view.enemies.some(
    (e) =>
      e.knownTraits.some((t) => view.vocab.casters.includes(t)) ||
      e.nextCastIn !== null ||
      e.cast !== null,
  );
  return item(view, (p) => p.use === 'throw' && !(casts && p.interrupts));
};

const basic: Rule = () => ({ type: 'basic' });

const RULES: Record<AiRuleId, Rule> = {
  heal,
  interrupt,
  answer,
  maintain,
  signature,
  best: bestAttack,
  filler,
  basic,
};

/** The enemy with the least health; the first of them wins a tie. */
const weakest = (list: readonly ViewEnemy[]): ViewEnemy | undefined =>
  list.reduce<ViewEnemy | undefined>((top, e) => (!top || e.hp < top.hp ? e : top), undefined);

/**
 * The enemy whose fall takes the most damage per second off the player's side. For each living
 * enemy the value is the damage per second it deals (what the player has seen of its hits, or what
 * its level promises) over the time the player needs to kill it with the best attack at hand. Killing
 * the leader also ends the damage of the helpers he keeps calling back, so that damage is his; those
 * helpers themselves get no priority while he lives. A tie goes to the weaker body.
 */
function mostValuable(view: FightView): ViewEnemy | undefined {
  // One blow of the best single-target attack, and the time it takes; with no attack at hand, a blow of 1 a second.
  let blow = 1;
  let blowMs = secMs(1);
  let rate = 0;
  for (const r of view.techniques) {
    if (!(r.expected > 0)) continue;
    const hit = r.expected / (r.tech.hitsAll ? Math.max(1, view.enemies.length) : 1);
    const ms = Math.max(1, r.tech.castMs);
    if (hit / ms > rate) {
      rate = hit / ms;
      blow = hit;
      blowMs = ms;
    }
  }
  const leaderUp = view.enemies.some((e) => e.leader);
  const called = view.enemies.reduce((sum, e) => sum + (e.respawns ? e.dps : 0), 0);
  const timeToKill = (e: ViewEnemy): number => Math.max(1, Math.ceil(e.hp / blow)) * blowMs;
  // The fight still to go: the time to take down the bodies that do not come back.
  const horizon = Math.max(
    1,
    view.enemies.reduce((sum, e) => sum + (e.respawns ? 0 : timeToKill(e)), 0),
  );
  let top: ViewEnemy | undefined;
  let topValue = -1;
  for (const e of view.enemies) {
    // A body that is called back while the leader lives is worth the relief its fall gives until it returns.
    const relief = leaderUp && e.respawns ? Math.min(1, (e.respawnMs ?? 0) / horizon) : 1;
    const value = (relief * (e.dps + (e.leader ? called : 0))) / timeToKill(e);
    if (value > topValue || (value === topValue && top !== undefined && e.hp < top.hp)) {
      top = e;
      topValue = value;
    }
  }
  return top;
}

/** The body the target priority of the view names, or undefined to leave the choice to the engine. */
export function chosenTarget(view: FightView): ViewEnemy | undefined {
  if (view.enemies.length < 2 && view.priority !== 'leader') return undefined;
  const leader = view.enemies.find((e) => e.leader);
  const helpers = view.enemies.filter((e) => !e.leader);
  switch (view.priority) {
    case 'weakest':
      return weakest(view.enemies);
    case 'leader':
      return leader;
    case 'adds':
      return leader && helpers.length > 0 ? weakest(helpers) : leader ? leader : mostValuable(view);
    default:
      return mostValuable(view);
  }
}

/** Attacks go to the body the player's target priority names; everything else is left to the engine's choice. */
function aimed(view: FightView, decision: Decision): Decision {
  if (decision.type === 'wait' || decision.target !== undefined) return decision;
  // An area technique strikes every body: it keeps its own rule and is aimed at no one (leader-first has always named the leader).
  if (decision.type === 'technique' && view.priority !== 'leader') {
    const used = view.techniques.find((r) => r.tech.id === decision.id);
    if (used?.tech.hitsAll) return decision;
  }
  const target = chosenTarget(view);
  return target ? { ...decision, target: target.id } : decision;
}

/** Runs the tier's rule list in order; the first rule with a decision wins, the basic attack is the last resort. */
export const defaultCombatAi: CombatAi = (view) => {
  for (const id of view.ai.rules) {
    const decision = RULES[id](view);
    if (decision) return aimed(view, decision);
  }
  return aimed(view, { type: 'basic' });
};
