/**
 * T5: the core source outside `combat/` (the fight engine belongs to another task) names no skill,
 * nature, rank or currency of the built-in pack as a string literal, and imports none of the
 * deprecated constant lists. The ids are read from the pack data, never written here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeContent, corePack } from '@shinobi/content';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(srcDir, { recursive: true })
  .map(String)
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => f.endsWith('.ts'))
  // The fight engine is another task's; the test pack's rules are test code that names its own ids.
  .filter((f) => !f.startsWith('combat/') && !f.startsWith('testmod/'));

const content = composeContent([corePack]);
const ids = new Map<string, string>();
for (const [kind, list] of [
  ['skill', content.skills],
  ['nature', content.natures],
  ['rank', content.playerRanks],
  ['currency', content.currencies],
] as const) {
  for (const entry of list) ids.set(entry.id, kind);
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

/**
 * The places where an id of the pack may still appear, each with its reason. A line is written
 * `file: literal`; a rule that is about the shape of the code is a regular expression on the line.
 */
const ALLOWED: Record<string, string> = {
  // The deprecated alias of the id of the course action, which is the id of the course skill of the
  // built-in pack: the web app and the sim start the course by this name; the rules read
  // `courseSkill(content)`. Remove with the last reader.
  'athletics.ts: ath':
    'COURSE_ID, the deprecated alias for the code that starts the course by name',
  // `intel` is also a word of the engine: the field of a stage plan that holds the Intel spent to skip
  // a stage, and the kind of a mission payment (`missionPaySchema`). Neither names the currency, which
  // is found by its role (`currencyOf(content, 'study')`).
  'missions/plan.ts: intel':
    'the field intel of a stage plan, an engine word that is not a currency id',
  'missions/run.ts: intel': 'the kind of a mission payment in Intel, an engine word of the schema',
  'missions/select.ts: intel': 'the field intel of a stage plan, an engine word',
};

/** Currency roles share their name with the built-in currency `intel`; the role is not the id. */
const ROLE_CALL = /\b(?:currencyOf|moneyOf)\([^)]*\)/g;

describe('the core source without the fight engine', () => {
  it('has files to scan', () => {
    expect(files).toContain('natures.ts');
    expect(files).toContain('missions/run.ts');
    expect(files).not.toContain('combat/fight.ts');
    expect(ids.size).toBeGreaterThan(20);
  });

  it('names no id of a built-in skill, nature, rank or currency in a string literal', () => {
    const found: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(srcDir + file, 'utf8')).replace(ROLE_CALL, '()');
      for (const m of code.matchAll(
        /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g,
      )) {
        const text = m[1] ?? m[2] ?? m[3] ?? '';
        // A template is checked in its literal parts: `xp.skill.${id}` names no skill.
        for (const part of text.split(/\$\{[^}]*\}/)) {
          const kind = ids.get(part);
          if (kind === undefined) continue;
          if (Object.hasOwn(ALLOWED, `${file}: ${part}`)) continue;
          found.push(`${file}: ${part} (${kind})`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('keeps every allowance justified and in use', () => {
    for (const key of Object.keys(ALLOWED)) {
      const [file, literal] = key.split(': ');
      const code = stripComments(readFileSync(srcDir + (file ?? ''), 'utf8'));
      expect(code, key).toContain(`'${literal}'`);
      expect(ALLOWED[key]?.length ?? 0, key).toBeGreaterThan(20);
    }
  });

  it('imports none of the deprecated constant lists of the content package', () => {
    const deprecated =
      /\b(NATURE_IDS|NATURE_WHEEL|KEY_NATURES|SKILL_IDS|TECH_SKILL_IDS|SKILL_GROUPS|TRAIT_ANSWER|TRAIT_IDS|OPEN_SKILL_IDS|FIGHT_SKILL_IDS|MISSION_RANKS|CELL_KEYS|STATUS_IDS|COMBO_IDS|isModifierKey|MODIFIER_KEYS)\b/;
    const found = files.filter((f) =>
      deprecated.test(stripComments(readFileSync(srcDir + f, 'utf8'))),
    );
    expect(found).toEqual([]);
  });

  it('reads the order of the ranks from the content, except in the one deprecated export', () => {
    const found = files.filter((f) =>
      /\bPLAYER_RANK_IDS\b|\bRANK_ORDER\b/.test(stripComments(readFileSync(srcDir + f, 'utf8'))),
    );
    // `RANK_ORDER` is derived from the pack data for the fight code, which still reads it.
    expect(found).toEqual(['requirements.ts']);
  });
});
