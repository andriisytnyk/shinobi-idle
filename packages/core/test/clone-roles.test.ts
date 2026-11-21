/**
 * Roles of the combat clones: the hand of a clone is built from the techniques the character knows by the
 * rule of the chosen role (data in `content.cloneRoles`); the default role copies the character's hand and
 * leaves every fight as it was.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  STATE_VERSION,
  advance,
  alliesOf,
  battleReport,
  cloneRoleOf,
  createFight,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  fightAdvance,
  fightNextEventIn,
  parseFight,
  pickCloneHand,
  recordFight,
  serialize,
  workOf,
  type CombatAi,
  type FightState,
  type PlayerSnapshot,
} from '../src/index.ts';
import { enemyAt, rules, scripted, withAi } from './fight-helpers.ts';
import { modContent, modRules, plainContent } from './packs-helpers.ts';
import { fighter, run, startFight } from './prep-state.ts';

const CLONE = 'core:shadow_clone';
const LOTUS = 'core:front_lotus';
const GATE = 'core:gate_of_opening';
const FIST = 'core:drunken_fist';
const ENTRY = 'core:dynamic_entry';
const GALE_PALM = 'core:gale_palm';
const FANG = 'core:lightning_beast_tracking_fang';
const WAVE = 'core:wild_water_wave';
const FIRE = 'core:running_fire';
/** What the character knows in these tests: the clone technique, two stances (one of them with a Wound price), a wet technique with partners for its combos, a burning one with a partner, and plain strikes. */
const KNOWN = [CLONE, GATE, LOTUS, ENTRY, FIST, GALE_PALM, FANG, WAVE, FIRE];

const snapshot = (role?: string): PlayerSnapshot => ({
  ...scripted(KNOWN),
  ...(role === undefined ? {} : { cloneRole: role }),
});
const kitOf = (role?: string, db = content) =>
  createFight(snapshot(role), enemyAt(20), 1, db, rules).kit;
const ids = (hand: readonly { id: string }[] | undefined) => hand?.map((t) => t.id);

