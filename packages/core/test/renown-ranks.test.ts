import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  currencyOf,
  defaultRules,
  getMod,
  hasRenownRank,
  renownFlag,
  renownLadder,
  renownOf,
  rewardScroll,
  updateQuests,
  type GameState,
} from '../src/index.ts';
import { asPerformer, dispatch, growSlots, missionBoard } from '../src/index.ts';
import { player } from './missions-helpers.ts';
import { HOUR, modContent, modGenin, modRules, plainGenin, setNatures } from './packs-helpers.ts';
import { learnReq, evalReq } from '../src/index.ts';

const RENOWN = currencyOf(content, 'renown') as string;
const ids = (c = content) => renownLadder(c).map((r) => r.id);

function withRenown(state: GameState, n: number): GameState {
  state.currencies[RENOWN] = n;
  return state;
}
const events = (state: GameState) =>
  state.events.flatMap((e) => (e.type === 'renownRank' ? [e.rank] : []));

describe('Renown ranks: the data', () => {
  it('has five ranks below the exam, in rising order, the last at the exam threshold', () => {
    const ladder = renownLadder(content);
    expect(ladder).toHaveLength(5);
    expect(ladder.map((r) => r.renown)).toEqual([180, 210, 240, 270, 300]);
    const exam = content.exams.find((e) => e.id === 'core:chunin_exam');
    expect(JSON.stringify(exam?.checklist)).toContain('"n":300');
  });
});

describe('Renown ranks: granting', () => {
  it('grants nothing below the first threshold', () => {
    const state = withRenown(plainGenin(), 179);
    updateQuests(state, content);
    expect(events(state)).toEqual([]);
    expect(ids().some((id) => hasRenownRank(state, id))).toBe(false);
  });

  it('grants a rank once, with its reward, and never again', () => {
    const state = withRenown(plainGenin(), 180);
    updateQuests(state, content);
    expect(events(state)).toEqual(['core:renown_courier']);
    expect(state.flags['missions.mail.unlocked']).toBe(true);
    state.events = [];
    updateQuests(state, content);
    withRenown(state, 185);
    updateQuests(state, content);
    expect(events(state)).toEqual([]);
  });

  it('opens the mail mission at the first rank and not before', () => {
    const state = plainGenin();
    state.flags['missions.c.unlocked'] = true;
    const mail = () => missionBoard(state, content, defaultRules).find((m) => m.id === 'core:mail');
    expect(mail()?.open).toBe(false);
    withRenown(state, 180);
    updateQuests(state, content);
    expect(mail()?.open).toBe(true);
  });

  it('gives a 5% discount in the shop from the third rank', () => {
    const state = plainGenin();
    const before = getMod(state, 'shop.price', content).total;
    withRenown(state, 240);
    updateQuests(state, content);
    expect(getMod(state, 'shop.price', content).total).toBeCloseTo(before - 0.05);
  });

  it('hands the item of the fourth rank', () => {
    const state = withRenown(plainGenin(), 270);
    updateQuests(state, content);
    expect(state.bank['core:chai_badorosti']).toBe(2);
  });

  it('raises the recommendation at the exam threshold', () => {
    const state = withRenown(plainGenin(), 300);
    updateQuests(state, content);
    expect(state.flags['renown.recommended']).toBe(true);
    expect(hasRenownRank(state, 'core:renown_recommendation')).toBe(true);
  });

  it('grants the ranks of a long absence in the order of the thresholds, each reward once', () => {
    const state = withRenown(plainGenin(), 0);
    setNatures(state, ['katon']);
    state.player.natures = ['katon'];
    // A day away that ended with 320 Reputation: the ranks come out in order at the first step.
    withRenown(state, 320);
    advance(state, 24 * HOUR, content, defaultRules);
    expect(events(state)).toEqual(ids());
    expect(state.bank['core:chai_badorosti']).toBe(2);
    const scrolls = Object.keys(state.bank).filter((i) => i.startsWith('core:scroll_'));
    expect(scrolls).toHaveLength(1);
    state.events = [];
    advance(state, HOUR, content, defaultRules);
    expect(events(state)).toEqual([]);
    expect(state.bank['core:chai_badorosti']).toBe(2);
  });

  it('keeps a rank held when the Reputation later falls', () => {
    const state = withRenown(plainGenin(), 200);
    updateQuests(state, content);
    withRenown(state, 0);
    updateQuests(state, content);
    expect(state.flags[renownFlag('core:renown_courier')]).toBe(true);
    expect(renownOf(state, content)).toBe(0);
  });
});

