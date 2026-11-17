/** A pack's land: it patches hexes of the grid and joins hexes that are not neighbours by links. */
import { composeContent, content as core, corePack, type ContentPack } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  AUTOSURVEY_ID,
  AUTOSURVEY_KIND,
  autoPlan,
  composeRules,
  createState,
  defaultRules,
  dispatch,
  EXPLORE_KIND,
  hexInfo,
  hexKey,
  isSurveyed,
  routeTo,
  surveyAccess,
  syncVillage,
  travelPlan,
  type GameState,
} from '../src/index.ts';
import { testmodPack } from '../src/testmod/index.ts';
import { setLevel } from './helpers.ts';

const MIN = 60_000;
const withMod = composeContent([corePack, testmodPack]);
const rules = composeRules(defaultRules, [corePack, testmodPack], withMod);

/** A genin standing on the coast at 15,17 (surveyed), where the ferry of the test pack leaves. */
function onTheCoast(): GameState {
  const state = createState(1, withMod);
  state.player.rank = 'genin';
  syncVillage(state, withMod);
  setLevel(state, 'scout', 5);
  state.world.surveyed['15,17'] = true;
  state.world.location = '15,17';
  return state;
}

describe('hexes patched by a pack', () => {
  it('makes open sea playable land of the pack, with the terrain and country the patch sets', () => {
    const before = core.hexes.find((h) => h.q === 17 && h.r === 17);
    expect(before?.terrain).toBeUndefined();
    const after = withMod.hexes.find((h) => h.q === 17 && h.r === 17);
    expect(after).toMatchObject({ terrain: 'forest', country: 'testmod:isle' });
    expect(withMod.hexes).toHaveLength(core.hexes.length);
    expect(withMod.hexes.filter((h) => h.terrain).length).toBe(
      core.hexes.filter((h) => h.terrain).length + 2,
    );
  });

  it('changes the terrain of a hex of another pack, and two packs may not change the same field', () => {
    const road = (id: string): ContentPack => ({
      ...testmodPack,
      manifest: { ...testmodPack.manifest, id },
      data: {},
      balance: {},
      locales: { uk: {} },
      icons: {},
      patches: [{ target: { kind: 'hexes', id: '9,17' }, set: { terrain: 'hills' } }],
      rules: undefined,
    modifierKeys: undefined,
      modifierKeys: undefined,
      ui: undefined,
    });
    const changed = composeContent([corePack, road('hill')]);
    expect(changed.hexes.find((h) => h.q === 9 && h.r === 17)?.terrain).toBe('hills');
    expect(() => composeContent([corePack, road('hill'), road('rock')])).toThrow(/already set/);
  });

  it('refuses a patch to the coordinates of a hex, to a hex that is not there, and a terrain nobody has', () => {
    const patch = (patches: ContentPack['patches']): ContentPack => ({
      ...testmodPack,
      manifest: { ...testmodPack.manifest, id: 'bad' },
      data: {},
      balance: {},
      locales: { uk: {} },
      icons: {},
      patches,
      rules: undefined,
    modifierKeys: undefined,
      modifierKeys: undefined,
      ui: undefined,
    });
    expect(() =>
      composeContent([corePack, patch([{ target: { kind: 'hexes', id: '9,17' }, set: { q: 1 } }])]),
    ).toThrow(/only "terrain" and "country"/);
    expect(() =>
      composeContent([corePack, patch([{ target: { kind: 'hexes', id: '999,999' }, set: {} }])]),
    ).toThrow(/does not exist/);
    expect(() =>
      composeContent([
        corePack,
        patch([{ target: { kind: 'hexes', id: '9,17' }, set: { terrain: 'lava' } }]),
      ]),
    ).toThrow(/lava|terrain/);
  });
});

