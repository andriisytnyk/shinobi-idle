/** A6: the player AI by tier, driven by the rule data, and what the player knows. */
import { content, type AiTier, type ContentDb, type TraitId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createFight,
  defaultCombatAi,
  defaultRules,
  fightAdvance,
  knowledgeOf,
  workOf,
  type FightView,
  type GameState,
  type KitTechnique,
  type ViewEnemy,
  type ViewTechnique,
} from '../src/index.ts';
import { K, enemyAt, scripted, sec } from './fight-helpers.ts';
import { fighter, startFight } from './prep-state.ts';
import { advance } from '../src/index.ts';

const tierOf = (id: 'genin' | 'chunin'): AiTier => {
  const t = content.ai.tiers.find((x) => x.id === id);
  if (!t) throw new Error(`no ${id} tier`);
  return t;
};

const kt = (
  id: string,
  tags: string[],
  damage: number,
  extra: Partial<KitTechnique> = {},
): KitTechnique => ({
  id,
  skill: 'tai',
  role: 'projectile',
  rank: 'C',
  tags: tags as KitTechnique['tags'],
  state: null,
  damage,
  castMs: 1000,
  cooldownMs: 6000,
  pool: 'chakra',
  cost: 1,
  accuracy: 100,
  comboChance: 0,
  hitsAll: false,
  guaranteedCombo: null,
  habituationMult: 1,
  fx: {
    kind: 'damage',
    amount: 0,
    mult: 1,
    durationMs: 0,
    drain: 0,
    wounds: 0,
    everyMs: 0,
    statuses: [],
  },
  requiresStance: false,
  ...extra,
});
const shield = (id: string) =>
  kt(id, [], 0, {
    role: 'defense',
    fx: {
      kind: 'shield',
      amount: 50,
      mult: 1,
      durationMs: 6000,
      drain: 0,
      wounds: 0,
      everyMs: 0,
      statuses: [],
    },
  });
const vt = (tech: KitTechnique): ViewTechnique => ({
  tech,
  cooldownLeft: 0,
  affordable: true,
  ready: true,
  uses: 0,
  expected: tech.damage,
  power: tech.damage,
  stanceOk: true,
});
const enemyView = (o: Partial<ViewEnemy> = {}): ViewEnemy => ({
  id: 'e#0',
  hp: 100,
  hpShare: 1,
  nature: null,
  effects: [],
  knownTraits: [],
  workingTraits: [],
  cast: null,
  nextCastIn: null,
  leader: false,
  ...o,
});
function view(id: 'genin' | 'chunin', techs: KitTechnique[], enemies: ViewEnemy[]): FightView {
  const ai = tierOf(id);
  return {
    t: 0,
    tier: id === 'genin' ? 1 : 2,
    player: {
      hp: 100,
      maxHp: 100,
      chakra: 100,
      maxChakra: 100,
      stamina: 100,
      maxStamina: 100,
      effects: [],
      ward: 0,
      decoys: 0,
    },
    techniques: techs.map(vt),
    enemies,
    habituation: {},
    ai,
    visibleTraits: content.ai.visibleTraits,
    pouch: [],
    medic: null,
    stance: null,
    hastened: false,
    reactWork: workOf(K.ai[id].reactMs),
    guardBelow: K.ai.guardBelow,
    strongMult: K.ai[id].strongMult,
    itemWork: sec(K.pillAction),
  };
}
const cast = (id: string) => ({ type: 'technique', id });

describe('the two tiers are data', () => {
  it('lists an ordered rule set per tier, with the genin tier plainer than the chunin one', () => {
    const genin = tierOf('genin');
    const chunin = tierOf('chunin');
    expect(genin.rules).not.toContain('interrupt');
    expect(chunin.rules).toContain('interrupt');
    expect(genin.answers).toBe('visible');
    expect(chunin.answers).toBe('known');
    expect(genin.defends).toBe('strongest');
    expect(chunin.defends).toBe('all');
    expect(content.ai.visibleTraits).toEqual(['armor', 'pack']);
  });

  it('plays a student and a genin with the genin tier and a chunin with the other', () => {
    const run = (tier: number) => {
      const fight = createFight(
        { ...scripted(['core:leaf_whirlwind']), tier },
        enemyAt(20),
        1,
        content,
        defaultRules,
      );
      fightAdvance(fight, workOf(1000), content, defaultRules);
      return fight.tier;
    };
    expect([run(0), run(1), run(2)]).toEqual([0, 1, 2]);
  });
});

