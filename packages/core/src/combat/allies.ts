import type { ContentDb } from '@shinobi/content';

/*
 * The numbers of the combat clones' own earnings, from the row of the clone technique in `K.techFx`
 * (the bots tune them): `xpShare` is the rate at which a body earns XP and Mastery by its own actions
 * (with several bodies this can multiply combat XP per hour), `passShare` the share of it that passes
 * to the character when the body leaves the fight (the knowledge handed over; 0 hands over nothing).
 */
const rowOf = (content: ContentDb): Record<string, number> =>
  (content.balance.K.techFx as Record<string, Record<string, number> | undefined>).combatClone ??
  {};

export const xpShareOf = (content: ContentDb): number => rowOf(content).xpShare ?? 1;
export const passShareOf = (content: ContentDb): number => rowOf(content).passShare ?? 1;
