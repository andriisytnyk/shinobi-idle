import type { AiRuleId } from '@shinobi/content';
import type { CombatAi, Decision, FightView, ViewPouch, ViewTechnique } from './fight-types.ts';
import { workOf } from './units.ts';

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

/**
 * The casts under way that the tier answers: those it knows to be heavy (or every cast, at the
 * tier that sees them all). The tier decides only when its wait ends, which is its reaction.
 */
function noticed(view: FightView): { remaining: number; total: number; interruptible: boolean }[] {
  const out: { remaining: number; total: number; interruptible: boolean }[] = [];
  for (const e of view.enemies) {
    const c = e.cast;
    if (!c || (!view.ai.tactical && !c.known)) continue;
    out.push(c);
  }
  return out;
}

/** Soonest end of an interruptible cast that the tier has noticed, or null. */
function interruptibleCast(view: FightView): number | null {
  return noticed(view).reduce<number | null>(
    (soonest, c) =>
      c.interruptible && (soonest === null || c.remaining < soonest) ? c.remaining : soonest,
    null,
  );
}

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

const interrupt: Rule = (view) => {
  const left = interruptibleCast(view);
  if (left === null) return null;
  const tech = use(best(view, (r) => r.interrupts && workOf(r.tech.castMs) < left));
  if (tech) return tech;
  // A tool is quicker than any cast, but takes its own action time.
  return item(
    view,
    (p) => p.interrupts && (p.use === 'throw' || p.use === 'bomb') && view.itemWork < left,
  );
};

const DEFENSES = ['shield', 'decoy', 'evasionBuff'] as const;

const defend: Rule = (view) => {
  // The strongest cast under way that this tier cares about.
  let threat: { remaining: number; total: number } | null = null;
  for (const c of noticed(view)) if (!threat || c.remaining < threat.remaining) threat = c;
  if (!threat) return null;
  const left = threat.remaining;
  const covered = view.player.ward > 0 || view.player.decoys > 0;
  if (!covered) {
    for (const kind of DEFENSES) {
      const tech = use(best(view, (r) => r.tech.fx.kind === kind && workOf(r.tech.castMs) < left));
      if (tech) return tech;
    }
    return item(view, (p) => p.use === 'bomb' && p.guard && view.itemWork < left);
  }
  return null;
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
  // A spare guard while health is falling: a shield, then a decoy, then the evasion buff.
  if (view.player.hp < view.player.maxHp * view.guardBelow) {
    const p = view.player;
    const wards: [string, boolean][] = [
      ['shield', p.ward <= 0],
      ['decoy', p.decoys <= 0],
      ['evasionBuff', !status(view, 'evasionBuff')],
    ];
    for (const [kind, missing] of wards) {
      if (!missing) continue;
      const decision = use(best(view, (r) => r.tech.fx.kind === kind));
      if (decision) return decision;
    }
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
  // A tactical tier keeps an interrupt back for the next heavy cast when it would still be cooling down then.
  const nextCasts = view.enemies.flatMap((e) => (e.nextCastIn === null ? [] : [e.nextCastIn]));
  const soonest = nextCasts.length > 0 ? Math.min(...nextCasts) : null;
  const reserved = (r: ViewTechnique): boolean =>
    tactical &&
    soonest !== null &&
    r.interrupts &&
    soonest < workOf(r.tech.cooldownMs + r.tech.castMs);
  const score = (r: ViewTechnique) =>
    tactical ? r.expected : r.power * (r.tech.hitsAll ? view.enemies.length : 1);
  return use(best(view, (r) => r.expected > 0 && !reserved(r), score));
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
  defend,
  answer,
  maintain,
  signature,
  best: bestAttack,
  filler,
  basic,
};

/** Attacks go to the body the fight turns on, when there is one; everything else is left to the engine's choice. */
function aimed(view: FightView, decision: Decision): Decision {
  const leader = view.enemies.find((e) => e.leader);
  if (!leader || decision.type === 'wait' || decision.target !== undefined) return decision;
  return { ...decision, target: leader.id };
}

/** Runs the tier's rule list in order; the first rule with a decision wins, the basic attack is the last resort. */
export const defaultCombatAi: CombatAi = (view) => {
  for (const id of view.ai.rules) {
    const decision = RULES[id](view);
    if (decision) return aimed(view, decision);
  }
  return aimed(view, { type: 'basic' });
};
