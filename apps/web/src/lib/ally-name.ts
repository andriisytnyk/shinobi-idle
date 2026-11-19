import { allyNameKey } from '@shinobi/core';
import { tryActiveContent } from './active.ts';
import { entityName } from './entities.ts';
import { hasKey, t } from './i18n.ts';

/**
 * The name of a body of the character's side in a fight: what the technique that summoned it calls its bodies (the
 * `allyName` key of the summon, which takes the body's number `n`), else the technique's own name and the number.
 * A body whose kind is unknown (a line kept from before kinds were saved) is a clone, the one ally this game began with.
 */
export function allyName(kind: string | null | undefined, n: number): string {
  if (!kind) return t('fight.ally', { n });
  const content = tryActiveContent();
  const key = content ? allyNameKey(content, kind) : null;
  if (key && hasKey(key)) return t(key, { n });
  return t('fight.allyOf', { name: entityName({ kind: 'technique', id: kind }), n });
}
