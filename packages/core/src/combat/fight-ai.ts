import { TRAIT_ANSWER, type AiRuleId, type TagId, type TraitId } from '@shinobi/content';
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

const tagged = (tag: TagId) => (r: ViewTechnique) => r.tech.tags.includes(tag);

const use = (r: ViewTechnique | undefined): Decision | null =>
  r ? { type: 'technique', id: r.tech.id } : null;

/** The first pouch item that passes `test`, as a decision. */
function item(view: FightView, test: (p: ViewPouch) => boolean): Decision | null {
  const found = view.pouch.find((p) => p.n > 0 && test(p));
  return found ? { type: 'item', id: found.id } : null;
}

const status = (view: FightView, id: string): boolean =>
  view.player.effects.some((e) => e.id === id);

/** Whether the tier answers the trait: the player must know it, and a plain tier needs it in plain sight. */
const answers = (view: FightView, trait: TraitId): boolean =>
  view.enemies.some((e) => e.knownTraits.includes(trait)) &&
  (view.ai.answers === 'known' || view.visibleTraits.includes(trait));

const works = (view: FightView, trait: TraitId): boolean =>
  view.enemies.some((e) => e.workingTraits.includes(trait));

/** Soonest end of an interruptible cast under way, or null. */
function interruptibleCast(view: FightView): number | null {
  return view.enemies.reduce<number | null>(
    (soonest, e) =>
      e.cast?.interruptible && (soonest === null || e.cast.remaining < soonest)
        ? e.cast.remaining
        : soonest,
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
  const tech = use(best(view, (r) => tagged('interrupt')(r) && workOf(r.tech.castMs) < left));
  if (tech) return tech;
  // A tool is quicker than any cast, but takes its own action time.
  return item(
    view,
    (p) =>
      p.tags.includes('interrupt') &&
      (p.use === 'throw' || p.use === 'bomb') &&
      view.itemWork < left,
  );
};

const DEFENSES = ['shield', 'decoy', 'evasionBuff'] as const;

const defend: Rule = (view) => {
  // The strongest cast under way that this tier cares about.
  let threat: { remaining: number; total: number } | null = null;
  for (const e of view.enemies) {
    const c = e.cast;
    if (!c || c.mult < view.strongMult) continue;
    if (!threat || c.remaining < threat.remaining) threat = c;
  }
  if (!threat) return null;
  // A plain tier notices a cast only after its reaction delay.
  if (view.ai.defends === 'strongest' && threat.total - threat.remaining < view.reactWork) {
    return null;
  }
  const left = threat.remaining;
  const covered = view.player.ward > 0 || view.player.decoys > 0;
  if (!covered) {
    for (const kind of DEFENSES) {
      const tech = use(best(view, (r) => r.tech.fx.kind === kind && workOf(r.tech.castMs) < left));
      if (tech) return tech;
    }
    return item(view, (p) => p.use === 'bomb' && p.tags.includes('guard') && view.itemWork < left);
  }
  return null;
};

const answer: Rule = (view) => {
  const known = view.ai.answers === 'known';
  if (known) {
    if (status(view, 'illusion')) {
      const decision = use(best(view, tagged('dispel'))) ?? item(view, (p) => p.use === 'dispel');
      if (decision) return decision;
    }
    if (status(view, 'poison')) {
      const decision = use(best(view, tagged('cleanse'))) ?? item(view, (p) => p.use === 'cleanse');
      if (decision) return decision;
    }
    if (status(view, 'bind')) {
      const decision = use(best(view, (r) => r.tech.fx.statuses.includes('bind')));
      if (decision) return decision;
    }
  }
  const byTrait: [TraitId, (r: ViewTechnique) => boolean, (p: ViewPouch) => boolean][] = [
    ['hidden', tagged(TRAIT_ANSWER.hidden), () => false],
    // A bind tool pays only when there is something ready to strike the bound body with.
    [
      'evasive',
      tagged(TRAIT_ANSWER.evasive),
      (p) => p.use === 'bind' && view.techniques.some((r) => r.ready && r.expected > 0),
    ],
    ['regen', (r) => tagged('dot')(r) || r.tech.state === 'burn', (p) => p.use === 'dot'],
    ['armor', tagged(TRAIT_ANSWER.armor), () => false],
  ];
  for (const [trait, test, tool] of byTrait) {
    if (!answers(view, trait) || !works(view, trait)) continue;
    const decision = use(best(view, test)) ?? item(view, tool);
    if (decision) return decision;
  }
  // Several bodies are in plain sight: that needs no knowledge.
  if (view.enemies.length > 1) {
    const decision =
      use(best(view, (r) => r.tech.hitsAll && r.expected > 0)) ??
      item(view, (p) => p.use === 'area');
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
    tagged('interrupt')(r) &&
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
    (e) => e.knownTraits.includes('caster') || e.nextCastIn !== null || e.cast !== null,
  );
  return item(view, (p) => p.use === 'throw' && !(casts && p.tags.includes('interrupt')));
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
