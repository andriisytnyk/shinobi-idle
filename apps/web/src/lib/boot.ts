import { corePack, type ContentDb, type ContentPack } from '@shinobi/content';
import { composeGame, type FailedPack, type Rules } from '@shinobi/core';
import type { UiPack } from './ext/types.ts';

/*
 * The boot module: the only place of the app that names the packs of a boot and composes them.
 * Everything else reads `game.content`. Production boots the pack `core` alone; the dev build can
 * add the test packs with `?packs=testmod` (a dynamic import that the production bundle does not
 * contain).
 */

export interface Boot {
  /** The content packs of this boot, `core` first. */
  packs: readonly ContentPack[];
  content: ContentDb;
  rules: Rules;
  /** Packs the core left out because they failed to compose, with the reason. */
  failed: readonly FailedPack[];
}

/** Composes the content of `core` and these packs, and the rules that go with them. */
export function composeBoot(extra: readonly ContentPack[] = []): Boot {
  if (extra.length === 0 && coreOnly) return coreOnly;
  const game = composeGame([corePack, ...extra]);
  // A pack the core left out is not part of this boot.
  const left = new Set(game.failed.map((f) => f.pack));
  const packs = [corePack, ...extra].filter((p) => !left.has(p.manifest.id));
  const boot: Boot = { packs, content: game.content, rules: game.rules, failed: game.failed };
  if (extra.length === 0) coreOnly = boot;
  return boot;
}

/** The boot of `core` alone is composed once: composing validates the whole content. */
let coreOnly: Boot | null = null;

/**
 * The UI packs that go with content packs: for every pack that names one in its `ui` field, the
 * UI pack of that id from `available`. A named UI pack that is not available is skipped with a
 * warning; the content of the pack still shows through the generic pages.
 */
export function uiPacksFor(
  packs: readonly ContentPack[],
  available: Readonly<Record<string, UiPack>>,
): UiPack[] {
  const out: UiPack[] = [];
  for (const pack of packs) {
    if (pack.ui === undefined) continue;
    const ui = Object.hasOwn(available, pack.ui) ? available[pack.ui] : undefined;
    if (ui) out.push(ui);
    else
      console.warn(
        `Content pack "${pack.manifest.id}" names the UI pack "${pack.ui}", which is not loaded`,
      );
  }
  return out;
}

export interface DevPacks {
  packs: ContentPack[];
  ui: UiPack[];
  /** The UI packs that were loaded, by id: what `uiPacksFor` pairs the packs of a boot with. */
  available: Record<string, UiPack>;
}

/** The ids asked for with `?packs=a,b` (repeated parameters add up). */
export function requestedPacks(search: string): string[] {
  return new URLSearchParams(search)
    .getAll('packs')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/**
 * The test packs a developer asked for with `?packs=testmod`, with their UI packs. In a production
 * build this is always empty and the code that loads them is not in the bundle.
 */
export async function devPacks(search: string): Promise<DevPacks> {
  const none: DevPacks = { packs: [], ui: [], available: {} };
  if (!import.meta.env.DEV) return none;
  if (!requestedPacks(search).includes('testmod')) return none;
  const [{ testmodPack }, { testmodUi }] = await Promise.all([
    import('@shinobi/core/testmod'),
    import('../../dev-packs/testmod-ui.ts'),
  ]);
  const available = { testmod: testmodUi };
  return { packs: [testmodPack], ui: uiPacksFor([testmodPack], available), available };
}
