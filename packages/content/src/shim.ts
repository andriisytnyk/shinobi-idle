import { z } from 'zod';
import type { IdTypes, ShapeTypes } from '@shinobi/content/typing';

/**
 * Static typing of the open vocabularies. Every id is an open string at run time and every record
 * keyed by vocabulary members is an open record: which members exist is decided by the composed
 * packs and checked by `composeContent`, never by the schema. What the schema *says* about them to
 * TypeScript comes from `@shinobi/content/typing` (see `typing/truth.ts` and `typing/legacy.ts`).
 */
export const open = <T>(schema: z.ZodType): z.ZodType<T> => schema as unknown as z.ZodType<T>;

/** An id of the vocabulary `kind`: a non-empty string at run time. */
export const idOf = <K extends keyof IdTypes>(_kind: K): z.ZodType<IdTypes[K]> =>
  z.string().min(1) as unknown as z.ZodType<IdTypes[K]>;

/** A balance record whose keys are vocabulary members: `runtime` runs, `ShapeTypes[kind]` is its static type. */
export const shapeOf = <K extends keyof ShapeTypes>(
  _kind: K,
  runtime: z.ZodType,
): z.ZodType<ShapeTypes[K]> => runtime as unknown as z.ZodType<ShapeTypes[K]>;
