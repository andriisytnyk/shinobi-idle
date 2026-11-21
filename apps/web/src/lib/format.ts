import { t } from './i18n.ts';

const integer = new Intl.NumberFormat('uk', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('uk', { maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat('uk', { maximumFractionDigits: 2 });

/** Whole number with Ukrainian digit grouping. */
export function formatInt(n: number): string {
  return integer.format(n);
}

/** XP-style figure: no decimals from 100 up, one decimal below. */
export function formatXp(n: number): string {
  return n >= 100 ? integer.format(n) : oneDecimal.format(n);
}

/** A multiplier or a base amount with up to two decimals, e.g. `1,15`. */
export function formatFactor(n: number): string {
  return twoDecimals.format(n);
}

/** A bonus factor as a signed percent: 1.1 gives `+10%`, 0.95 gives `−5%`. */
export function formatBonus(factor: number): string {
  const pct = Math.round((factor - 1) * 1000) / 10;
  const text = oneDecimal.format(Math.abs(pct));
  return `${pct < 0 ? '−' : '+'}${text}%`;
}

/** Seconds with one decimal, e.g. `4,5 с`. */
export function formatSeconds(ms: number): string {
  return t('format.seconds', { n: oneDecimal.format(ms / 1000) });
}

/**
 * A span as hours, minutes and seconds, the two largest units, e.g. `2 год 5 хв` or `3 хв 30 с`:
 * under an hour the seconds are kept, so a shown time is the time the span really takes.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0)
    return m > 0
      ? `${t('format.hours', { n: h })} ${t('format.minutes', { n: m })}`
      : t('format.hours', { n: h });
  if (m > 0)
    return s > 0
      ? `${t('format.minutes', { n: m })} ${t('format.seconds', { n: s })}`
      : t('format.minutes', { n: m });
  return t('format.seconds', { n: s });
}
