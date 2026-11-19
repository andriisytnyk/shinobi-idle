/** Review fixes: attach time of a pack, versions, list activities with several skills, pack currencies as payouts, stage caps. */
import { composeContent, corePack, type ContentPack, type PackData } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  claimPoi,
  composeRules,
  createState,
  currentStage,
  defaultRules,
  deserialize,
  dispatch,
  listSkillActions,
  payMission,
  serialize,
  stageCap,
  syncVillage,
  type GameState,
} from '../src/index.ts';
import { TOKEN } from '../src/testmod/index.ts';
import {
  HOUR,
  modContent,
  modGenin,
  modRules,
  plainContent,
  plainRules,
  setSkill,
  skillsOf,
} from './packs-helpers.ts';

describe('the attach time of a pack', () => {
  it('does not pay a system for the time the pack was away', () => {
    const state = modGenin(2);
    advance(state, 2 * HOUR, modContent, modRules);
    expect(state.currencies[TOKEN]).toBe(12);
    const core = deserialize(serialize(state), plainContent, plainRules);
    advance(core, 5 * HOUR, plainContent, plainRules);
    const back = deserialize(serialize(core), modContent, modRules);
    expect(back.currencies[TOKEN]).toBe(12);
    expect(back.packs.find((p) => p.id === 'testmod')?.since).toBe(7 * HOUR);
    advance(back, HOUR, modContent, modRules);
    // One more hour pays six tokens, not thirty.
    expect(back.currencies[TOKEN]).toBe(18);
  });

  it('starts counting at the moment a pack is added to a core save', () => {
    const core = createState(3, plainContent);
    advance(core, 3 * HOUR, plainContent, plainRules);
    const state = deserialize(serialize(core), modContent, modRules);
    expect(state.packs.find((p) => p.id === 'testmod')?.since).toBe(3 * HOUR);
    advance(state, HOUR, modContent, modRules);
    expect(state.currencies[TOKEN]).toBe(6);
  });

  it('reports a version change of a pack', () => {
    const state = modGenin();
    const saved = JSON.parse(serialize(state)) as {
      state: { packs: { id: string; version: string }[] };
    };
    const entry = saved.state.packs.find((p) => p.id === 'testmod');
    if (entry) entry.version = '0.0.1';
    const loaded = deserialize(JSON.stringify(saved), modContent, modRules);
    expect(loaded.events).toContainEqual(
      expect.objectContaining({
        type: 'packsChanged',
        added: [],
        removed: [],
        updated: [{ id: 'testmod', from: '0.0.1', to: modContent.packs[1]?.version }],
      }),
    );
  });
});

describe('list activities with more than one skill', () => {
  const second: ContentPack = {
    manifest: { id: 'two', version: '1', dependsOn: ['core'], loadAfter: [] },
    data: {
      skills: [{ id: 'two:drill', group: 'train', activity: 'drill', unlockReq: null }],
      exercises: [{ id: 'two:rep', level: 1, skill: 'two:drill' }],
    } as unknown as PackData,
    balance: { pace: { 'two:drill': [3, 7, 11, 17, 25] } },
    locales: {
      uk: {
        'skill.two:drill.name': 'Друга вправа',
        'skill.two:drill.desc': 'Друга навичка вправ.',
        'exercise.two:rep.name': 'Вправа',
        'exercise.two:rep.desc': 'Вправа другої навички.',
      },
    },
    icons: {},
    patches: [],
  };
  const content = composeContent([corePack, second]);
  const rules = composeRules(defaultRules, [corePack, second], content);

  it('lists each skill its own entities and trains the skill the entity names', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    syncVillage(state, content);
    const own = listSkillActions(state, 'two:drill', content, rules).map((a) => a.id);
    expect(own).toEqual(['two:rep']);
    const core = listSkillActions(state, 'cc', content, rules).map((a) => a.id);
    expect(core).not.toContain('two:rep');
    expect(core.length).toBeGreaterThan(0);
    expect(actionInfo(state, { kind: 'drill', id: 'two:rep' }, content, rules)?.skill).toBe(
      'two:drill',
    );
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'drill', id: 'two:rep' },
      content,
      rules,
    );
    advance(state, 600_000, content, rules);
    expect(skillsOf(state)['two:drill']?.xp).toBeGreaterThan(0);
    expect(skillsOf(state).cc?.xp).toBe(0);
  });
});

describe('currencies of a pack as payouts', () => {
  it('pays a mission in tokens', () => {
    const state: GameState = modGenin();
    const mission = modContent.missions.find((m) => m.id === 'testmod:test_run');
    if (!mission) throw new Error('mission');
    payMission(state, mission, [], modContent, modRules);
    expect(state.currencies[TOKEN]).toBe(2);
  });

  it('pays a cache in tokens', () => {
    const state = modGenin();
    const cell = modContent.cells.find((c) => c.id === 'testmod:grove_edge');
    if (!cell) throw new Error('cell');
    state.world.location = cell.id;
    state.world.pois['testmod:poi_grove_cache'] = true;
    expect(claimPoi(state, 'testmod:poi_grove_cache', modContent)).toEqual({ ok: true });
    expect(state.currencies[TOKEN]).toBe(3);
  });
});

describe('the cap of a village stage', () => {
  it('comes from the stage entity, else from the table', () => {
    const state = modGenin();
    state.currencies.rep = 500;
    advance(state, 0, modContent, modRules);
    expect(currentStage(state, modContent)).toBe(3);
    expect(stageCap(state, modContent)).toBe(6);
    const core = createState(1, plainContent);
    core.player.rank = 'genin';
    syncVillage(core, plainContent);
    expect(stageCap(core, plainContent)).toBe(plainContent.balance.K.towerStageMax[0]);
    setSkill(core, 'tai', 2);
  });
});
