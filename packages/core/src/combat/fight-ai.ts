import { TRAIT_ANSWER, type TagId, type TraitId } from '@shinobi/content';
import type { CombatAi, Decision, FightView, ViewTechnique } from './fight-types.ts';
import { workOf } from './units.ts';

/** The strongest ready technique among those that pass `test`, or undefined. */
function best(
  view: FightView,
  test: (r: ViewTechnique) => boolean = () => true,
): ViewTechnique | undefined {
  let top: ViewTechnique | undefined;
  for (const r of view.techniques) {
    if (r.ready && test(r) && (!top || r.expected > top.expected)) top = r;
  }
  return top;
}

const tagged = (tag: TagId) => (r: ViewTechnique) => r.tech.tags.includes(tag);

const use = (r: ViewTechnique | undefined): Decision | null =>
  r ? { type: 'technique', id: r.tech.id } : null;

/** The trait whose answer is `tag`. */
const traitOf = (tag: TagId): TraitId =>
  (Object.keys(TRAIT_ANSWER) as TraitId[]).find((t) => TRAIT_ANSWER[t] === tag) ?? 'pack';

/**
 * The default player AI. It reads only the view. It answers a trait the player KNOWS with the
 * technique tagged for it, when that technique is ready and would do something: Interrupt only
 * while a heavy attack is being cast and the cast ends later than this one would, Reveal while
 * hidden, Bind while Evasive works, Pierce while armour is up, burning damage while Regeneration is
 * unchecked, Area when more than one enemy lives. Dispel and Cleanse answer the statuses on the
 * player. Otherwise it casts the ready technique with the highest expected damage (after
 * habituation and the nature wheel), and falls back to the basic attack.
 */
export const defaultCombatAi: CombatAi = (view) => {
  const knows = (trait: TraitId): boolean =>
    view.enemies.some((e) => e.knownTraits.includes(trait));
  const works = (trait: TraitId): boolean =>
    view.enemies.some((e) => e.workingTraits.includes(trait));
  const status = (id: string): boolean => view.player.effects.some((e) => e.id === id);

  // A known caster's wind-up that would end after this technique's cast.
  const casting = view.enemies.filter(
    (e) => e.knownTraits.includes(traitOf('interrupt')) && e.cast,
  );
  const castEndsIn = casting.reduce<number | null>(
    (soonest, e) =>
      e.cast && (soonest === null || e.cast.remaining < soonest) ? e.cast.remaining : soonest,
    null,
  );
  if (castEndsIn !== null) {
    const left = castEndsIn;
    const decision = use(best(view, (r) => tagged('interrupt')(r) && workOf(r.tech.castMs) < left));
    if (decision) return decision;
  }
  if (status('illusion')) {
    const decision = use(best(view, tagged('dispel')));
    if (decision) return decision;
  }
  if (status('poison')) {
    const decision = use(best(view, tagged('cleanse')));
    if (decision) return decision;
  }
  const answers: [TraitId, (r: ViewTechnique) => boolean][] = [
    ['hidden', tagged(TRAIT_ANSWER.hidden)],
    ['evasive', tagged(TRAIT_ANSWER.evasive)],
    ['regen', (r) => tagged('dot')(r) || r.tech.state === 'burn'],
    ['armor', tagged(TRAIT_ANSWER.armor)],
  ];
  for (const [trait, test] of answers) {
    if (!knows(trait) || !works(trait)) continue;
    const decision = use(best(view, test));
    if (decision) return decision;
  }
  if (view.enemies.length > 1) {
    const decision = use(best(view, (r) => r.tech.hitsAll && r.expected > 0));
    if (decision) return decision;
  }
  // An interrupt is kept back for the next heavy attack when it would still be cooling down then.
  const nextCasts = view.enemies
    .filter((e) => e.knownTraits.includes(traitOf('interrupt')) && e.nextCastIn !== null)
    .map((e) => e.nextCastIn ?? 0);
  const soonest = nextCasts.length > 0 ? Math.min(...nextCasts) : null;
  const reserved = (r: ViewTechnique): boolean =>
    soonest !== null &&
    tagged('interrupt')(r) &&
    soonest < workOf(r.tech.cooldownMs + r.tech.castMs);
  const filler = best(view, (r) => r.expected > 0 && !reserved(r));
  return use(filler) ?? { type: 'basic' };
};