describe('the hand of the clones by role', () => {
  it('«Як ти» copies the character: no hand of its own, and the kit is what it always was', () => {
    const kit = kitOf('core:role_mirror');
    expect('cloneHand' in kit).toBe(false);
    expect('cloneThreat' in kit).toBe(false);
    expect('cloneRole' in kit).toBe(false);
    // No role chosen is the same fight, down to the byte.
    const bytes = (role?: string) =>
      JSON.stringify(createFight(snapshot(role), enemyAt(20), 1, content, rules));
    expect(bytes()).toBe(bytes('core:role_mirror'));
  });

  it('«Натиск» takes the techniques that hit hardest, a stance one left out', () => {
    // Damage in the kit, highest first (a clone has no stance, and the clone technique does not strike).
    const kit = kitOf('core:role_assault');
    const byDamage = kit.techniques
      .filter((t) => t.fx.kind === 'damage' && !t.requiresStance)
      .sort((a, b) => b.damage - a.damage || (a.id < b.id ? -1 : 1))
      .map((t) => t.id);
    expect(ids(kit.cloneHand)).toEqual(byDamage.slice(0, 3));
    expect(ids(kit.cloneHand)).toContain(FIST);
    expect(ids(kit.cloneHand)).not.toContain(LOTUS);
    expect(kit.cloneRole).toBe('core:role_assault');
    expect('cloneThreat' in kit).toBe(false);
  });

  it('«Підтримка» takes the technique whose state opens the most combos of the other techniques', () => {
    const kit = kitOf('core:role_support');
    // Wet opens two combos here (the lightning beast shocks it, the fire steams it); burn opens one (the gale palm fans it).
    expect(ids(kit.cloneHand)?.slice(0, 2)).toEqual([WAVE, FIRE]);
    expect(kit.cloneHand).toHaveLength(3);
    // With no wet technique known, burn (one combo) comes first.
    const lone = createFight(
      { ...scripted([FIRE, GALE_PALM, FIST]), cloneRole: 'core:role_support' },
      enemyAt(20),
      1,
      content,
      rules,
    ).kit;
    expect(ids(lone.cloneHand)?.[0]).toBe(FIRE);
  });

  it('«Відволікання» takes the cheap techniques and makes the enemies mind the clones', () => {
    const kit = kitOf('core:role_distract');
    const own = (id: string) => kit.techniques.find((t) => t.id === id);
    expect(ids(kit.cloneHand)).toEqual([ENTRY, FIRE, FIST]);
    expect(own(ENTRY)?.cost).toBeLessThan(own(FIST)?.cost ?? 0);
    expect(kit.cloneThreat).toBe(cloneRoleOf(content, 'core:role_distract')?.threat);
    expect(kit.cloneThreat).toBeGreaterThan(1);
  });

  it('reads the cost of a technique as a share of its own pool, so chakra and stamina compare fairly', () => {
    const distract = cloneRoleOf(content, 'core:role_distract');
    expect(distract?.hand.mode).toBe('pick');
    if (!distract) return;
    const base = kitOf().techniques[0];
    if (!base) throw new Error('no technique in the kit');
    // Same damage, no status, no combos: only the price tells them apart.
    const tech = (id: string, pool: 'chakra' | 'stamina', cost: number) => ({
      ...base,
      id,
      pool,
      cost,
      damage: 10,
      fx: { ...base.fx, statuses: [] },
    });
    // 30 stamina is 30% of a pool of 100; 40 chakra is 4% of a pool of 1000: the chakra one is far cheaper.
    const stamina = tech('t:stamina', 'stamina', 30);
    const chakra = tech('t:chakra', 'chakra', 40);
    const pools = { chakra: 1000, stamina: 100 };
    const role = {
      ...distract,
      hand: { ...distract.hand, size: 1, weights: { damage: 0, status: 0, opens: 0, cheap: 1 } },
    };
    const hand = pickCloneHand(content, role, [stamina, chakra], [stamina, chakra], pools);
    // On raw costs the stamina technique (30 < 40) would be picked.
    expect(ids(hand)).toEqual(['t:chakra']);
  });

  it('reports the habituation to techniques that only the clones cast', () => {
    const snap: PlayerSnapshot = { ...snapshot('core:role_assault'), loadout: [ENTRY, CLONE] };
    const fight = createFight(snap, enemyAt(20), 1, content, rules);
    const only = (fight.kit.cloneHand ?? []).find(
      (t) => !fight.kit.techniques.some((x) => x.id === t.id),
    );
    expect(only).toBeDefined();
    if (!only) return;
    fight.uses[only.id] = 12;
    const state = createState(1, content);
    recordFight(state, 'k', fight, 'win', content, true);
    expect(battleReport(state, 'k').habLow[only.id]).toBeLessThan(1);
  });

  it('is chosen from what the character knows, the loadout or not, and the character keeps their own hand', () => {
    const snap: PlayerSnapshot = {
      ...snapshot('core:role_assault'),
      loadout: [ENTRY, CLONE],
    };
    const kit = createFight(snap, enemyAt(20), 1, content, rules).kit;
    expect(ids(kit.techniques)?.sort()).toEqual([CLONE, ENTRY].sort());
    expect(ids(kit.cloneHand)).toContain(FIST);
    expect(ids(kit.cloneHand)).not.toContain(ENTRY);
  });

  it('is chosen the same way every time', () => {
    for (const role of cloneRoles()) {
      expect(JSON.stringify(kitOf(role))).toBe(JSON.stringify(kitOf(role)));
    }
  });

  it('falls back to the default role when the role is not in the content', () => {
    const gone = kitOf('core:role_removed');
    expect(JSON.stringify(gone)).toBe(JSON.stringify(kitOf()));
    expect(cloneRoleOf(content, 'gone:role')?.id).toBe('core:role_mirror');
    expect(cloneRoleOf(content, null)?.id).toBe('core:role_mirror');
  });

  it('works for a role a mod adds', () => {
    const kit = kitOf('testmod:role_decoy', modContent);
    expect(kit.cloneHand).toHaveLength(1);
    expect(kit.cloneHand?.[0]?.id).toBe(ENTRY);
    expect(kit.cloneThreat).toBe(3);
    expect(kit.cloneRole).toBe('testmod:role_decoy');
    // The same choice with the pack gone is the default role.
    expect(
      JSON.stringify(
        createFight(snapshot('testmod:role_decoy'), enemyAt(20), 1, plainContent, rules),
      ),
    ).toBe(JSON.stringify(createFight(snapshot(), enemyAt(20), 1, plainContent, rules)));
  });
});

function cloneRoles(): string[] {
  return content.cloneRoles.map((r) => r.id);
}

