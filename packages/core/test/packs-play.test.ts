/** T1: a game composed with the test pack plays: its skills train, its nature is chosen, its rank is earned, its currency is earned and spent, its rules run. */
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  dispatch,
  evalReq,
  getMod,
  isSkillUnlocked,
  levelAt,
  shopTotal,
  villageStage,
  skillLevel,
  xpAt,
} from '../src/index.ts';
import { TOKEN, TOKEN_PERIOD_MS, DRILL_FACTOR } from '../src/testmod/index.ts';
import {
  HOUR,
  modContent,
  modGenin,
  modRules,
  plainContent,
  plainGenin,
  plainRules,
  setSkill,
  skillsOf,
  poolsOf,
} from './packs-helpers.ts';

const start = (kind: string, id: string) => ({ type: 'action.start', slot: 0, kind, id }) as const;

describe('a game composed with the test pack', () => {
  it('knows the pack in the state and starts every vocabulary at zero', () => {
    const state = modGenin();
    expect(state.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
    expect(state.rankOrder).toEqual(['student', 'genin', 'chunin', 'testmod:adept']);
    expect(skillsOf(state)['testmod:forge']).toEqual({ xp: 0 });
    expect(skillsOf(state)['testmod:aether']).toEqual({ xp: 0 });
    expect(poolsOf(state)['testmod:forge']).toEqual({ xp: 0 });
    expect(state.currencies[TOKEN]).toBe(0);
    expect(Object.keys(state.currencies)).toEqual(['ryo', 'rep', 'intel', TOKEN]);
    // The core game has none of it.
    expect(Object.keys(plainContent.currencies.map((c) => c.id))).toHaveLength(3);
  });

  it('trains the skill of the pack by its action: XP, levels and the product', () => {
    const state = modGenin();
    state.bank['testmod:pellet'] = 500;
    expect(isSkillUnlocked(state, 'testmod:forge', modContent)).toBe(true);
    expect(dispatch(state, start('craft', 'testmod:elixir_brew'), modContent, modRules)).toEqual({
      ok: true,
    });
    advance(state, HOUR, modContent, modRules);
    expect(skillsOf(state)['testmod:forge']?.xp).toBeGreaterThan(0);
    expect(skillLevel(state, 'testmod:forge', modContent)).toBeGreaterThan(1);
    expect(state.bank['testmod:elixir']).toBeGreaterThan(10);
    expect(state.mastery['testmod:elixir_brew']?.xp).toBeGreaterThan(0);
    expect(levelAt(skillsOf(state)['testmod:forge']?.xp ?? 0, modContent.balance.K.cap)).toBe(
      skillLevel(state, 'testmod:forge', modContent),
    );
    // The listing of the skill's actions follows its activity, not its id.
    const info = actionInfo(
      state,
      { kind: 'craft', id: 'testmod:elixir_brew' },
      modContent,
      modRules,
    );
    expect(info?.skill).toBe('testmod:forge');
  });

  it('lets the player choose the nature of the pack: it trains its skill with the native bonus', () => {
    const state = modGenin();
    const technique = 'testmod:aether_touch';
    expect(isSkillUnlocked(state, 'testmod:aether', modContent)).toBe(false);
    expect(dispatch(state, start('practice', technique), modContent, modRules)).toEqual({
      ok: false,
      reason: 'error.skillLocked',
    });
    expect(
      dispatch(state, { type: 'nature.choose', nature: 'testmod:aether' }, modContent, modRules),
    ).toEqual({ ok: true });
    expect(state.player.natures).toEqual(['testmod:aether']);
    expect(state.team).not.toBeNull();
    const native = getMod(state, 'xp.skill.testmod:aether', modContent, modRules);
    expect(native.total).toBeCloseTo(modContent.balance.K.nativeXp, 10);
    expect(native.parts.map((p) => p.source)).toContain('mod.source.nativeNature');

    expect(dispatch(state, start('practice', technique), modContent, modRules).ok).toBe(true);
    advance(state, 30 * 60_000, modContent, modRules);
    expect(skillsOf(state)['testmod:aether']?.xp).toBeGreaterThan(0);
    const info = actionInfo(state, { kind: 'practice', id: technique }, modContent, modRules);
    const plain = modGenin();
    const base = actionInfo(plain, { kind: 'practice', id: technique }, modContent, modRules);
    expect((info?.xpPerCycle ?? 0) / (base?.xpPerCycle ?? 1)).toBeCloseTo(
      modContent.balance.K.nativeXp,
      10,
    );
    // A nature the pack does not own cannot be chosen, nor can one that does not exist.
    const other = modGenin();
    expect(
      dispatch(other, { type: 'nature.choose', nature: 'testmod:nothing' }, modContent, modRules),
    ).toEqual({
      ok: false,
      reason: 'error.invalidNature',
    });
  });

  it('earns the rank of the pack by its exam, and the content gated by it opens', () => {
    const state = modGenin();
    const mission = modContent.missions.find((m) => m.id === 'testmod:test_run');
    if (!mission?.unlock) throw new Error('test mission');
    expect(evalReq(state, mission.unlock, modContent).met).toBe(false);
    // The exam asks the previous rank and a level of the pack's skill.
    expect(
      dispatch(state, { type: 'exam.start', rank: 'testmod:adept' }, modContent, modRules),
    ).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    state.player.rank = 'chunin';
    setSkill(state, 'testmod:forge', 2);
    expect(
      dispatch(state, { type: 'exam.start', rank: 'testmod:adept' }, modContent, modRules),
    ).toEqual({
      ok: true,
    });
    advance(state, HOUR, modContent, modRules);
    expect(state.player.rank).toBe('testmod:adept');
    // Five pellets from the exam and one from the quest of the pack that the forge level finished.
    expect(state.bank['testmod:pellet']).toBe(6);
    expect(evalReq(state, mission.unlock, modContent).met).toBe(true);
    expect(
      dispatch(state, { type: 'exam.start', rank: 'testmod:adept' }, modContent, modRules),
    ).toEqual({
      ok: false,
      reason: 'error.examPassed',
    });
    // The alias of the old UI still means the first rank after the Academy.
    const student = modGenin();
    student.player.rank = 'student';
    expect(dispatch(student, { type: 'exam.genin.start' }, modContent, modRules).ok).toBe(false);
  });

  it('earns its currency by the system of the pack and spends it in a shop entry', () => {
    const state = modGenin();
    advance(state, HOUR, modContent, modRules);
    expect(state.currencies[TOKEN]).toBe(HOUR / TOKEN_PERIOD_MS);
    // The entry is gated by the rank of the pack and priced in its currency.
    expect(
      dispatch(state, { type: 'shop.buy', item: 'testmod:charm', n: 1 }, modContent, modRules),
    ).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    state.player.rank = 'testmod:adept';
    const price = shopTotal(state, 'testmod:charm', 1, modContent, modRules) ?? 0;
    expect(price).toBe(10);
    // Too few tokens: the money of the game does not stand in for them.
    state.currencies.ryo = 1_000_000;
    expect(
      dispatch(state, { type: 'shop.buy', item: 'testmod:charm', n: 1 }, modContent, modRules),
    ).toEqual({
      ok: false,
      reason: 'error.notEnoughCurrency',
      params: { currency: TOKEN },
    });
    advance(state, 2 * HOUR, modContent, modRules);
    expect(state.currencies[TOKEN]).toBe(18);
    expect(
      dispatch(state, { type: 'shop.buy', item: 'testmod:charm', n: 1 }, modContent, modRules),
    ).toEqual({
      ok: true,
    });
    expect(state.currencies[TOKEN]).toBe(8);
    expect(state.currencies.ryo).toBe(1_000_000);
    expect(state.bank['testmod:charm']).toBe(1);
    // A quest of the pack pays tokens too.
    const quest = modGenin();
    setSkill(quest, 'testmod:forge', 2);
    advance(quest, 0, modContent, modRules);
    expect(quest.quests['testmod:test_chain']?.done).toBe(true);
    expect(quest.currencies[TOKEN]).toBe(3);
  });

  it('opens the village stage of the pack by Reputation, and a building of that stage with it', () => {
    const state = modGenin();
    expect(villageStage(state, modContent).stage).toBe(1);
    expect(villageStage(state, modContent).repNeeded).toBe(modContent.balance.K.rep.stage2);
    const early = dispatch(
      state,
      { type: 'village.build', building: 'testmod:hut' },
      modContent,
      modRules,
    );
    expect(early).toEqual({ ok: false, reason: 'error.stageNotReached' });
    state.currencies.rep = 500;
    advance(state, 0, modContent, modRules);
    expect(state.village?.stage).toBe(3);
    expect(
      state.events
        .filter((e) => e.type === 'villageStage')
        .map((e) => (e as { stage: number }).stage),
    ).toEqual([2, 3]);
    const info = villageStage(state, modContent);
    expect(info).toMatchObject({ stage: 3, reached: true });
    // The stage no longer holds the building back: whatever stops it now is the price.
    const later = dispatch(
      state,
      { type: 'village.build', building: 'testmod:hut' },
      modContent,
      modRules,
    );
    expect(later).not.toEqual({ ok: false, reason: 'error.stageNotReached' });
    // The core game has two stages, and Reputation beyond the second changes nothing.
    const core = plainGenin();
    core.currencies.rep = 500;
    advance(core, 0, plainContent, plainRules);
    expect(core.village?.stage).toBe(2);
    expect(villageStage(core, plainContent)).toMatchObject({ stage: 2, reached: true });
  });

  it('runs the wrapped core action with the changed interval and leaves the core game alone', () => {
    const state = modGenin();
    const exercise = modContent.exercises[0];
    if (!exercise) throw new Error('an exercise');
    const wrapped = modRules.actionKinds.drill;
    const plain = plainRules.actionKinds.drill;
    const mod = wrapped?.intervalMs(state, exercise.id, modContent, modRules) ?? 0;
    const base = plain?.intervalMs(state, exercise.id, plainContent, plainRules) ?? 0;
    expect(mod).toBe(Math.round(base * DRILL_FACTOR));
    // The other kinds are the very ones of the core pack.
    expect(modRules.actionKinds.practice).toBe(plainRules.actionKinds.practice);
    expect(modRules.systems.map((s) => s.id)).toEqual([
      'action',
      'points',
      'combat',
      'clone',
      'wound',
      'village',
      'quest',
      'testmod:tokens',
    ]);
    expect(plainRules.systems).toHaveLength(7);
  });

  it('applies modifiers keyed by the skill of the pack, with their sources', () => {
    const state = modGenin();
    expect(getMod(state, 'xp.skill.testmod:forge', modContent, modRules).total).toBe(1);
    state.gear['testmod:anvil'] = 1;
    const mod = getMod(state, 'xp.skill.testmod:forge', modContent, modRules);
    expect(mod.total).toBeCloseTo(1 + (modContent.balance.K.gearFx.sickle ?? 0), 10);
    expect(mod.parts).toEqual([
      expect.objectContaining({ source: { kind: 'gear', id: 'testmod:anvil' }, group: 'items' }),
    ]);
    // The key is declared by the families of the skill, so the content knows it.
    expect(Object.hasOwn(modContent.modifierKeys, 'xp.skill.testmod:forge')).toBe(true);
    expect(Object.hasOwn(modContent.modifierKeys, 'interval.skill.testmod:aether')).toBe(true);
    // And the XP it gives is really paid.
    const forge = modGenin();
    forge.bank['testmod:pellet'] = 100;
    const bare = modGenin();
    bare.bank['testmod:pellet'] = 100;
    forge.gear['testmod:anvil'] = 1;
    for (const s of [forge, bare])
      dispatch(s, start('craft', 'testmod:elixir_brew'), modContent, modRules);
    advance(forge, 600_000, modContent, modRules);
    advance(bare, 600_000, modContent, modRules);
    expect(skillsOf(forge)['testmod:forge']?.xp).toBeGreaterThan(
      skillsOf(bare)['testmod:forge']?.xp ?? 0,
    );
    expect(xpAt(2)).toBeGreaterThan(0);
  });
});