describe('Renown ranks: the technique of the teacher', () => {
  const NATURES = ['katon', 'futon', 'raiton', 'doton', 'suiton'] as const;

  it('never gives a technique of a nature the player lacks, and is readable by the nature or by no nature', () => {
    for (const own of NATURES) {
      const state = plainGenin();
      state.player.natures = [own];
      withRenown(state, 210);
      updateQuests(state, content);
      const scroll = Object.keys(state.bank).find((i) => i.startsWith('core:scroll_'));
      expect(scroll, own).toBeDefined();
      const item = content.items.find((i) => i.id === scroll);
      const tech = content.techniques.find((t) => t.id === item?.scroll?.technique);
      expect(tech, own).toBeDefined();
      const skill = content.skills.find((s) => s.id === tech?.skill);
      if (skill?.unlockReq) expect(evalReq(state, skill.unlockReq, content).met, own).toBe(true);
      if (tech && NATURES.includes(tech.skill as (typeof NATURES)[number]))
        expect(tech.skill, own).toBe(own);
      expect(state.known[tech?.id ?? '']).toBeUndefined();
      expect(learnReq(tech as never, content).t).toBe('all');
    }
  });

  it('gives a player with no nature a technique of no nature', () => {
    const state = plainGenin();
    state.player.natures = [];
    const item = rewardScroll(state, 4, content);
    const tech = content.techniques.find(
      (t) => t.id === content.items.find((i) => i.id === item)?.scroll?.technique,
    );
    expect(NATURES.includes(tech?.skill as never)).toBe(false);
  });
});

describe('Renown ranks: a pack adds its own', () => {
  it('pays the rank of a pack with its reward, in order with the ranks of the core', () => {
    expect(ids(modContent)).toEqual([
      'testmod:renown_pellet',
      'core:renown_courier',
      'core:renown_teacher',
      'core:renown_merchants',
      'core:renown_gift',
      'core:renown_recommendation',
    ]);
    const state = modGenin();
    state.currencies[RENOWN] = 150;
    updateQuests(state, modContent);
    expect(events(state)).toEqual(['testmod:renown_pellet']);
    state.currencies[RENOWN] = 200;
    updateQuests(state, modContent);
    expect(events(state)).toEqual(['testmod:renown_pellet', 'core:renown_courier']);
    expect(state.flags['testmod.renown']).toBe(true);
    expect(state.bank['testmod:pellet']).toBe(1);
    void modRules;
    void createState;
  });
});

describe('Renown ranks: rewards belong to the character', () => {
  it('pays the rewards to the character when a clone step triggers updateQuests', () => {
    const state = player({
      seed: 5,
      natures: ['katon'],
      known: ['core:shadow_clone'],
      levels: { nin: 50, cc: 40 },
      bank: { 'core:mint': 50 },
    });
    growSlots(state, content);
    expect(dispatch(state, { type: 'clone.create' }, content).ok).toBe(true);
    const clone = state.clones[1];
    expect(clone).toBeDefined();
    state.currencies[RENOWN] = 320;
    state.events = [];
    const cloneBagBefore = JSON.stringify(clone?.bag);
    const clonePurseBefore = JSON.stringify(clone?.purse);
    asPerformer(state, 1, () => updateQuests(state, content));
    // The ranks are granted from the character's Reputation, not the clone's empty purse.
    expect(events(state)).toEqual(ids());
    expect(state.bank['core:chai_badorosti']).toBe(2);
    expect(JSON.stringify(state.clones[1]?.bag)).toBe(cloneBagBefore);
    expect(JSON.stringify(state.clones[1]?.purse)).toBe(clonePurseBefore);
  });
});