describe('a genin does not interrupt, a chunin does', () => {
  const techs = [kt('int', ['interrupt'], 1), kt('big', [], 50)];
  const casting = [
    enemyView({
      cast: { kind: 'heavy', remaining: sec(2), total: sec(3), mult: 3, interruptible: true },
    }),
  ];

  it('on the same view', () => {
    expect(defaultCombatAi(view('genin', techs, casting))).toEqual(cast('big'));
    expect(defaultCombatAi(view('chunin', techs, casting))).toEqual(cast('int'));
  });

  it('in a real fight against a caster', () => {
    const interrupts = (tier: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const snap = { ...scripted(['core:dynamic_entry', 'core:leaf_great_whirlwind']), tier };
        const fight = createFight(snap, enemyAt(34, ['caster']), seed, content, defaultRules);
        fight.player.hp = fight.player.maxHp = 1e9;
        fightAdvance(fight, sec(60), content, defaultRules);
        sum += fight.tally.interrupts;
      }
      return sum;
    };
    expect(interrupts(2)).toBeGreaterThan(interrupts(1));
  });
});

describe('answers: only known traits, and a genin only the visible ones', () => {
  const answer = (trait: TraitId, tag: string) => {
    const techs = [kt('answer', [tag], 1), kt('big', [], 50)];
    const known = (t: 'genin' | 'chunin', traits: TraitId[], working: TraitId[] = traits) =>
      defaultCombatAi(view(t, techs, [enemyView({ knownTraits: traits, workingTraits: working })]));
    return { known };
  };

  it('does not answer a trait the player does not know, at either tier', () => {
    for (const [trait, tag] of [
      ['hidden', 'reveal'],
      ['armor', 'pierce'],
      ['evasive', 'bind'],
      ['regen', 'dot'],
    ] as const) {
      const { known } = answer(trait, tag);
      expect(known('genin', []), trait).toEqual(cast('big'));
      expect(known('chunin', []), trait).toEqual(cast('big'));
    }
  });

  it('answers a visible known trait at genin, and a hidden known one only at chunin', () => {
    const visible = answer('armor', 'pierce').known;
    expect(visible('genin', ['armor'])).toEqual(cast('answer'));
    expect(visible('chunin', ['armor'])).toEqual(cast('answer'));
    for (const [trait, tag] of [
      ['hidden', 'reveal'],
      ['evasive', 'bind'],
      ['regen', 'dot'],
    ] as const) {
      const { known } = answer(trait, tag);
      expect(known('genin', [trait]), `genin ${trait}`).toEqual(cast('big'));
      expect(known('chunin', [trait]), `chunin ${trait}`).toEqual(cast('answer'));
    }
  });

  it('answers a status on the player only at the chunin tier', () => {
    const techs = [kt('dispel', ['dispel'], 1), kt('big', [], 50)];
    const withStatus = (t: 'genin' | 'chunin'): FightView => {
      const v = view(t, techs, [enemyView()]);
      return {
        ...v,
        player: { ...v.player, effects: [{ id: 'illusion', kind: 'modifier', remaining: null }] },
      };
    };
    expect(defaultCombatAi(withStatus('genin'))).toEqual(cast('big'));
    expect(defaultCombatAi(withStatus('chunin'))).toEqual(cast('dispel'));
  });
});

describe('defence', () => {
  const techs = [shield('guard'), kt('big', [], 50)];
  const heavy = (mult: number, left: number, total = sec(3)) => [
    enemyView({ cast: { kind: 'heavy', remaining: left, total, mult, interruptible: true } }),
  ];

  it('a chunin guards against every heavy cast, a genin only against the strongest', () => {
    const plain = heavy(K.trait.casterMult, sec(2));
    expect(defaultCombatAi(view('chunin', techs, plain))).toEqual(cast('guard'));
    expect(defaultCombatAi(view('genin', techs, plain))).toEqual(cast('big'));
  });

  it('a genin reacts to the strongest cast only after the reaction delay', () => {
    const strong = K.bossFx.heavyCast.damageMult + K.ai.genin.strongMult;
    const total = sec(3);
    const fresh = view('genin', techs, heavy(strong, total, total));
    expect(defaultCombatAi(fresh)).toEqual(cast('big'));
    const noticed = view(
      'genin',
      techs,
      heavy(strong, total - workOf(K.ai.genin.reactMs) - 1, total),
    );
    expect(defaultCombatAi(noticed)).toEqual(cast('guard'));
    // The chunin needs no delay.
    expect(defaultCombatAi(view('chunin', techs, heavy(strong, total, total)))).toEqual(
      cast('guard'),
    );
  });
});

