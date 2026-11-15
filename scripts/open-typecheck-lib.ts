/**
 * The pure part of `pnpm typecheck:open`: reading compiler output and deciding which diagnostics
 * fall inside a folder that has been migrated to the truthful types of @shinobi/content.
 */

export interface Diagnostic {
  /** Repo-relative path with forward slashes. */
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

/** A path with forward slashes, no `./` prefix and no trailing slash, whatever platform wrote it. */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/**
 * `file` made relative to `base` (both may use either separator and a drive letter, which is
 * compared case-insensitively); a file outside `base` keeps its `../` prefix.
 */
export function relativeTo(base: string, file: string): string {
  const b = normalizePath(base).split('/');
  const f = normalizePath(file).split('/');
  let i = 0;
  const same = (x: string | undefined, y: string | undefined) =>
    x !== undefined &&
    y !== undefined &&
    (x === y || (i === 0 && x.toLowerCase() === y.toLowerCase()));
  while (i < b.length && i < f.length && same(b[i], f[i])) i++;
  return [...b.slice(i).map(() => '..'), ...f.slice(i)].join('/');
}

/** Whether `file` is `folder` or inside it. Both are repo-relative, with either separator. */
export function isInFolder(file: string, folder: string): boolean {
  const f = normalizePath(file);
  const d = normalizePath(folder);
  return d !== '' && (f === d || f.startsWith(`${d}/`));
}

/**
 * An entry of `open-typecheck.json`: a repo-relative folder or file, or a folder with parts of it
 * left out (`exclude`: folders or files relative to it, which another task migrates later).
 */
export type MigratedEntry = string | { path: string; exclude?: readonly string[] };

/** The repo-relative folder or file an entry names. */
export const entryPath = (entry: MigratedEntry): string =>
  typeof entry === 'string' ? entry : entry.path;

/** Whether `file` is covered by the entry: inside its path and in none of its excluded parts. */
export function isInEntry(file: string, entry: MigratedEntry): boolean {
  const path = entryPath(entry);
  if (!isInFolder(file, path)) return false;
  const exclude = typeof entry === 'string' ? [] : (entry.exclude ?? []);
  return !exclude.some((part) => isInFolder(file, `${normalizePath(path)}/${normalizePath(part)}`));
}

export function isInMigrated(file: string, migrated: readonly MigratedEntry[]): boolean {
  return migrated.some((entry) => isInEntry(file, entry));
}

/** The folder a file lives in: the directory of the file, repo-relative. */
export function folderOf(file: string): string {
  const parts = normalizePath(file).split('/');
  parts.pop();
  return parts.join('/');
}

/**
 * `tsc` output: `path(line,col): error TS1234: message`. `cwd` is where the compiler ran and `root`
 * the repo root: paths are made repo-relative.
 */
export function parseTsc(output: string, cwd: string, root: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (!m) continue;
    out.push({
      file: relativeTo(root, `${normalizePath(cwd)}/${normalizePath(m[1] ?? '')}`),
      line: Number(m[2]),
      column: Number(m[3]),
      code: m[4] ?? '',
      message: m[5] ?? '',
    });
  }
  return out;
}

/** `svelte-check --output machine`: `<ts> ERROR "path" line:col "message"`. */
export function parseSvelteCheck(output: string, cwd: string, root: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^\d+ ERROR "(.+?)" (\d+):(\d+) "(.*)"$/.exec(line);
    if (!m) continue;
    out.push({
      file: relativeTo(root, `${normalizePath(cwd)}/${normalizePath(m[1] ?? '')}`),
      line: Number(m[2]),
      column: Number(m[3]),
      code: 'svelte-check',
      message: m[4] ?? '',
    });
  }
  return out;
}

/** The same diagnostic can be reported by two programs (core's files are part of sim's and the app's). */
export function dedupe(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((d) => {
    const key = `${d.file}:${d.line}:${d.column}:${d.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Number of diagnostics per folder, most first. */
export function countByFolder(diagnostics: readonly Diagnostic[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const d of diagnostics) {
    const folder = folderOf(d.file);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

export interface Verdict {
  ok: boolean;
  messages: string[];
}

/**
 * The verdict of the gate. `errors` are all diagnostics against the truthful types (deduplicated),
 * `mappingExists` whether tsconfig.legacy-ids.json is still there.
 */
export function judge(
  errors: readonly Diagnostic[],
  migrated: readonly MigratedEntry[],
  mappingExists: boolean,
  folderExists: (folder: string) => boolean = () => true,
): Verdict {
  const messages: string[] = [];
  for (const entry of migrated) {
    const path = entryPath(entry);
    if (!folderExists(path))
      messages.push(`open-typecheck.json lists "${path}", which does not exist`);
    else if (typeof entry !== 'string')
      for (const part of entry.exclude ?? [])
        if (!folderExists(`${normalizePath(path)}/${normalizePath(part)}`))
          messages.push(`open-typecheck.json excludes "${path}/${part}", which does not exist`);
  }
  const inside = errors.filter((e) => isInMigrated(e.file, migrated));
  if (inside.length > 0)
    messages.push(
      `${inside.length} error(s) in migrated folders:\n${inside
        .slice(0, 20)
        .map((e) => `  ${e.file}(${e.line},${e.column}) ${e.code}: ${e.message}`)
        .join('\n')}`,
    );
  if (errors.length === 0 && mappingExists)
    messages.push(
      'no error is left against the truthful types: delete tsconfig.legacy-ids.json, the `extends` entries that name it, the tsconfig.truth.json files and the `typecheck:open` step',
    );
  if (errors.length > 0 && !mappingExists)
    messages.push(
      `tsconfig.legacy-ids.json is gone but ${errors.length} error(s) remain against the truthful types: the folders that are not clean were never migrated`,
    );
  return { ok: messages.length === 0, messages };
}
