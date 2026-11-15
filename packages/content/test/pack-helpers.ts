/** Helpers for the pack tests: build small packs and assert that composition fails naming the pack. */
import { expect } from 'vitest';
import { composeContent, type ContentPack, type PackData } from '../src/index.ts';

/** A pack with the given id that depends on `core`, on top of an empty body. */
export const mod = (
  id: string,
  extra: Omit<Partial<ContentPack>, 'data'> & { data?: Record<string, unknown> } = {},
): ContentPack => ({
  manifest: { id, version: '1', dependsOn: ['core'], loadAfter: [] },
  balance: {},
  locales: { uk: {} },
  icons: {},
  patches: [],
  ...extra,
  data: (extra.data ?? {}) as unknown as PackData,
});

/** Asserts that composing `packs` throws an error that names `pack` and matches `message`. */
export const throwsFor = (packs: ContentPack[], pack: string, message: RegExp | string): void => {
  let error: Error | undefined;
  try {
    composeContent(packs);
  } catch (e) {
    error = e as Error;
  }
  expect(error, 'composeContent should throw').toBeDefined();
  expect(error?.message).toContain(pack);
  expect(error?.message).toMatch(message);
};
