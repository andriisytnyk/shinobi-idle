/** A parsed command line: the value options, the flags, and what could not be understood. */
export interface ParsedArgs {
  values: Record<string, string>;
  flags: Set<string>;
  errors: string[];
}

/** Splits `--name value` options and `--flag` switches; anything not named in `values` or `flags` is an error. */
export function parseArgs(
  args: readonly string[],
  values: readonly string[],
  flags: readonly string[],
): ParsedArgs {
  const out: ParsedArgs = { values: {}, flags: new Set(), errors: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const name = arg.startsWith('--') ? arg.slice(2) : null;
    if (name !== null && flags.includes(name)) out.flags.add(name);
    else if (name !== null && values.includes(name)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        out.errors.push(`--${name} потребує значення.`);
      } else {
        out.values[name] = value;
        i++;
      }
    } else out.errors.push(`Невідомий аргумент «${arg}».`);
  }
  return out;
}

/** A whole number of at least `min`, or null when the option is malformed; `fallback` when absent. */
export function wholeValue(
  parsed: ParsedArgs,
  name: string,
  fallback: number,
  min = 1,
): number | null {
  const raw = parsed.values[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : null;
}
