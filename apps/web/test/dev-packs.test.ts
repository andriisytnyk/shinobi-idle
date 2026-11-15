// @vitest-environment happy-dom
import { corePack, type ContentPack } from '@shinobi/content';
import { testmodPack } from '@shinobi/content/testmod';
import { describe, expect, it, vi } from 'vitest';
import { testmodUi } from '../dev-packs/testmod-ui.ts';
import { composeBoot, devPacks, requestedPacks, uiPacksFor } from '../src/lib/boot.ts';

/*
 * T4 (the dev side). `?packs=testmod` adds the test packs in the dev build and nothing else does.
 * The production side — the bundle contains no test pack — is `production-build.test.ts`.
 */

describe('?packs= in the dev build (T4)', () => {
  it('reads the ids asked for', () => {
    expect(requestedPacks('')).toEqual([]);
    expect(requestedPacks('?dev=1')).toEqual([]);
    expect(requestedPacks('?packs=testmod')).toEqual(['testmod']);
    expect(requestedPacks('?dev=1&packs=a,b&packs=c')).toEqual(['a', 'b', 'c']);
  });

  it('loads the test packs with their UI packs when they are asked for', async () => {
    expect(import.meta.env.DEV).toBe(true);
    const loaded = await devPacks('?dev=1&packs=testmod');
    expect(loaded.packs.map((p) => p.manifest.id)).toEqual(['testmod']);
    expect(loaded.ui.map((u) => u.id)).toEqual(['testmod']);
    const boot = composeBoot(loaded.packs);
    expect(boot.content.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
  });

  it('loads nothing when they are not asked for, or when the id is unknown', async () => {
    expect(await devPacks('')).toEqual({ packs: [], ui: [], available: {} });
    expect(await devPacks('?packs=other')).toEqual({ packs: [], ui: [], available: {} });
  });

  it('pairs a content pack with the UI pack its `ui` field names, and warns about one that is missing', () => {
    expect(uiPacksFor([corePack, testmodPack], { testmod: testmodUi })).toEqual([testmodUi]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(uiPacksFor([testmodPack], {})).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"testmod"'));
    warn.mockRestore();
  });

  it('does not boot the UI pack of a content pack the core left out, nor of the packs that depend on it', () => {
    const broken: ContentPack = {
      ...testmodPack,
      manifest: { id: 'broken', version: '1.0.0', dependsOn: ['core'], loadAfter: [] },
      ui: 'testmod',
      data: { items: [{ id: 'broken:x', kind: 'no-such-kind' }] } as never,
      balance: {},
      locales: { uk: {} },
      icons: {},
      patches: [],
    };
    const child: ContentPack = {
      ...testmodPack,
      manifest: { id: 'child', version: '1.0.0', dependsOn: ['broken'], loadAfter: [] },
      ui: 'child_ui',
      data: {},
      balance: {},
      locales: { uk: {} },
      icons: {},
      patches: [],
    };
    const boot = composeBoot([broken, child]);
    expect(boot.failed.map((f) => f.pack).sort()).toEqual(['broken', 'child']);
    expect(boot.packs.map((p) => p.manifest.id)).toEqual(['core']);
    const childUi = { id: 'child_ui' };
    expect(uiPacksFor(boot.packs, { testmod: testmodUi, child_ui: childUi })).toEqual([]);
    // A pack that composed keeps its UI pack.
    const fine = composeBoot([testmodPack]);
    expect(uiPacksFor(fine.packs, { testmod: testmodUi })).toEqual([testmodUi]);
  });

  it('composes the production boot from core alone', () => {
    const boot = composeBoot();
    expect(boot.packs.map((p) => p.manifest.id)).toEqual(['core']);
    expect(boot.content.packs.map((p) => p.id)).toEqual(['core']);
    expect(composeBoot()).toBe(boot);
  });
});
