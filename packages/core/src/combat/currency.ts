import type { ContentDb } from '@shinobi/content';
import { currencyOf } from '../vocab.ts';

/** What the rules use a currency for when nothing names one: see `currencySchema`. */
export type CurrencyRole = 'money' | 'renown' | 'study';

/**
 * The currency a payment is made in: the one the entry names, else the currency of the content that
 * has the role. The content closure proves every role has one.
 */
export function currencyFor(content: ContentDb, role: CurrencyRole, named?: string): string {
  if (named !== undefined) return named;
  const found = currencyOf(content, role);
  if (found === null) throw new Error(`the content has no currency for the role ${role}`);
  return found;
}
