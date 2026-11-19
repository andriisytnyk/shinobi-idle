import { content as builtIn, corePack, type ContentDb, type ContentPack } from '@shinobi/content';
import { composeGame, defaultRules, type FailedPack, type Rules } from '@shinobi/core';
import { testmodPack } from '@shinobi/core/testmod';

/** The content and the rules a sim run plays on: the packs it was asked for, composed. */
export interface Environment {
  content: ContentDb;
  rules: Rules;
  /** The ids of the packs, in the order they were asked for. */
  packs: string[];
  /** Packs left out because they failed to compose. */
  failed?: FailedPack[];
}

/** The packs the CLI knows by name. Another pack would be added here (or loaded by a later task). */
const KNOWN: ReadonlyMap<string, ContentPack> = new Map([
  ['core', corePack],
  ['testmod', testmodPack],
]);

/** The pack ids a `--packs` value names, or an error text; `core` is always part of the game. */
export function parsePacks(value: string | undefined): string[] | string {
  if (value === undefined) return ['core'];
  const ids = value.split(',').filter((id) => id !== '');
  const unknown = ids.filter((id) => !KNOWN.has(id));
  if (unknown.length > 0) {
    return `--packs: невідомий пакет «${unknown.join(', ')}»; відомі: ${[...KNOWN.keys()].join(', ')}.`;
  }
  if (!ids.includes('core')) return '--packs: пакет core обов’язковий.';
  return [...new Set(ids)];
}

/**
 * Composes the packs into content and rules. The built-in pack alone is the shared `content` and
 * `defaultRules` of the app, so a default run is the one it always was.
 */
export function buildEnvironment(ids: readonly string[] = ['core']): Environment {
  if (ids.length === 1 && ids[0] === 'core') {
    return { content: builtIn, rules: defaultRules, packs: ['core'] };
  }
  const packs = ids.flatMap((id) => {
    const pack = KNOWN.get(id);
    return pack ? [pack] : [];
  });
  // A pack that fails to compose is left out with the packs that depend on it; the run goes on without it.
  const game = composeGame(packs);
  return {
    content: game.content,
    rules: game.rules,
    packs: game.content.packs.map((p) => p.id),
    failed: game.failed,
  };
}
