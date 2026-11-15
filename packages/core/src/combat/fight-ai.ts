import type { TagId } from '@shinobi/content';
import type { CombatAi, Decision, FightView, ReadyTechnique } from './fight-types.ts';
import { WORK_PER_MS, workOf } from './units.ts';

/** The strongest ready technique among those that pass `test`, or undefined. */
function best(
  view: FightView,
  test: (r: ReadyTechnique) => boolean = () => true,
): ReadyTechnique | undefined {
  let top: ReadyTechnique | undefined;
  for (const r of view.ready) {
    if (test(r) && (!top || r.expected > top.expected)) top = r;
  }
  return top;
}

const tagged = (tag: TagId) => (r: ReadyTechnique) => r.tech.tags.includes(tag);

const use = (r: ReadyTechnique | undefined): Decision | null =>
  r ? { kind: 'technique', id: r.tech.id } : null;

/**
 * The default player AI. It answers a trait that is present with the technique tagged for it,
 * when that technique is ready and would do something: Interrupt only while a heavy attack is
 * being cast and the cast ends later than this one would, Reveal while hidden, Bind while Evasive
 * works, Pierce while armour is up, Area when more than one enemy lives, burning damage while
 * Regeneration is unchecked. Otherwise it casts the ready technique with the highest expected
 * damage (after habituation and the nature wheel), and falls back to the basic attack.
 */
export const defaultCombatAi: CombatAi = (view) => {
  if (view.castEndsIn !== null) {
    const castEndsIn = view.castEndsIn;
    const decision = use(
      best(view, (r) => tagged('interrupt')(r) && workOf(r.tech.castMs) < castEndsIn),
    );
    if (decision) return decision;
  }
  if (view.illusion) {
    const decision = use(best(view, tagged('dispel')));
    if (decision) return decision;
  }
  if (view.poisoned) {
    const decision = use(best(view, tagged('cleanse')));
    if (decision) return decision;
  }
  if (view.hidden) {
    const decision = use(best(view, tagged('reveal')));
    if (decision) return decision;
  }
  if (view.evasive) {
    const decision = use(best(view, tagged('bind')));
    if (decision) return decision;
  }
  if (view.regenUnchecked) {
    const decision = use(best(view, (r) => tagged('dot')(r) || r.tech.state === 'burn'));
    if (decision) return decision;
  }
  if (view.armored) {
    const decision = use(best(view, tagged('pierce')));
    if (decision) return decision;
  }
  if (view.enemies.length > 1) {
    const decision = use(best(view, (r) => r.tech.hitsAll && r.expected > 0));
    if (decision) return decision;
  }
  // An interrupt is kept back for the next heavy attack when it would still be cooling down then.
  const reserved = (r: ReadyTechnique): boolean =>
    view.casterAlive &&
    tagged('interrupt')(r) &&
    view.nextCastIn !== null &&
    view.nextCastIn < workOf(r.tech.cooldownMs + r.tech.castMs);
  const filler = best(view, (r) => r.expected > 0 && !reserved(r));
  return use(filler) ?? { kind: 'basic' };
};

/** Work units per ms, re-exported for AIs that compare cast times with `FightView` timers. */
export const AI_WORK_PER_MS = WORK_PER_MS;
