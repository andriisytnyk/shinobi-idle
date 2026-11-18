import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * R1, by construction: an attribute of an HTML element (`data-*`, `id`, `for`, `href`, `aria-*`) that
 * is built from the id of an entity must go through `entityAttr` / `idAttr` (they return nothing for
 * an entity the player has not discovered) or `hrefFor`. A new component that writes a raw id cannot
 * get in unless it is listed below, with the reason why the entity can never be hidden there.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return svelteFiles(path);
    return path.endsWith('.svelte') ? [path] : [];
  });
}

// An expression in braces may hold a template literal with its own `${...}`: one level of nested braces is read.
const BRACED = String.raw`\{((?:[^{}]|\{[^{}]*\})*)\}`;
const ATTR = new RegExp(
  String.raw`(?<![\w:-])(data-[\w-]+|id|for|href|aria-[\w-]+)=(?:"([^"]*\{[^"]*)"|${BRACED})`,
  'g',
);
/** What an expression has to mention to count as the id of an entity. */
const IDISH =
  /\.id\b|\.item\b|\.ref\b|\bid\b|\bitem\b|\bgood\b|\bkey\b|\bregion\b|\bzone\b|\bmission\b|\benemy\b/;
const SAFE = /entityAttr\(|idAttr\(|hrefFor\(|\bt\(/;
const TAG = new RegExp(String.raw`<([a-z][\w:-]*)((?:"[^"]*"|'[^']*'|${BRACED}|[^>"'{}])*)>`, 'g');

interface Hit {
  where: string;
  attr: string;
}

/** The attributes of one source that are built from an id without a reveal helper. */
function scan(raw: string): { tag: string; attr: string }[] {
  const out: { tag: string; attr: string }[] = [];
  const source = raw.replace(/<style[\s\S]*?<\/style>/g, '');
  for (const tag of source.matchAll(TAG)) {
    for (const m of (tag[2] ?? '').matchAll(ATTR)) {
      const expr = m[2] ?? m[3] ?? '';
      if (SAFE.test(expr) || !IDISH.test(expr)) continue;
      out.push({ tag: tag[1] ?? '', attr: `${m[1]}=${m[0].slice((m[1] ?? '').length + 1)}` });
    }
  }
  return out;
}

function hits(): Hit[] {
  return svelteFiles(SRC).flatMap((file) =>
    scan(readFileSync(file, 'utf8')).map((h) => ({
      where: `${relative(SRC, file).replaceAll('\\', '/')} <${h.tag}>`,
      attr: h.attr,
    })),
  );
}

/** Files whose raw ids are fine, and why: the entity cannot be hidden where the id is written. */
const ALLOWED: Record<string, string> = {
  'components/CloneRolePicker.svelte': 'roles of the clones have no reveal rule: all are shown',
  'components/Breadcrumb.svelte':'navigation links of a page, not entities',
  'components/BuffStrip.svelte': 'a running tonic: the player has held it',
  'components/BuildingCard.svelte': 'buildings have no reveal rule: always shown',
  'components/BuildingNeed.svelte': 'buildings: always shown',
  'sheets/BuildingSheet.svelte': 'buildings: always shown',
  'components/HexPanel.svelte':
    'the cell and its points come from the hex view, which names them only once the hex is surveyed; a place is a hex fact, not an entity',
  'components/ZoneWhere.svelte': 'a zone is listed only when its cell is explored',
  'components/CoursePanel.svelte': 'obstacles: always shown',
  'components/Fighter.svelte': 'a flag of the fight (is the enemy aimed at), not an id',
  'components/ReqTree.svelte': 'the id is written only when the entity is shown (nameShown)',
  'components/Hint.svelte': 'a hint id is a text id, not an entity',
  'pages/HelpPage.svelte': 'a hint id is a text id, not an entity',
  'components/MainNav.svelte': 'navigation items, not entities',
  'components/TabBar.svelte': 'navigation items, not entities',
  'pages/MorePage.svelte': 'navigation items, not entities',
  'components/MeditationPanel.svelte': 'practices and modifier references: always shown',
  'components/ModParts.svelte': 'modifier keys, not entities',
  'components/MissionCard.svelte': 'a card is a mission of the board: shown at least by name',
  'components/MissionStage.svelte':
    'a stage of a mission whose page is open: the mission is shown at least by name',
  'pages/MissionPage.svelte': 'the page opens for a mission shown at least by name',
  'components/NowMission.svelte': 'a mission that runs: the player started it',
  'components/PinGoal.svelte': 'the pin is not drawn for a hidden entity (nameShown)',
  'components/PoolBar.svelte': 'pool checkpoints of a skill: skills are always shown',
  'components/RaidPanel.svelte':
    'a raid is not an entity with a reveal rule: it is shown once the story has called it, and its links go to buildings',
  'components/RevealGate.svelte': 'the name-only branch only: the hidden branch writes no id',
  'components/RewardList.svelte': 'currencies: always shown',
  'components/SkillList.svelte': 'skills: always shown',
  'components/ToastHost.svelte': 'the number of a toast, not an entity',
  'components/TopBar.svelte': 'currencies: always shown',
  'lib/ext/PageHost.svelte': 'the key of a page, not an entity',
  'lib/ext/WidgetHost.svelte': 'the key of a widget, not an entity',
  'pages/BankPage.svelte': 'the bank lists what the player holds',
  'components/ShopSell.svelte': 'the sell list holds only what the player holds',
  'pages/CombatPage.svelte':
    'an enemy is listed only when it is shown by name (open zone); the fight is the one being fought',
  'pages/EntityPage.svelte': 'drawn after the gate: the entity is shown in full',
  'sheets/GearSheet.svelte': 'drawn after the gate: the entity is shown at least by name',
  'sheets/ItemSheet.svelte': 'drawn after the gate: the entity is shown in full',
  'sheets/RecipeSheet.svelte': 'drawn after the gate: the entity is shown in full',
  'pages/SkillPage.svelte': 'skills: always shown',
  'sheets/TechniqueSheet.svelte': 'techniques: always shown',
  'pages/QuestsPage.svelte': 'the journal lists chains that have started',
  'pages/RankPage.svelte': 'exams and ranks: always shown',
  'pages/SettingsPage.svelte': 'packs and settings, not entities',
  'pages/ShopPage.svelte': 'section and currency ids, not entities',
  'pages/VillagePage.svelte': 'village resources: always shown',
  'components/GearLine.svelte':
    'the why-text ids of a gear line: a line is offered by its skill page (at least by name)',
  'components/HerbTile.svelte':
    'the why-text id of a herb tile: offered by its skill page (at least by name)',
  'components/RecipeTile.svelte':
    'the why-text id of a recipe tile: offered by its skill page (at least by name)',
  'components/MissionRation.svelte':
    'the why-text id of a ration item the mission takes (named by the mission)',
};

describe('attributes built from an entity id go through the reveal helpers (R1)', () => {
  it('sees an id inside a template literal, and lets the helpers through', () => {
    expect(scan('<li data-entity={`item:${id}`}>')).toHaveLength(1);
    expect(scan('<li data-entity={`item:${row.id}`} class="x">')).toHaveLength(1);
    expect(scan('<li data-entity={entityAttr({ kind: "item", id })}>')).toHaveLength(0);
    expect(scan('<li data-entity={`item:${entityAttr(x)}`}>')).toHaveLength(0);
  });

  it('writes no raw id into an attribute of an HTML element, apart from the listed files', () => {
    const raw = hits().filter((h) => !Object.hasOwn(ALLOWED, h.where.split(' ')[0] ?? ''));
    expect(raw.map((h) => `${h.where}  ${h.attr}`)).toEqual([]);
  });

  it('lists no file that has nothing to except any more', () => {
    const files = new Set(hits().map((h) => h.where.split(' ')[0]));
    const stale = Object.keys(ALLOWED).filter((f) => !files.has(f));
    expect(stale).toEqual([]);
  });
});
