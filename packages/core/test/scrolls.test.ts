/** A4: parts, scrolls and Notes; A5: gating of zones and bosses; the Library scrolls in the shop. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  masteryXpPerHour,
  dispatch,
  masteryLevel,
  refreshRegions,
  syncVillage,
  setFlag,
  unlockBoss,
  zoneCellOf,
  type GameState,
} from '../src/index.ts';
import { indexOf } from '../src/lookup.ts';
import { K } from './fight-helpers.ts';
import { setLevel, withBuildings } from './helpers.ts';
import { fighter, openWorld, startFight, stock } from './prep-state.ts';

const PART = 'core:scrollpart_water_prison';
const SCROLL = 'core:scroll_water_prison';
const TECH = 'core:water_prison';
const tech = content.techniques.find((t) => t.id === TECH);
if (!tech) throw new Error('no technique');

const combine = (state: GameState, item: string) =>
  dispatch(state, { type: 'item.combine', item }, content);
const use = (state: GameState, id: string, target?: string) =>
  dispatch(state, { type: 'item.use', id, ...(target === undefined ? {} : { target }) }, content);
const mastery = (state: GameState, id: string) => state.mastery[id]?.xp ?? 0;

describe('A4: combining parts', () => {
  it('needs exactly the parts of a scroll, and takes exactly that many', () => {
    const state = fighter(1, 40);
    stock(state, { [PART]: K.partsPerScroll - 1 });
    expect(combine(state, PART)).toEqual({ ok: false, reason: 'error.notEnoughParts' });
    expect(state.bank[PART]).toBe(K.partsPerScroll - 1);
    expect(state.bank[SCROLL]).toBeUndefined();
    stock(state, { [PART]: 3 });
    expect(combine(state, PART)).toEqual({ ok: true });
    expect(state.bank[PART]).toBe(2);
    expect(state.bank[SCROLL]).toBe(1);
  });

  it('refuses what is no part, and an unknown item', () => {
    const state = fighter(2, 40);
    stock(state, { 'core:pelt': 20 });
    expect(combine(state, 'core:pelt')).toEqual({ ok: false, reason: 'error.notCombinable' });
    expect(combine(state, 'core:nothing')).toEqual({ ok: false, reason: 'error.notCombinable' });
  });

  it('accepts the scroll itself to name the parts it is made of', () => {
    const state = fighter(3, 40);
    stock(state, { [PART]: K.partsPerScroll });
    expect(combine(state, SCROLL)).toEqual({ ok: true });
    expect(state.bank[SCROLL]).toBe(1);
  });
});

describe('A4: reading a scroll', () => {
  it('teaches the technique when its skill level allows, and takes the scroll', () => {
    const state = fighter(4, 10);
    state.player.natures.push('suiton');
    setLevel(state, 'suiton', tech.level);
    stock(state, { [SCROLL]: 1 });
    expect(state.known[TECH]).toBeUndefined();
    expect(use(state, SCROLL)).toEqual({ ok: true });
    expect(state.known[TECH]).toBe(true);
    expect(state.bank[SCROLL]).toBeUndefined();
    expect(state.events.some((e) => e.type === 'techniqueLearned' && e.id === TECH)).toBe(true);
  });

  it('is refused with the requirement tree when the level is short, and keeps the scroll', () => {
    const state = fighter(5, 10);
    setLevel(state, 'suiton', tech.level - 1);
    stock(state, { [SCROLL]: 1 });
    const result = use(state, SCROLL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('error.requirementsNotMet');
    expect(result.req?.met).toBe(false);
    const leaf = result.req?.children.find((c) => c.req.t === 'skill');
    expect(leaf).toMatchObject({ met: false, current: tech.level - 1, target: tech.level });
    expect(state.known[TECH]).toBeUndefined();
    expect(state.bank[SCROLL]).toBe(1);
  });

  it('is read as Notes of exactly one hour of mastery when the technique is known', () => {
    const state = fighter(6, 40);
    setLevel(state, 'suiton', tech.level);
    state.known[TECH] = true;
    stock(state, { [SCROLL]: 2 });
    const before = mastery(state, TECH);
    const hour = masteryXpPerHour(masteryLevel(state, TECH, content), content);
    expect(use(state, SCROLL)).toEqual({ ok: true });
    expect(mastery(state, TECH) - before).toBeCloseTo(hour, 6);
    expect(state.bank[SCROLL]).toBe(1);
    expect(masteryLevel(state, TECH, content)).toBeGreaterThanOrEqual(1);
  });
});

describe('A4: the generic Notes', () => {
  const NOTES = 'core:notes';

  it('gives an hour of mastery to a chosen known technique, and nothing else', () => {
    const state = fighter(7, 40);
    const known = Object.keys(state.known).find((id) =>
      content.techniques.some((t) => t.id === id && t.rank !== null),
    );
    if (!known) throw new Error('no known technique');
    stock(state, { [NOTES]: 3 });
    const before = mastery(state, known);
    const hour = masteryXpPerHour(masteryLevel(state, known, content), content);
    expect(use(state, NOTES, known)).toEqual({ ok: true });
    expect(mastery(state, known) - before).toBeCloseTo(hour, 6);
    expect(state.bank[NOTES]).toBe(2);
    // A technique not known, an unknown id and no target are refused without losing the item.
    expect(use(state, NOTES, TECH)).toEqual({ ok: false, reason: 'error.invalidTarget' });
    expect(use(state, NOTES, 'core:ghost')).toEqual({ ok: false, reason: 'error.invalidTarget' });
    expect(use(state, NOTES)).toEqual({ ok: false, reason: 'error.invalidTarget' });
    expect(state.bank[NOTES]).toBe(2);
  });
});

describe('the Library scrolls in the shop', () => {
  const library = content.items.filter((i) => i.scroll?.source.t === 'library');

  it('are sold at the price of their level in the scroll table, behind the Library level', () => {
    expect(library.length).toBe(8);
    for (const item of library) {
      const entry = indexOf(content).shop.get(item.id);
      expect(entry, item.id).toBeDefined();
      expect(JSON.stringify(entry?.req)).toContain('core:library');
    }
    const item = library[0];
    if (!item?.scroll || item.scroll.source.t !== 'library') throw new Error('no scroll');
    const state = fighter(8, 20);
    syncVillage(state, content);
    withBuildings(state, { 'core:library': item.scroll.source.level });
    state.currencies.ryo = 10_000;
    const price = K.scroll[String(item.scroll.source.level)] ?? 0;
    expect(dispatch(state, { type: 'shop.buy', item: item.id, n: 1 }, content)).toEqual({
      ok: true,
    });
    // The village may shave the price, never raise it.
    expect(state.currencies.ryo).toBeGreaterThanOrEqual(10_000 - price);
    expect(state.currencies.ryo).toBeLessThan(10_000);
    expect(state.bank[item.id]).toBe(1);
  });
});

describe('A5: gating of zones and bosses', () => {
  it('refuses a region zone until its cell is explored to level 1, then allows it', () => {
    const state = fighter(9, 20);
    state.world.explores = {};
    const cell = zoneCellOf('core:zone_bandit', content);
    if (!cell) throw new Error('no cell');
    expect(startFight(state, 'core:zone_bandit')).toEqual({
      ok: false,
      reason: 'error.zoneNotExplored',
    });
    expect(startFight(state, 'core:bandit')).toEqual({
      ok: false,
      reason: 'error.zoneNotExplored',
    });
    state.world.explores[cell] = (K.cellExplores[0] ?? 1) - 1;
    expect(startFight(state, 'core:zone_bandit').ok).toBe(false);
    state.world.explores[cell] = K.cellExplores[0] ?? 1;
    expect(startFight(state, 'core:zone_bandit')).toEqual({ ok: true });
    // The other cells stay closed.
    expect(startFight(state, 'core:zone_wolf')).toEqual({
      ok: false,
      reason: 'error.zoneNotExplored',
    });
  });

  it('keeps the temporary switch out of the balance object', () => {
    expect('regionZones' in K).toBe(false);
  });

  it('keeps every boss shut until the function opens it, one boss at a time', () => {
    const state = fighter(10, 50);
    openWorld(state);
    refreshRegions(state, content, true);
    for (const boss of content.bosses) {
      const zone = content.zones.find((z) => z.enemy === boss.id);
      expect(zone, boss.id).toBeDefined();
      expect(startFight(state, zone?.id ?? ''), boss.id).toEqual({
        ok: false,
        reason: 'error.requirementsNotMet',
      });
    }
    expect(unlockBoss(state, 'core:boss_hunter', content)).toBe(true);
    expect(startFight(state, 'core:zone_boss_hunter')).toEqual({ ok: true });
    expect(startFight(state, 'core:zone_boss_mist', 0).ok).toBe(false);
    // Neither an enemy nor an unknown id can be "unlocked".
    expect(unlockBoss(state, 'core:wolf', content)).toBe(false);
    expect(unlockBoss(state, 'core:nobody', content)).toBe(false);
    // Raising a flag by hand does the same; the function only names the flag.
    setFlag(state, 'boss.mist.unlocked');
    expect(startFight(state, 'core:zone_boss_mist')).toEqual({ ok: true });
  });
});
