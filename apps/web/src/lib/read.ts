/**
 * A copy of plain data (arrays and plain objects, recursively) so that a value read from the game
 * state is a new reference whenever it is read. The core mutates its state in place; a `$derived`
 * that returned the same array or object would never notify its readers.
 */
export function detach<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => detach(v)) as T;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) copy[key] = detach(v);
  return copy as T;
}
