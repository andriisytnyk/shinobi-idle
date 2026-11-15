/**
 * Checks the PWA parts of the production build in `apps/web/dist`. Run after `pnpm build`:
 * `pnpm --filter @shinobi/web pwa:check`. Exits non-zero on the first failed assertion group.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const MAX_PRECACHE_BYTES = 6 * 1024 * 1024;

const errors: string[] = [];
const fail = (message: string) => errors.push(message);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Width and height from the IHDR chunk of a PNG; null when the file is not a PNG. */
function pngSize(path: string): { width: number; height: number } | null {
  const b = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 24 || !b.subarray(0, 8).equals(signature)) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

if (!existsSync(dist)) {
  console.error('apps/web/dist is missing: run `pnpm build` first');
  process.exit(1);
}

// ---------- colours: the ink token of tokens.css ----------

const tokens = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8');
const ink = /--ink-900:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(tokens)?.[1]?.toLowerCase();
if (!ink) fail('--ink-900 not found in tokens.css');
const sameInk = (value: unknown) => typeof value === 'string' && value.toLowerCase() === ink;
const indexHtml = existsSync(join(dist, 'index.html'))
  ? readFileSync(join(dist, 'index.html'), 'utf8')
  : '';
const metaTheme = /<meta\s+name="theme-color"\s+content="([^"]+)"/.exec(indexHtml)?.[1];
if (!sameInk(metaTheme)) fail(`<meta name="theme-color"> is ${metaTheme}, expected ${ink}`);

// ---------- manifest ----------

const manifestPath = join(dist, 'manifest.webmanifest');
if (!existsSync(manifestPath)) {
  fail('manifest.webmanifest is missing');
} else {
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    fail('manifest.webmanifest is not valid JSON');
  }
  const expect = (key: string, value: unknown) => {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(value)) {
      fail(
        `manifest.${key} is ${JSON.stringify(manifest[key])}, expected ${JSON.stringify(value)}`,
      );
    }
  };
  expect('name', 'Shinobi Idle');
  expect('lang', 'uk');
  expect('display', 'standalone');
  expect('orientation', 'any');
  expect('categories', ['games']);
  expect('start_url', './');
  expect('scope', './');
  if (typeof manifest.short_name !== 'string' || !manifest.short_name) fail('manifest.short_name');
  if (typeof manifest.description !== 'string' || !manifest.description) {
    fail('manifest.description');
  }
  if (!sameInk(manifest.theme_color) || !sameInk(manifest.background_color)) {
    fail(`manifest theme_color and background_color must be ${ink}`);
  }
  const icons = (manifest.icons ?? []) as { src: string; sizes: string; purpose?: string }[];
  const wanted = [
    { size: 192, purpose: 'any' },
    { size: 512, purpose: 'any' },
    { size: 512, purpose: 'maskable' },
  ];
  for (const { size, purpose } of wanted) {
    const icon = icons.find(
      (i) => i.sizes === `${size}x${size}` && (i.purpose ?? 'any') === purpose,
    );
    if (!icon) {
      fail(`manifest has no ${purpose} icon of ${size}x${size}`);
      continue;
    }
    const file = join(dist, icon.src);
    if (!existsSync(file)) {
      fail(`icon ${icon.src} is missing on disk`);
      continue;
    }
    const actual = pngSize(file);
    if (!actual) fail(`icon ${icon.src} is not a PNG`);
    else if (actual.width !== size || actual.height !== size) {
      fail(`icon ${icon.src} is ${actual.width}x${actual.height}, declared ${size}x${size}`);
    }
  }
}

// ---------- service worker and precache ----------

const swPath = join(dist, 'sw.js');
if (!existsSync(swPath)) {
  fail('sw.js is missing');
} else {
  const sw = readFileSync(swPath, 'utf8');
  const precached = new Map<string, number>();
  for (const m of sw.matchAll(/url:\s*"([^"]+)"/g)) {
    const url = m[1] ?? '';
    const file = join(dist, url);
    precached.set(url, existsSync(file) ? statSync(file).size : 0);
  }
  if (!precached.has('index.html')) fail('the precache list lacks index.html');
  const shell = walk(dist)
    .map((f) => relative(dist, f).replaceAll('\\', '/'))
    .filter((f) => /\.(js|css|woff2)$/.test(f) && f !== 'sw.js' && !f.startsWith('workbox-'));
  for (const file of shell) {
    if (!precached.has(file)) fail(`the precache list lacks ${file}`);
  }
  if (!shell.some((f) => f.endsWith('.woff2'))) fail('no font files found in the build');
  if (!shell.some((f) => f.endsWith('.js'))) fail('no JS found in the build');
  const total = [...precached.values()].reduce((a, b) => a + b, 0);
  console.log(
    `precache: ${precached.size} entries, ${(total / 1024 / 1024).toFixed(2)} MB (${total} bytes)`,
  );
  if (total > MAX_PRECACHE_BYTES) fail(`the precache is above 6 MB (${total} bytes)`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}
console.log('pwa:check ok');
