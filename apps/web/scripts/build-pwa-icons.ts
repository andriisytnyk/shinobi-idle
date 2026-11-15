/**
 * Renders the PWA icons from `assets/icon.svg` into `public/icons/`. The mark sits inside the
 * central 80% of the canvas, so the same picture serves as the maskable icon. Run with
 * `pnpm --filter @shinobi/web icons:pwa` and commit the PNGs.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${root}assets/icon.svg`);
const outDir = `${root}public/icons`;

const targets = [
  { file: 'pwa-192.png', size: 192 },
  { file: 'pwa-512.png', size: 512 },
  { file: 'maskable-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

mkdirSync(outDir, { recursive: true });
for (const { file, size } of targets) {
  // The SVG is rasterised at the target size (density scales the 512 px viewBox).
  await sharp(source, { density: (72 * size) / 512 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${outDir}/${file}`);
  console.log(`${file} ${size}x${size}`);
}
