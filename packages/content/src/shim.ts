import { z } from 'zod';

/**
 * Typing shim. Every vocabulary id is an open string at run time: which ids exist is decided by the
 * composed packs and checked by `composeContent`, not by the schema. The static type stays the old
 * literal union only so that code written before the packs keeps compiling; it is deprecated and
 * goes away with the core and web tasks.
 */
export const open = <T>(schema: z.ZodType): z.ZodType<T> => schema as unknown as z.ZodType<T>;

/** An open id string whose static type is a deprecated literal union. */
export const openId = <T extends string>() => open<T>(z.string().min(1));

/** Keeps the static type of a shape that is open at run time (see `open`): the first argument gives the type, the second runs. */
export const legacy = <T>(_shape: z.ZodType<T>, runtime: z.ZodType): z.ZodType<T> =>
  runtime as unknown as z.ZodType<T>;
