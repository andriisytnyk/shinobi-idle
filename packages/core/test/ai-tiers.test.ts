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
import { fighter, know, startFight } from './prep-state.ts';
import { aiVocab, viewTechnique } from './view-helpers.ts';
import { advance } from '../src/index.ts';

const tierOf = (id: 'student' | 'genin' | 'chunin'): AiTier => {
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
const vt = (tech: KitTechnique): ViewTechnique => viewTechnique(tech);
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
    vocab: aiVocab,
    pouch: [],
    medic: null,
    stance: null,
    hastened: false,
    itemWork: sec(K.pillAction),
  };
}
const cast = (id: string) => ({ type: 'technique', id });

/** A heavy cast under way: `elapsed` work units into a wind-up of `total`; `known` when its trait or mechanic is. */
const cast_ = (elapsed: number, known: boolean, total = sec(3)) =>
  enemyView({
    cast: { kind: 'heavy', remaining: total - elapsed, total, mult: 3, interruptible: true, known },
  });

describe('the two tiers are data', () => {
  it('lists an ordered rule set per tier: rank decides what the tactics can do', () => {
    const genin = tierOf('genin');
    const chunin = tierOf('chunin');
    // Both interrupt and answer; the genin needs a reaction delay and does not reserve an interrupt.
    expect(genin.rules).toContain('interrupt');
    expect(chunin.rules).toContain('interrupt');
    // A higher tier waits for the moment less.
    expect(genin.waitMs).toBeGreaterThan(chunin.waitMs);
    expect(genin.tactical).toBe(false);
    expect(chunin.tactical).toBe(true);
    expect(content.ai.visibleTraits).toEqual(['armor', 'pack']);
  });

  it('plays a student, a genin and a chunin each with the tier of its rank', () => {
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

describe('interrupts: a genin answers a cast it knows, a chunin any (both when their wait ends)', () => {
  const techs = [kt('int', ['interrupt'], 1), kt('big', [], 50)];
  const react = 1;

  it('interrupts a cast it knows to be heavy as soon as it decides: the wait is its reaction', () => {
    expect(defaultCombatAi(view('genin', techs, [cast_(0, true)]))).toEqual(cast('int'));
    expect(defaultCombatAi(view('genin', techs, [cast_(react + 1, true)]))).toEqual(cast('int'));
  });

  it('interrupts any cast it sees: the tiers do not differ in what they see', () => {
    expect(defaultCombatAi(view('genin', techs, [cast_(react + 1, false)]))).toEqual(cast('int'));
    expect(defaultCombatAi(view('chunin', techs, [cast_(0, false)]))).toEqual(cast('int'));
  });

  it('does not reserve an interrupt for a known caster, whatever the tier', () => {
    const waiting = (t: 'genin' | 'chunin') =>
      defaultCombatAi(
        view(
          t,
          [kt('int', ['interrupt'], 30), kt('plain', [], 10)],
          [enemyView({ knownTraits: ['caster'], workingTraits: ['caster'], nextCastIn: sec(2) })],
        ),
      );
    expect(waiting('genin')).toEqual(cast('int'));
    expect(waiting('chunin')).toEqual(cast('int'));
  });

  it('in a real fight against a caster the player knows, both interrupt', () => {
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
    expect(interrupts(1)).toBeGreaterThan(0);
    expect(interrupts(2)).toBeGreaterThan(0);
  });
});

describe('answers: every known trait, at either tier, and nothing else', () => {
  const known = (t: 'genin' | 'chunin', tag: string, traits: TraitId[]) =>
    defaultCombatAi(
      view(
        t,
        [kt('answer', [tag], 1), kt('big', [], 50)],
        [enemyView({ knownTraits: traits, workingTraits: traits })],
      ),
    );
  const pairs = [
    ['hidden', 'reveal'],
    ['armor', 'pierce'],
    ['evasive', 'bind'],
    ['regen', 'dot'],
  ] as const;

  it('does not answer a trait the player does not know', () => {
    for (const [trait, tag] of pairs) {
      expect(known('genin', tag, []), trait).toEqual(cast('big'));
      expect(known('chunin', tag, []), trait).toEqual(cast('big'));
    }
  });

  it('answers a known trait, hidden ones included, as a genin and as a chunin', () => {
    for (const [trait, tag] of pairs) {
      expect(known('genin', tag, [trait]), `genin ${trait}`).toEqual(cast('answer'));
      expect(known('chunin', tag, [trait]), `chunin ${trait}`).toEqual(cast('answer'));
    }
  });

  it('answers a status on the player at both tiers', () => {
    const techs = [kt('dispel', ['dispel'], 1), kt('big', [], 50)];
    for (const t of ['genin', 'chunin'] as const) {
      const v = view(t, techs, [enemyView()]);
      const withStatus: FightView = {
        ...v,
        player: { ...v.player, effects: [{ id: 'illusion', kind: 'modifier', remaining: null }] },
      };
      expect(defaultCombatAi(withStatus)).toEqual(cast('dispel'));
    }
  });
});

describe('defence is not a matter for the AI', () => {
  it('has no rule that defends, in any tier of the content', () => {
    for (const tier of content.ai.tiers) expect(tier.rules as string[]).not.toContain('defend');
  });

  it('never puts a defensive technique into the hand: the kit of a fight has none', () => {
    const fight = createFight(
      scripted(['core:clone', 'core:body_replacement', 'core:leaf_whirlwind']),
      enemyAt(10),
      1,
      content,
      defaultRules,
    );
    expect(fight.kit.techniques.map((t) => t.id)).toEqual(['core:leaf_whirlwind']);
  });
});

describe('the rule list decides', () => {
  const swapped = (rules: (id: string) => AiTier['rules']): ContentDb => ({
    ...content,
    ai: { ...content.ai, tiers: content.ai.tiers.map((t) => ({ ...t, rules: rules(t.id) })) },
  });
  const techs = [kt('int', ['interrupt'], 1), kt('big', [], 50)];
  const casting = [cast_(sec(1.5), true)];
  /** The view a player of the tier gets in a fight run on `c`: the tier comes from its data. */
  const viewIn = (c: ContentDb, id: 'genin' | 'chunin'): FightView => {
    const tier = c.ai.tiers.find((t) => t.id === id);
    if (!tier) throw new Error('no tier');
    return { ...view(id, techs, casting), ai: tier };
  };

  it('takes the interrupt from a tier by removing the rule, and the other way round', () => {
    const none = swapped(() => ['best', 'basic']);
    expect(defaultCombatAi(viewIn(content, 'genin'))).toEqual(cast('int'));
    expect(defaultCombatAi(viewIn(none, 'genin'))).toEqual(cast('big'));
    expect(defaultCombatAi(viewIn(content, 'chunin'))).toEqual(cast('int'));
    expect(defaultCombatAi(viewIn(none, 'chunin'))).toEqual(cast('big'));
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
    expect(state.bingo[wolves]?.seen).toBe(1);
    const seen = knowledgeOf(state, content, [wolves])[wolves];
    expect(seen).toEqual(expect.arrayContaining(['armor', 'pack']));
    const hidden = 'core:kiri_hunter';
    state.bingo[hidden] = { seen: 1, wins: 0, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
    expect(knowledgeOf(state, content, [hidden])[hidden]).toEqual([]);
    state.bingo[hidden] = { seen: 1, wins: 1, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
    expect(knowledgeOf(state, content, [hidden])[hidden]).toEqual(['hidden', 'special']);
    advance(state, 1000, content);
    // A boss teaches as much with a defeat as with a win.
    const lost = 'core:boss_nameless';
    state.bingo[lost] = { seen: 1, wins: 0, losses: 1, timeouts: 0, bought: 0, bounty: 0 };
    expect(knowledgeOf(state, content, [lost])[lost]).toContain('illusionist');
  });

  it('puts the knowledge of the enemy into the fight', () => {
    const state = fighter(2, 36);
    startFight(state, 'core:zone_kiri_hunter');
    expect(state.combat?.fight.knowledge['core:kiri_hunter']).toEqual([]);
    know(state, 'core:kiri_hunter');
    state.combat = null;
    state.slots[0] = { action: null, progress: 0, share: 1000, data: null };
    startFight(state, 'core:zone_kiri_hunter');
    const fresh: GameState = state;
    expect(fresh.combat?.fight.knowledge['core:kiri_hunter']).toContain('hidden');
  });
});