/** A character who casts the clone technique first and then plays by the game's own AI; the clones play by it too. */
const cloner: CombatAi = (view) => {
  const clone = view.techniques.find((r) => r.ready && r.tech.id === CLONE);
  return clone ? { type: 'technique', id: CLONE } : defaultRules.combatAi(view);
};

function summoned(role: string | undefined, seed = 4, db = content, r = withAi(cloner, rules)) {
  const fight = createFight(snapshot(role), enemyAt(20), seed, db, r);
  while ((fight.tally.uses[CLONE] ?? 0) < 1 && fight.result === 'ongoing') {
    fightAdvance(fight, fightNextEventIn(fight, db, r) ?? 1, db, r);
  }
  return { fight, r };
}

/** The techniques the clones cast over `ms`, by the log. */
function castByClones(fight: FightState, r = withAi(cloner, rules), ms = 90_000): Set<string> {
  fight.log = [];
  fightAdvance(fight, workOf(ms), content, r);
  const seen = new Set<string>();
  for (const l of fight.log ?? []) {
    if (l.side === 'player' && l.ally !== undefined && l.act === 'cast' && l.tech) seen.add(l.tech);
  }
  return seen;
}

describe('clones in a fight', () => {
  it('cast only what the role gave them, and not what «Як ти» gives', () => {
    const mirror = summoned('core:role_mirror');
    const assault = summoned('core:role_assault');
    const hand = new Set(ids(assault.fight.kit.cloneHand));
    const cast = castByClones(assault.fight);
    expect(cast.size).toBeGreaterThan(0);
    for (const id of cast) expect(hand.has(id), `${id} is not in the hand`).toBe(true);
    // The clones of «Як ти» use the character's hand, which has what «Натиск» left out.
    const same = castByClones(mirror.fight);
    expect([...same].some((id) => !hand.has(id))).toBe(true);
  });

  it("may cast a technique that is not in the character's loadout", () => {
    const snap: PlayerSnapshot = { ...snapshot('core:role_assault'), loadout: [ENTRY, CLONE] };
    const r = withAi(cloner, rules);
    const fight = createFight(snap, enemyAt(20), 4, content, r);
    while ((fight.tally.uses[CLONE] ?? 0) < 1 && fight.result === 'ongoing') {
      fightAdvance(fight, fightNextEventIn(fight, content, r) ?? 1, content, r);
    }
    const cast = castByClones(fight, r);
    expect([...cast].some((id) => id !== ENTRY)).toBe(true);
    for (const id of cast) expect(ids(fight.kit.cloneHand)).toContain(id);
  });

  it('draw the enemies by the threat the role gives', () => {
    const threat = (role: string) => alliesOf(summoned(role).fight)[0]?.data.threat ?? 0;
    const base = threat('core:role_mirror');
    expect(base).toBeGreaterThan(0);
    expect(threat('core:role_assault')).toBe(base);
    expect(threat('core:role_distract')).toBeCloseTo(
      base * (cloneRoleOf(content, 'core:role_distract')?.threat ?? 0),
      9,
    );
    expect(
      alliesOf(summoned('testmod:role_decoy', 4, modContent, withAi(cloner, modRules)).fight)[0]
        ?.data.threat,
    ).toBeCloseTo(base * 3, 9);
  });

  it('play the same fight from the same seed, however time is cut', () => {
    const run1 = (cuts: number[]) => {
      const { fight, r } = summoned('core:role_assault', 5);
      for (const ms of cuts) fightAdvance(fight, workOf(ms), content, r);
      return JSON.stringify(fight);
    };
    const whole = run1([60_000]);
    expect(run1([1, 999, 12_345, 20_000, 26_655])).toBe(whole);
    expect(run1(Array.from({ length: 600 }, () => 100))).toBe(whole);
  });

  it('are read back from the saved fight, with the hand they were given', () => {
    const { fight, r } = summoned('core:role_assault');
    fightAdvance(fight, workOf(9000), content, r);
    const raw = JSON.parse(JSON.stringify(fight)) as unknown;
    const back = parseFight(raw, content);
    expect(back).toEqual(raw);
    expect(ids(back?.kit.cloneHand)).toEqual(ids(fight.kit.cloneHand));
    fightAdvance(fight, workOf(20_000), content, r);
    if (back) fightAdvance(back, workOf(20_000), content, r);
    expect(JSON.parse(JSON.stringify(back))).toEqual(JSON.parse(JSON.stringify(fight)));
  });

  it('refuse a clone that casts what neither hand has', () => {
    const { fight } = summoned('core:role_assault');
    const copy = JSON.parse(JSON.stringify(fight)) as {
      allies: { phase: string; act: unknown }[];
      kit: { cloneHand: { id: string }[] };
    };
    const a = copy.allies[0];
    if (!a) throw new Error('no clone');
    a.phase = 'act';
    a.act = { kind: 'technique', id: ENTRY, target: null };
    // ENTRY is in the character's kit: allowed. Drop it from the kit's techniques and the hand and it is not.
    expect(parseFight(copy, content)).not.toBeNull();
    a.act = { kind: 'technique', id: 'core:nope', target: null };
    expect(parseFight(copy, content)).toBeNull();
  });
});