describe('the rule list decides', () => {
  const swapped = (rules: (id: 'genin' | 'chunin') => AiTier['rules']): ContentDb => ({
    ...content,
    ai: { ...content.ai, tiers: content.ai.tiers.map((t) => ({ ...t, rules: rules(t.id) })) },
  });
  const techs = [kt('int', ['interrupt'], 1), kt('big', [], 50)];
  const casting = [
    enemyView({
      cast: { kind: 'heavy', remaining: sec(2), total: sec(3), mult: 3, interruptible: true },
    }),
  ];
  /** The view a player of the tier gets in a fight run on `c`: the tier comes from its data. */
  const viewIn = (c: ContentDb, id: 'genin' | 'chunin'): FightView => {
    const tier = c.ai.tiers.find((t) => t.id === id);
    if (!tier) throw new Error('no tier');
    return { ...view(id, techs, casting), ai: tier };
  };

  it('gives the genin tier an interrupt by listing the rule, and takes it from the chunin by removing it', () => {
    expect(defaultCombatAi(viewIn(content, 'genin'))).toEqual(cast('big'));
    expect(
      defaultCombatAi(
        viewIn(
          swapped(() => ['interrupt', 'best', 'basic']),
          'genin',
        ),
      ),
    ).toEqual(cast('int'));
    expect(defaultCombatAi(viewIn(content, 'chunin'))).toEqual(cast('int'));
    expect(
      defaultCombatAi(
        viewIn(
          swapped(() => ['best', 'basic']),
          'chunin',
        ),
      ),
    ).toEqual(cast('big'));
  });

  it('follows the order of the list: the first rule with a decision wins', () => {
    const order = (rules: AiTier['rules']) =>
      defaultCombatAi(
        viewIn(
          swapped(() => rules),
          'chunin',
        ),
      );
    expect(order(['best', 'interrupt', 'basic'])).toEqual(cast('big'));
    expect(order(['interrupt', 'best', 'basic'])).toEqual(cast('int'));
    expect(order(['basic', 'best'])).toEqual({ type: 'basic' });
  });

  it('is what a real fight runs on: a list of the basic attack alone casts nothing', () => {
    const c = swapped(() => ['basic']);
    const fight = createFight(
      { ...scripted(['core:leaf_whirlwind']), tier: 2 },
      enemyAt(20),
      1,
      c,
      defaultRules,
    );
    fight.player.hp = fight.player.maxHp = 1e9;
    fightAdvance(fight, sec(30), c, defaultRules);
    expect(Object.keys(fight.tally.uses)).toEqual([]);
    expect(fight.tally.basic).toBeGreaterThan(5);
  });
});

describe('what the player knows of an enemy', () => {
  it('knows nothing before the first sight, the visible traits once seen and everything once beaten', () => {
    const state = fighter(1, 36);
    const wolves = 'core:guard_pack';
    expect(knowledgeOf(state, content, [wolves])[wolves]).toEqual([]);
    startFight(state, 'core:zone_guard_pack');
    expect(state.seen[wolves]).toBe(true);
    const seen = knowledgeOf(state, content, [wolves])[wolves];
    expect(seen).toEqual(expect.arrayContaining(['armor', 'pack']));
    const hidden = 'core:kiri_hunter';
    state.seen[hidden] = true;
    expect(knowledgeOf(state, content, [hidden])[hidden]).toEqual([]);
    state.counters[`kills.${hidden}`] = 1;
    expect(knowledgeOf(state, content, [hidden])[hidden]).toEqual(['hidden', 'special']);
    advance(state, 1000, content);
  });

  it('puts the knowledge of the enemy into the fight', () => {
    const state = fighter(2, 36);
    startFight(state, 'core:zone_kiri_hunter');
    expect(state.combat?.fight.knowledge['core:kiri_hunter']).toEqual([]);
    state.counters['kills.core:kiri_hunter'] = 1;
    state.combat = null;
    state.slots[0] = { action: null, progress: 0, share: 1000, data: null };
    startFight(state, 'core:zone_kiri_hunter');
    const fresh: GameState = state;
    expect(fresh.combat?.fight.knowledge['core:kiri_hunter']).toContain('hidden');
  });
});
