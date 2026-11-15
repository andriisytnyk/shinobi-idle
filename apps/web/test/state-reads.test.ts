import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The text of every `$derived(...)` and `$derived.by(...)` call, with balanced parentheses. */
function derivedCalls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$derived(?:\.by)?\(/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) {
        out.push(text.slice(open + 1, i));
        break;
      }
    }
  }
  return out;
}

describe('reading the game state in components', () => {
  // The core changes its state in place. A `$derived` that returns a piece of it (an array, an
  // object) hands back the same reference and never notifies its readers, so every read inside a
  // `$derived` goes through `game.read`, which copies what it returns.
  const files = walk(src).filter((f) => f.endsWith('.svelte'));
  for (const file of files) {
    it(`${relative(src, file).replaceAll('\\', '/')} reads game.state in $derived only through game.read`, () => {
      const bad = derivedCalls(readFileSync(file, 'utf8')).filter((call) => {
        // Whatever is outside the `game.read(...)` call must not touch the state or the log.
        const outside = call.replace(/game\.read\(/g, '');
        return /game\.(state|combatLog)\b/.test(outside);
      });
      expect(bad).toEqual([]);
    });
  }
});
