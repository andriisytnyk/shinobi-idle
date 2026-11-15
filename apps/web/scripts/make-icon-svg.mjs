// One-off helper kept for provenance: rebuilds assets/icon.svg from the game-icons "shuriken" body.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const set = JSON.parse(
  readFileSync(require.resolve('@iconify-json/game-icons/icons.json'), 'utf8'),
);
const body = set.icons.shuriken.body.replace('currentColor', '#f27a1a');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Mark: "Shuriken" by Lorc, game-icons.net, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Colours: ink-900 and orange of tokens.css. -->
  <rect width="512" height="512" fill="#14161b"/>
  <g transform="translate(76.8 76.8) scale(0.7)">${body}</g>
</svg>
`;
writeFileSync(new URL('../assets/icon.svg', import.meta.url), svg);
writeFileSync(new URL('../public/icon.svg', import.meta.url), svg);
