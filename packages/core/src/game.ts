import { composeContent, type ContentDb, type ContentPack } from '@shinobi/content';
import { composeRules, defaultRules, PackRulesError, type Rules } from './rules.ts';

/** A pack that was left out of the game and why. */
export interface FailedPack {
  pack: string;
  error: string;
}

export interface Game {
  content: ContentDb;
  rules: Rules;
  /** The packs left out, in the order they failed; the content and the rules describe the rest. */
  failed: FailedPack[];
}

/** The packs that depend, directly or not, on `gone`, and `gone` itself. */
function withDependents(packs: readonly ContentPack[], gone: string): Set<string> {
  const out = new Set([gone]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of packs) {
      if (out.has(p.manifest.id)) continue;
      if (p.manifest.dependsOn.some((d) => out.has(d))) {
        out.add(p.manifest.id);
        grew = true;
      }
    }
  }
  return out;
}

/** The pack an error of `composeContent` names: the longest-named non-core pack whose id the message quotes. */
function packNamedIn(message: string, packs: readonly ContentPack[]): string | undefined {
  const named = packs
    .map((p) => p.manifest.id)
    .filter((id) => id !== 'core' && new RegExp(`(^|[^a-z0-9_])${id}([^a-z0-9_]|$)`).test(message))
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return named[0];
}

/**
 * The one entry point for a host: composes the content and the rules of `packs`. When a pack other
 * than `core` fails in either step it is left out together with the packs that depend on it and the
 * composition is redone without them, so the content and the rules always describe the same set of
 * packs and a broken mod cannot keep the game from starting. A failure of the `core` pack, or one
 * that names no pack, is thrown. Deterministic: the order of \`packs\` does not matter.
 */
export function composeGame(packs: readonly ContentPack[], base: Rules = defaultRules): Game {
  const failed: FailedPack[] = [];
  let current = [...packs];
  for (;;) {
    let culprit: string | undefined;
    let message = '';
    try {
      const content = composeContent(current);
      return { content, rules: composeRules(base, current, content), failed };
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      culprit = error instanceof PackRulesError ? error.pack : packNamedIn(message, current);
      if (culprit === undefined || culprit === 'core') throw error;
    }
    const gone = withDependents(current, culprit);
    failed.push({ pack: culprit, error: message });
    for (const id of [...gone].filter((id) => id !== culprit).sort()) {
      failed.push({ pack: id, error: `depends on the failed pack "${culprit}"` });
    }
    current = current.filter((p) => !gone.has(p.manifest.id));
  }
}
