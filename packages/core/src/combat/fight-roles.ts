import type { CloneRole, ContentDb } from '@shinobi/content';
import { fightData } from './fight-data.ts';
import type { KitTechnique } from './fight-types.ts';

/*
 * The roles of the combat clones (`content.cloneRoles`): how the hand of a clone is built from the
 * techniques the character knows. The rule is data (`CloneRole.hand`); this file only reads it. The
 * choice is pure: the same techniques and the same role give the same hand, with no dice.
 */

/** The role a fight falls back to: the one the data marks as the default (a content with none gives `undefined`, the plain copy). */
export const defaultCloneRole = (content: ContentDb): CloneRole | undefined =>
  content.cloneRoles.find((r) => r.default === true);

/** The role with this id; an absent id, or one the content no longer has (a mod was removed), gives the default role. */
export function cloneRoleOf(
  content: ContentDb,
  id: string | null | undefined,
): CloneRole | undefined {
  const own = id ? content.cloneRoles.find((r) => r.id === id) : undefined;
  return own ?? defaultCloneRole(content);
}

/** Whether a role's hand is the character's own. */
export const copiesHand = (role: CloneRole | undefined): boolean =>
  !role || role.hand.mode === 'copy';

/** Whether a technique applies a status (by its tag) or leaves a state (by its data). */
function appliesStatus(content: ContentDb, tech: KitTechnique): boolean {
  if (tech.state !== null) return true;
  const tags = fightData(content).tags;
  return tech.tags.some((tag) => tags.get(tag)?.onHit.some((op) => op.op === 'status'));
}

/** How many combos have a trigger among the other known techniques and wait for the state this technique leaves. */
function combosOpened(
  content: ContentDb,
  tech: KitTechnique,
  known: readonly KitTechnique[],
): number {
  const state = tech.state;
  if (state === null) return 0;
  return fightData(content).combos.filter(
    (combo) =>
      combo.onState === state &&
      known.some(
        (other) =>
          other.id !== tech.id &&
          ((combo.nature !== null && other.skill === combo.nature) ||
            (combo.tag !== null && other.tags.includes(combo.tag))),
      ),
  ).length;
}

/**
 * The hand of a clone under a role that picks: from the `candidates` (what a clone can cast), the
 * `size` that score highest, ties broken by damage and then by id. A figure is read against the best
 * of the candidates, so each lies between 0 and 1. `known` is every technique the character has, which
 * is what the combos are looked for among.
 */
export function pickCloneHand(
  content: ContentDb,
  role: CloneRole,
  candidates: readonly KitTechnique[],
  known: readonly KitTechnique[],
): KitTechnique[] {
  if (role.hand.mode !== 'pick') return [...candidates];
  const { size, weights } = role.hand;
  const bestDamage = Math.max(0, ...candidates.map((t) => t.damage));
  const bestCost = Math.max(0, ...candidates.map((t) => t.cost));
  const opened = candidates.map((t) => combosOpened(content, t, known));
  const bestOpened = Math.max(0, ...opened);
  const scored = candidates.map((tech, i) => {
    const damage = bestDamage > 0 ? tech.damage / bestDamage : 0;
    const cheap = bestCost > 0 ? 1 - tech.cost / bestCost : 0;
    const score =
      weights.damage * damage +
      weights.status * (appliesStatus(content, tech) ? 1 : 0) +
      weights.opens * (bestOpened > 0 ? (opened[i] ?? 0) / bestOpened : 0) +
      weights.cheap * cheap;
    return { tech, score };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.tech.damage - a.tech.damage ||
      (a.tech.id < b.tech.id ? -1 : a.tech.id > b.tech.id ? 1 : 0),
  );
  return scored.slice(0, size).map((s) => s.tech);
}
