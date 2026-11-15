/**
 * A value the content must hold: the content closure proves it does, so a miss means a database
 * that was not checked, and the fight says what it lacked instead of computing with `NaN`.
 */
export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the content has no ${what}`);
  return value;
}

/** A number of a row of the balance object (`K.techFx.shield`, `K.combo`), by key. */
export function figure(
  row: Readonly<Record<string, number>> | undefined,
  key: string,
  what: string,
): number {
  return need(need(row, what)[key], `${what}.${key}`);
}
