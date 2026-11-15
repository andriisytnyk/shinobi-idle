import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { content } from '@shinobi/content';
import * as core from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import { CORE_API, CORE_API_NAMES, corePublic } from '../src/lib/ext/core-allowlist.ts';
import { deepFreeze } from '../src/lib/freeze.ts';

const doc = readFileSync(
  fileURLToPath(new URL('../../../docs/dev/architecture.md', import.meta.url)),
  'utf8',
);

/** The names the architecture document lists between its markers, by group. */
function documented(): Record<string, string[]> {
  const block = /<!-- ui-core-api -->([\s\S]*?)<!-- \/ui-core-api -->/.exec(doc)?.[1] ?? '';
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/^- (\w+): (.+)$/gm)) {
    out[m[1] ?? ''] = [...(m[2] ?? '').matchAll(/`(\w+)`/g)].map((x) => x[1] ?? '');
  }
  return out;
}

/** Functions of the core that change a state they are given or the world: never for packs. */
const MUTATORS = [
  'advance',
  'advanceOffline',
  'dispatch',
  'deserialize',
  'serialize',
  'createState',
  'addItem',
  'removeItem',
  'addCurrency',
  'removeCurrency',
  'setFlag',
  'bump',
  'emit',
  'gainXp',
  'grantMastery',
  'shopBuy',
  'shopSell',
  'buyGear',
  'startBuild',
  'cancelBuild',
  'claimPoi',
  'chooseNature',
  'addNature',
  'useItem',
  'useRation',
  'payMission',
  'syncVillage',
  'refreshUnlocks',
  'updateQuests',
  'deleteSave',
];

describe('what api.core gives a pack', () => {
  it('lists only names that exist in the core', () => {
    const missing = CORE_API_NAMES.filter((n) => !(n in core));
    expect(missing).toEqual([]);
    expect(new Set(CORE_API_NAMES).size).toBe(CORE_API_NAMES.length);
  });

  it('has none of the mutators, and is frozen', () => {
    for (const name of MUTATORS) expect(name in corePublic, name).toBe(false);
    expect(Object.isFrozen(corePublic)).toBe(true);
    expect(Object.keys(corePublic).sort()).toEqual([...CORE_API_NAMES].sort());
    // A small part of the 400+ exports of the core.
    expect(Object.keys(corePublic).length).toBeLessThan(150);
  });

  it('matches the architecture document, group by group, so that nothing is added unlisted', () => {
    const listed = documented();
    expect(Object.keys(listed).sort()).toEqual(Object.keys(CORE_API).sort());
    for (const [group, names] of Object.entries(CORE_API)) {
      expect(listed[group], group).toEqual([...names]);
    }
  });

  it('works on the frozen state packs read: no selector writes into it', () => {
    const state = deepFreeze(core.createState(1, content));
    deepFreeze(content);
    expect(core.getMod(state, 'xp.all', content).total).toBeGreaterThan(0);
    const { actionInfo, listSkillActions, natureStatus, evalReq, levelAt, xpAt, villageBuildings } =
      corePublic;
    const first = listSkillActions(state, 'tai', content)[0];
    expect(first).toBeDefined();
    expect(
      actionInfo(state, { kind: first?.kind ?? '', id: first?.id ?? '' }, content),
    ).not.toBeNull();
    expect(natureStatus(state, content)).toBeDefined();
    expect(evalReq(state, { t: 'skill', skill: 'tai', level: 2 }, content).met).toBe(false);
    expect(levelAt(xpAt(7), 99)).toBe(7);
    expect(villageBuildings(state, content)).toBeDefined();
  });
});