describe('the role in the game', () => {
  it('is chosen by a command, checked against the content, and the default is no choice', () => {
    const state = fighter(3);
    expect(state.loadouts.cloneRole).toBeNull();
    run(state, { type: 'loadout.cloneRole', role: 'core:role_assault' });
    expect(state.loadouts.cloneRole).toBe('core:role_assault');
    const refused = dispatch(state, { type: 'loadout.cloneRole', role: 'core:nope' }, content);
    expect(refused).toEqual({ ok: false, reason: 'error.unknownCloneRole' });
    expect(state.loadouts.cloneRole).toBe('core:role_assault');
    run(state, { type: 'loadout.cloneRole', role: null });
    expect(state.loadouts.cloneRole).toBeNull();
  });

  it('reaches the fight a started action makes', () => {
    const state = fighter(2, 50);
    state.known[CLONE] = true;
    state.mastery[CLONE] = { xp: 0 } as never;
    run(state, { type: 'loadout.prepare', encounter: 'core:zone_wolfmask' });
    run(state, { type: 'loadout.cloneRole', role: 'core:role_distract' });
    startFight(state, 'core:zone_wolfmask');
    const kit = state.combat?.fight.kit;
    expect(kit?.cloneRole).toBe('core:role_distract');
    expect(kit?.cloneHand?.length).toBeGreaterThan(0);
    // The fight in progress keeps its role when the choice changes.
    run(state, { type: 'loadout.cloneRole', role: null });
    advance(state, 1000, content);
    expect(state.combat?.fight.kit.cloneRole).toBe('core:role_distract');
    // It is saved with the state.
    const copy = deserialize(serialize(state, 0), content);
    expect(copy.combat?.fight.kit.cloneRole).toBe('core:role_distract');
    expect(copy.loadouts.cloneRole).toBeNull();
  });
});

describe('saves', () => {
  it('a version 20 save gets the default role', () => {
    const state = createState(1, content);
    const raw = JSON.parse(serialize(state)) as {
      v: number;
      state: { v: number; loadouts: Record<string, unknown> };
    };
    raw.v = 20;
    raw.state.v = 20;
    delete raw.state.loadouts.cloneRole;
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(STATE_VERSION).toBe(22);
    expect(loaded.loadouts.cloneRole).toBeNull();
  });

  it('keeps the chosen role through a save, and a role that is gone is chosen again when it returns', () => {
    const state = createState(1, modContent);
    state.player.rank = 'genin';
    run2(state, 'testmod:role_decoy');
    const text = serialize(state, 0);
    expect(deserialize(text, modContent, modRules).loadouts.cloneRole).toBe('testmod:role_decoy');
    // Without the pack the choice waits in the dormant bin, and the state holds the default.
    const without = deserialize(text, plainContent);
    expect(without.loadouts.cloneRole).toBeNull();
    const back = deserialize(serialize(without, 0), modContent, modRules);
    expect(back.loadouts.cloneRole).toBe('testmod:role_decoy');
  });

  it('keeps a choice of a role the content does not know, and the fight plays it as the default', () => {
    const state = createState(1, content);
    state.loadouts.cloneRole = 'core:role_removed';
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.loadouts.cloneRole).toBe('core:role_removed');
    expect(JSON.stringify(kitOf('core:role_removed'))).toBe(JSON.stringify(kitOf()));
  });
});

function run2(state: ReturnType<typeof createState>, role: string): void {
  const result = dispatch(state, { type: 'loadout.cloneRole', role }, modContent);
  if (!result.ok) throw new Error(result.reason);
}