describe('links between hexes that are not neighbours', () => {
  it('are in the content, joining two playable hexes of the pack and the coast', () => {
    expect(withMod.links).toEqual([
      { id: 'testmod:ferry', a: [15, 17], b: [18, 17], minutes: 5, kind: 'ferry' },
    ]);
    expect(core.links).toEqual([]);
  });

  it('are refused by the closure when an end is no land, the ends are neighbours or equal, or the pair is doubled', () => {
    const link = (a: [number, number], b: [number, number], id = 'bad:way'): ContentPack => ({
      ...testmodPack,
      manifest: { ...testmodPack.manifest, id: 'bad' },
      data: { links: [{ id, a, b, minutes: 3 }] },
      balance: {},
      locales: { uk: {} },
      icons: {},
      patches: [],
      rules: undefined,
    modifierKeys: undefined,
      modifierKeys: undefined,
      ui: undefined,
    });
    expect(() => composeContent([corePack, link([15, 17], [16, 17])])).toThrow(/not playable/);
    expect(() => composeContent([corePack, link([15, 17], [15, 17])])).toThrow(/different hexes/);
    expect(() => composeContent([corePack, link([15, 17], [14, 18])])).toThrow(/neighbours/);
    const doubled: ContentPack = {
      ...link([15, 17], [13, 20]),
      data: {
        links: [
          { id: 'bad:one', a: [15, 17], b: [13, 20], minutes: 3 },
          { id: 'bad:two', a: [13, 20], b: [15, 17], minutes: 4 },
        ],
      },
    };
    expect(() => composeContent([corePack, doubled])).toThrow(/same two hexes/);
  });

  it('let the player survey the far end from this end, though it is beyond the range', () => {
    const state = onTheCoast();
    // Three hexes away: beyond the range of Scouting 5, but the far end of the ferry.
    expect(surveyAccess(state, withMod, { q: 18, r: 17 }, undefined, 0)).toBe('ok');
    // The hex between, which is no end of a link, is next to fog beyond reach: it is out of the way.
    expect(hexInfo(state, '18,17', withMod, rules)?.inRange).toBe(true);
    const start = dispatch(
      state,
      { type: 'action.start', slot: 0, kind: EXPLORE_KIND, id: '18,17' },
      withMod,
      rules,
    );
    expect(start).toEqual({ ok: true });
    advance(state, 10 * MIN, withMod, rules);
    expect(isSurveyed(state, withMod, '18,17')).toBe(true);
  });

  it('are walked: the route uses the link, takes its minutes and refuses an end that is still in fog', () => {
    const state = onTheCoast();
    expect(travelPlan(state, '18,17', withMod, rules).blocked).toBe('error.cellNotReachable');
    state.world.surveyed['18,17'] = true;
    const plan = travelPlan(state, '18,17', withMod, rules);
    expect(plan.blocked).toBeNull();
    expect(plan.hexes).toEqual(['18,17']);
    const route = routeTo(state, withMod, { q: 18, r: 17 });
    expect(route?.minutes).toEqual([5]);
    expect(dispatch(state, { type: 'world.travel', cell: '18,17' }, withMod, rules)).toEqual({
      ok: true,
    });
    advance(state, 20 * MIN, withMod, rules);
    expect(state.world.location).toBe('18,17');
    // From the island, the ferry goes back and the cell of the pack is one hex away.
    expect(travelPlan(state, '15,17', withMod, rules).hexes).toEqual(['15,17']);
    state.world.surveyed['17,17'] = true;
    expect(travelPlan(state, 'testmod:grove_edge', withMod, rules).hexes).toEqual(['17,17']);
  });

  it('are used by the auto-survey, which reaches the pack land on its own', () => {
    const state = onTheCoast();
    // Everything else is done: the pack land is what is left.
    for (const h of core.hexes) {
      if (!h.terrain) continue;
      state.world.surveyed[hexKey(h.q, h.r)] = true;
      state.world.explores[hexKey(h.q, h.r)] = 99;
    }
    for (const c of core.cells) state.world.explores[c.id] = 99;
    expect(autoPlan(state, withMod)?.subject.address).toBe('18,17');
    expect(
      dispatch(
        state,
        { type: 'action.start', slot: 0, kind: AUTOSURVEY_KIND, id: AUTOSURVEY_ID },
        withMod,
        rules,
      ),
    ).toEqual({ ok: true });
    advance(state, 2 * 60 * MIN, withMod, rules);
    expect(isSurveyed(state, withMod, '18,17')).toBe(true);
  });
});
