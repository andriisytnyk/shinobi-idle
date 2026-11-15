import { composeContent } from './compose.ts';
import { corePack } from './packs/core/index.ts';
import type { ContentDb } from './schema.ts';

/**
 * The validated content database of the app: the built-in pack `core`, composed exactly as a mod
 * would be. Packs other than `core` are composed with `composeContent([corePack, ...])`.
 */
export const content: ContentDb = composeContent([corePack]);

/** Ukrainian strings: generated entity names and descriptions plus hand-written content descriptions and UI strings. Hand-written content texts win over generated ones. */
export const ukLocale: Readonly<Record<string, string>> = content.locales.uk;

/** English technique names (canonical). Not used by the UI, which reads Ukrainian only. */
export const enLocale: Readonly<Record<string, string>> = content.locales.en;

export { composeContent, ENTITY_LISTS, ownsId } from './compose.ts';
export { validateClosure, type ClosureProblem } from './closure.ts';
export { corePack } from './packs/core/index.ts';
export type {
  ContentPack,
  EntityListKey,
  PackData,
  PackBalance,
  PackRules,
  Patch,
  PatchTarget,
} from './pack.ts';
export * from './constants.ts';
export * from './icons.ts';
export * from './keys.ts';
export * from './modifiers.ts';
export * from './overlay.ts';
export * from './overlay-missions.ts';
export * from './schema.ts';
