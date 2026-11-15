import { content, SKILL_IDS } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  createState,
  defaultRules,
  dispatch,
  isSkillUnlocked,
  listSkillActions,
  rate,
  skillUnlockStatus,
  xpAt,
} from '../src/index.ts';
import { genin, HOUR, setLevel, start } from './helpers.ts';

describe('skill unlock rules', () => {
  it('opens tai, nin, cc, med and ath from the first day', () => {
    const state = createState(1, content);
    for (const id of ['tai', 'nin', 'cc', 'med', 'ath'] as const) {
      expect(isSkillUnlocked(state, id, content), id).toBe(true);
      expect(skillUnlockStatus(state, id, content), id).toBeNull();
    }
  });

  it('keeps every other skill shut for a student except vit and eva, which wait for a fight', () => {
    const state = createState(1, content);
    const shut = SKILL_IDS.filter((id) => !isSkillUnlocked(state, id, content));
    expect(shut).toEqual([
      'katon',
      'futon',
      'raiton',
      'doton',
      'suiton',
      'herb',
      'scout',
      'prov',
      'alch',
      'vit',
      'eva',
    ]);
    expect(skillUnlockStatus(state, 'vit', content)?.req).toEqual({ t: 'flag', id: 'firstFight' });
    expect(skillUnlockStatus(state, 'katon', content)?.req).toEqual({ t: 'rank', rank: 'genin' });
  });

  it('opens the rank-gated skills at genin and vit and eva with the firstFight flag', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    expect(isSkillUnlocked(state, 'katon', content)).toBe(true);
    expect(isSkillUnlocked(state, 'alch', content)).toBe(true);
    expect(isSkillUnlocked(state, 'vit', content)).toBe(false);
    state.flags.firstFight = true;
    expect(isSkillUnlocked(state, 'vit', content)).toBe(true);
    expect(isSkillUnlocked(state, 'eva', content)).toBe(true);
  });
});

describe('listSkillActions', () => {
  it('lists the techniques of a technique skill, lowest level first', () => {
    const state = genin();
    const list = listSkillActions(state, 'tai', content, defaultRules);
    expect(list.length).toBe(content.techniques.filter((t) => t.skill === 'tai').length);
    expect(list.every((a) => a.kind === 'practice' && a.skill === 'tai')).toBe(true);
    const levels = list.map((a) => a.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it('A9: reports rate(level) as XP/h for an available practice action', () => {
    const state = genin();
    const first = listSkillActions(state, 'tai', content)[0];
    expect(first?.available).toBe(true);
    expect(first?.req).toBeNull();
    expect(first?.xpPerHour).toBeCloseTo(rate(first?.level ?? 1, content), 9);
  });

  it('matches what the engine actually pays in an hour', () => {
    const state = genin();
    const info = listSkillActions(state, 'tai', content)[0];
    if (!info) throw new Error('no action');
    expect(dispatch(state, start(info.kind, info.id), content).ok).toBe(true);
    advance(state, HOUR, content);
    // Whole cycles only, so allow one cycle of slack.
    const perCycle = (info.xpPerHour * info.intervalMs) / HOUR;
    expect(state.skills.tai.xp).toBeGreaterThan(info.xpPerHour - perCycle - 1);
    expect(state.skills.tai.xp).toBeLessThanOrEqual(info.xpPerHour + 1);
  });

  it('marks an action unavailable with its requirement tree when the level is too low', () => {
    const state = genin();
    const high = listSkillActions(state, 'tai', content).find((a) => a.level > 5);
    expect(high?.available).toBe(false);
    expect(high?.req?.met).toBe(false);
    const levelLeaf = high?.req?.children.find((c) => c.req.t === 'skill');
    expect(levelLeaf?.target).toBe(high?.level);
    expect(levelLeaf?.ref).toEqual({ kind: 'skill', id: 'tai' });
  });

  it('makes a technique action unavailable while the technique is unknown', () => {
    const state = genin();
    const unknown = listSkillActions(state, 'katon', content).find((a) => !state.known[a.id]);
    expect(unknown?.available).toBe(false);
    const leaf = unknown?.req?.children.find((c) => c.req.t === 'technique');
    expect(leaf?.met).toBe(false);
    expect(leaf?.ref).toEqual({ kind: 'technique', id: unknown?.id });
  });

  it('puts the skill unlock requirement first when the skill is shut', () => {
    const state = createState(1, content);
    const first = listSkillActions(state, 'katon', content)[0];
    expect(first?.available).toBe(false);
    expect(first?.req?.children[0]?.req).toEqual({ t: 'rank', rank: 'genin' });
  });

  it('lists drills, practices and obstacles for cc, med and ath, and nothing for skills with no actions yet', () => {
    const state = createState(1, content);
    expect(listSkillActions(state, 'cc', content).map((a) => a.kind)).toContain('drill');
    expect(listSkillActions(state, 'med', content).every((a) => a.kind === 'meditate')).toBe(true);
    expect(listSkillActions(state, 'ath', content).every((a) => a.kind === 'obstacle')).toBe(true);
    expect(listSkillActions(state, 'scout', content)).toEqual([]);
    expect(listSkillActions(state, 'vit', content)).toEqual([]);
  });

  it('reports mastery level and progress', () => {
    const state = genin();
    const info = listSkillActions(state, 'tai', content)[0];
    if (!info) throw new Error('no action');
    expect(info.masteryLevel).toBe(1);
    expect(info.masteryProgress).toBe(0);
    state.mastery[info.id] = { xp: xpAt(3) + (xpAt(4) - xpAt(3)) / 2 };
    const after = actionInfo(state, info, content);
    expect(after?.masteryLevel).toBe(3);
    expect(after?.masteryProgress).toBeCloseTo(0.5, 5);
  });

  it('slows a student past the Academy cap in the XP/h figure', () => {
    const state = createState(1, content);
    const before = listSkillActions(state, 'tai', content)[0];
    setLevel(state, 'tai', content.balance.K.academyCap);
    const after = listSkillActions(state, 'tai', content)[0];
    expect(after?.xpPerHour).toBeCloseTo(
      (before?.xpPerHour ?? 0) * content.balance.K.academySlow,
      9,
    );
  });

  it('returns null for an unknown action', () => {
    expect(actionInfo(genin(), { kind: 'practice', id: 'core:nope' }, content)).toBeNull();
    expect(actionInfo(genin(), { kind: 'nokind', id: 'x' }, content)).toBeNull();
  });
});
