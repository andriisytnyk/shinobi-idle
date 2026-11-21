import { t } from './i18n.ts';

/** The home greeting; a save whose welcome was closed without a name gets the greeting without it. */
export function greeting(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? t('welcome.hello_anonymous') : t('welcome.hello', { name: trimmed });
}
