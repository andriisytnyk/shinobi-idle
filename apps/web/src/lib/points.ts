import type { Mod } from '@shinobi/content';
import { formatBonus } from './format.ts';
import { hasKey, t } from './i18n.ts';
import { modifierName } from './vocab.ts';

/**
 * The words for a modifier of a point of interest, in parts so that the skill of an XP bonus can be
 * an entity link: «Досвід:» + Тайдзюцу + «+5%». A key with no words of ours is shown by its readable name.
 */
export function modParts(mod: Mod): { label: string; skill: string | null; value: string } {
  const value = mod.op === 'mul' ? `×${mod.value}` : formatBonus(1 + mod.value);
  const xp = /^xp\.skill\.(.+)$/.exec(mod.key);
  if (xp) return { label: t('map.mod.xpSkill'), skill: xp[1] ?? '', value };
  const words = `map.mod.${mod.key}`;
  return { label: hasKey(words) ? t(words) : modifierName(mod.key), skill: null, value };
}
