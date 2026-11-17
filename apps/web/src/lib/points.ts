import type { ContentDb, Mod, Payout } from '@shinobi/content';
import { localeKey } from '@shinobi/content';
import { formatBonus, formatInt } from './format.ts';
import { hasKey, t } from './i18n.ts';
import { currencyName, modifierName, moneyName } from './vocab.ts';

/** The words for a modifier of a point of interest: «Досвід: Тайдзюцу +5%». A key with no words of ours is shown by its readable name. */
export function modLine(mod: Mod): string {
  const value = mod.op === 'mul' ? `×${mod.value}` : formatBonus(1 + mod.value);
  const xp = /^xp\.skill\.(.+)$/.exec(mod.key);
  if (xp)
    return `${t('map.mod.xpSkill', { skill: t(localeKey('skill', xp[1] ?? '', 'name')) })} ${value}`;
  const words = `map.mod.${mod.key}`;
  return `${hasKey(words) ? t(words) : modifierName(mod.key)} ${value}`;
}

/** What a payout gave or gives, as one line: ryo, other currencies, items, XP. */
export function payoutLine(payout: Payout, content: ContentDb): string {
  const parts: string[] = [];
  if (payout.ryo !== undefined) parts.push(`${formatInt(payout.ryo)} ${moneyName(content)}`);
  for (const [id, n] of Object.entries(payout.currencies ?? {}))
    parts.push(`${formatInt(n)} ${currencyName(id)}`);
  for (const { item, n } of payout.items ?? [])
    parts.push(`${t(localeKey('item', item, 'name'))} ×${formatInt(n)}`);
  if (payout.xp)
    parts.push(
      t('map.reward.xp', {
        n: formatInt(payout.xp.amount),
        skill: t(localeKey('skill', payout.xp.skill, 'name')),
      }),
    );
  return parts.join(', ');
}
