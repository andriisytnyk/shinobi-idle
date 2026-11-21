/**
 * The target priority: which enemy the player's side attacks first. The default rule picks the body whose fall takes the
 * most damage per second off the player's side (helpers a leader calls back while he lives get no priority); the setting of the
 * loadout (`content.targetPriorities`) can name another rule. The rule and the flags are data.
 */
import { content, type Boss, type ContentDb } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  STATE_VERSION,
  alive,
  aimedEnemy,
  analyzeFight,
  createFight,
  createState,
  defaultCombatAi,
  deserialize,
  dispatch,
  encounterFor,
  fightAdvance,
  serialize,
  snapshotPlayer,
  workOf,
  type FightState,
  type FightView,
  type PlayerSnapshot,
} from '../src/index.ts';
import { rules, scripted, sec, withAi } from './fight-helpers.ts';
import { fighter, run, unlock } from './prep-state.ts';

const PRIORITY = {
  auto: 'core:prio_auto',
  adds: 'core:prio_adds',
  leader: 'core:prio_leader',
  weakest: 'core:prio_weakest',
} as const;

const WOLF = 'core:boss_wolf';
const bossOf = (db: ContentDb, id: string): Boss => {
  const b = db.bosses.find((x) => x.id === id);
  if (!b) throw new Error(`no boss ${id}`);
  return b;
};

/** The content with the flag of the wolf pack set as given: the pack comes back while the leader lives, or it does not. */
function withRespawns(respawns: boolean, id = WOLF): ContentDb {
  return {
    ...content,
    bosses: content.bosses.map((b) =>
      b.id === id && b.special.companions
        ? { ...b, special: { ...b.special, companions: { ...b.special.companions, respawns } } }
        : b,
    ),
  };
}

/** The content with the wolf pack called back every `ms` ms. */
function withRecall(ms: number, base: ContentDb = content): ContentDb {
  const K = base.balance.K;
  const row = (K.bossFx as Record<string, Record<string, number>>).wolfPack as Record<
    string,
    number
  >;
  return {
    ...base,
    balance: {
      ...base.balance,
      K: { ...K, bossFx: { ...K.bossFx, wolfPack: { ...row, everyMs: ms } } },
    },
  };
}

const snap = (priority?: keyof typeof PRIORITY): PlayerSnapshot => ({
  ...scripted(['core:leaf_whirlwind', 'core:front_lotus']),
  targetPriority: PRIORITY[priority ?? 'auto'],
});

function wolfFight(
  db: ContentDb,
  priority?: keyof typeof PRIORITY,
  seed = 3,
): { fight: FightState; leader: string; pack: string[] } {
  const fight = createFight(snap(priority), encounterFor(bossOf(db, WOLF), db), seed, db, rules);
  const [lead, ...pack] = fight.enemies;
  if (!lead) throw new Error('no leader');
  return { fight, leader: lead.id, pack: pack.map((e) => e.id) };
}

/** The target the AI names at its first choice, and the view it chose from. */
function firstTarget(
  db: ContentDb,
  priority?: keyof typeof PRIORITY,
  mutate: (f: FightState) => void = () => {},
): { target: string | undefined; view: FightView; fight: FightState } {
  const { fight } = wolfFight(db, priority);
  mutate(fight);
  let target: string | undefined;
  let seen: FightView | undefined;
  const spy = withAi((view) => {
    const d = defaultCombatAi(view);
    if (seen === undefined) {
      seen = view;
      target = d.type === 'wait' ? undefined : d.target;
    }
    return d;
  });
  fightAdvance(fight, sec(5), db, spy);
  if (!seen) throw new Error('the AI never chose');
  return { target, view: seen, fight };
}

/** Who falls first when the fight is played to the end (the id of the first body down). */
function firstToFall(db: ContentDb, priority?: keyof typeof PRIORITY, seed = 3): string | null {
  const { fight } = wolfFight(db, priority, seed);
  // A player strong enough to win, and one that cannot die before the order of the kills shows.
  fight.player.hp = fight.player.maxHp = 1e12;
  fight.player.damage = 1e4;
  let first: string | null = null;
  const base = rules.combatAi;
  const spy = withAi((view) => base(view));
  const known = new Set(fight.enemies.map((e) => e.id));
  while (fight.result === 'ongoing' && fight.t < workOf(120_000) && first === null) {
    fightAdvance(fight, sec(0.25), db, spy);
    first = fight.enemies.find((e) => known.has(e.id) && !alive(e))?.id ?? null;
  }
  return first;
}

describe('the data', () => {
  it('has four settings, one of them the default, and the wolf pack is flagged as coming back', () => {
    expect(content.targetPriorities.map((p) => p.rule).sort()).toEqual(
      ['adds', 'auto', 'leader', 'weakest'].sort(),
    );
    expect(content.targetPriorities.filter((p) => p.default === true)).toHaveLength(1);
    expect(bossOf(content, WOLF).special.companions?.respawns).toBe(true);
  });
});

describe('the automatic rule', () => {
  it('kills the wolves first when the pack is called back rarely (the data of the first boss)', () => {
    const { fight, leader, pack } = wolfFight(content);
    expect(pack.length).toBeGreaterThan(0);
    const { target, view } = firstTarget(content);
    // The mechanic is known to the fight's player: the flag shows on the helpers.
    expect(view.enemies.filter((e) => e.respawns).map((e) => e.id)).toEqual(pack);
    expect(pack).toContain(target);
    expect(fight.enemies[0]?.id).toBe(leader);
    expect(pack).toContain(firstToFall(content));
  });

  it('kills the helpers first when they do not come back', () => {
    const db = withRespawns(false);
    const { leader, pack } = wolfFight(db);
    const { target } = firstTarget(db);
    expect(target).not.toBe(leader);
    expect(pack).toContain(target);
    expect(firstToFall(db)).not.toBe(leader);
  });

  it('puts the leader first when the helpers come back almost at once (the interval, from data)', () => {
    const db = withRecall(1000);
    const { leader } = wolfFight(db);
    expect(firstTarget(db).target).toBe(leader);
    expect(firstToFall(db)).toBe(leader);
  });

  it('reads the flag from the data of any boss, not from an id: a mod boss with a pack', () => {
    const base = bossOf(content, WOLF);
    const mod: Boss = { ...base, id: 'testmod:boss_pack' };
    const db = (respawns: boolean): ContentDb => ({
      ...withRecall(1000),
      bosses: [
        ...content.bosses,
        {
          ...mod,
          special: {
            ...mod.special,
            companions: { ...(mod.special.companions as object), respawns } as never,
          },
        },
      ],
    });
    const aim = (respawns: boolean) => {
      const d = db(respawns);
      const fight = createFight(snap(), encounterFor(bossOf(d, mod.id), d), 3, d, rules);
      let target: string | undefined;
      fightAdvance(
        fight,
        sec(2),
        d,
        withAi((view) => {
          const out = defaultCombatAi(view);
          if (target === undefined && out.type !== 'wait') target = out.target;
          return out;
        }),
      );
      return { target, leader: fight.enemies[0]?.id };
    };
    expect(aim(true).target).toBe(aim(true).leader);
    expect(aim(false).target).not.toBe(aim(false).leader);
  });

  it('does not know that the helpers come back before the mechanic is known', () => {
    const { view } = firstTarget(content, undefined, (f) => {
      f.knowledge = { [WOLF]: [] };
    });
    expect(view.enemies.some((e) => e.respawns)).toBe(false);
  });

  it('moves the damage per second from the level to what the body does once it has acted', () => {
    const fresh = firstTarget(content).view.enemies[0];
    const acted = firstTarget(content, undefined, (f) => {
      const l = f.enemies[0];
      if (l)
        l.last = {
          kind: 'attack',
          id: null,
          outcome: 'hit',
          damage: l.damage,
          statuses: [],
          combos: [],
          at: 0,
          avoidedBy: null,
        };
    });
    const lead = acted.fight.enemies[0];
    if (!lead || !fresh) throw new Error('no leader');
    expect(acted.view.enemies[0]?.dps).toBeCloseTo(
      (lead.damage * 1000) / (lead.waitMs + lead.strikeMs),
      6,
    );
    // The boss hits harder than its level says, so the number moves.
    expect(acted.view.enemies[0]?.dps).toBeGreaterThan(fresh.dps);
  });
});

describe('the settings', () => {
  it('«Спершу ватажок» aims at the leader even when the helpers do not come back', () => {
    const db = withRespawns(false);
    const { leader } = wolfFight(db);
    expect(firstTarget(db, 'leader').target).toBe(leader);
    expect(firstToFall(db, 'leader')).toBe(leader);
  });

  it('«Спершу помічники» aims at the helpers, the one with the least health first, even when they come back', () => {
    const { pack } = wolfFight(content);
    const first = firstTarget(content, 'adds');
    expect(pack).toContain(first.target);
    const hps = first.view.enemies.filter((e) => !e.leader).map((e) => e.hp);
    const chosen = first.view.enemies.find((e) => e.id === first.target);
    expect(chosen?.hp).toBe(Math.min(...hps));
    expect(pack).toContain(firstToFall(content, 'adds'));
  });

  it('«Найслабший» aims at the body with the least health', () => {
    const first = firstTarget(content, 'weakest');
    const chosen = first.view.enemies.find((e) => e.id === first.target);
    expect(chosen?.hp).toBe(Math.min(...first.view.enemies.map((e) => e.hp)));
    const lowered = firstTarget(content, 'weakest', (f) => {
      const l = f.enemies[0];
      if (l) l.hp = 1;
    });
    expect(lowered.target).toBe(lowered.fight.enemies[0]?.id);
  });

  it('puts no target on a fight against one body, and leaves such a fight as it was', () => {
    const one = encounterFor(
      content.bosses.find((b) => b.id === 'core:boss_hunter')!,
      content,
    );
    const bytes = (priority?: keyof typeof PRIORITY) => {
      const fight = createFight(snap(priority), one, 5, content, rules);
      fightAdvance(fight, sec(20), content, rules);
      // The setting itself is in the kit; the rest of the fight is what is compared.
      delete fight.kit.targetPriority;
      return JSON.stringify(fight);
    };
    // Auto picks the only body, so nothing is named; «Найслабший» does the same.
    expect(bytes()).toBe(bytes('auto'));
    expect(bytes()).toBe(bytes('weakest'));
  });

  it('is written in the kit only when it is not the default one', () => {
    const kit = (priority?: keyof typeof PRIORITY) =>
      createFight(snap(priority), encounterFor(bossOf(content, WOLF), content), 3, content, rules)
        .kit;
    expect('targetPriority' in kit('leader')).toBe(false);
    expect(kit('auto').targetPriority).toBe(PRIORITY.auto);
    // A setting the content does not have plays the default one, and is not written.
    const gone = createFight(
      { ...snap(), targetPriority: 'testmod:gone' },
      encounterFor(bossOf(content, WOLF), content),
      3,
      content,
      rules,
    );
    expect('targetPriority' in gone.kit).toBe(false);
    expect(JSON.stringify(gone)).toBe(JSON.stringify(wolfFight(content, 'leader').fight));
  });
});

describe('determinism', () => {
  it('plays the same fight twice and in any cut of the time, for each setting', () => {
    for (const priority of [undefined, 'adds', 'leader', 'weakest'] as const) {
      const db = withRespawns(false);
      const whole = wolfFight(db, priority).fight;
      const twice = wolfFight(db, priority).fight;
      const cut = wolfFight(db, priority).fight;
      fightAdvance(whole, sec(40), db, rules);
      fightAdvance(twice, sec(40), db, rules);
      for (let i = 0; i < 40; i++) fightAdvance(cut, sec(1), db, rules);
      expect(JSON.stringify(twice), String(priority)).toBe(JSON.stringify(whole));
      expect(JSON.stringify(cut), String(priority)).toBe(JSON.stringify(whole));
    }
  });
});

describe('the setting in the game', () => {
  it('is chosen by a command, checked against the content, and the default is no choice', () => {
    const state = fighter(3);
    expect(state.loadouts.targetPriority).toBeNull();
    run(state, { type: 'loadout.targetPriority', priority: PRIORITY.adds });
    expect(state.loadouts.targetPriority).toBe(PRIORITY.adds);
    expect(snapshotPlayer(state, content, rules).targetPriority).toBe(PRIORITY.adds);
    const refused = dispatch(
      state,
      { type: 'loadout.targetPriority', priority: 'core:nope' },
      content,
    );
    expect(refused).toEqual({ ok: false, reason: 'error.unknownTargetPriority' });
    expect(state.loadouts.targetPriority).toBe(PRIORITY.adds);
    run(state, { type: 'loadout.targetPriority', priority: null });
    expect(state.loadouts.targetPriority).toBeNull();
    expect(snapshotPlayer(state, content, rules).targetPriority).toBeUndefined();
  });

  it('is followed by the forecast, which plays its fights with the same setting', () => {
    const state = fighter(3, 30);
    unlock(state, 'core:boss_wolf');
    const seen = new Set<string>();
    const spy = withAi((view) => {
      seen.add(view.priority);
      return defaultCombatAi(view);
    });
    run(state, { type: 'loadout.targetPriority', priority: PRIORITY.weakest });
    const target = { kind: 'boss', id: 'core:zone_boss_wolf' } as const;
    analyzeFight(state, target, { samples: 3, maxSessions: 1 }, content, spy);
    expect([...seen]).toEqual(['weakest']);
    seen.clear();
    run(state, { type: 'loadout.targetPriority', priority: null });
    analyzeFight(state, target, { samples: 3, maxSessions: 1 }, content, spy);
    expect([...seen]).toEqual(['leader']);
  });

  it('is saved with the loadout, and a save without it plays the default one, with no new version', () => {
    const state = createState(1, content);
    state.loadouts.targetPriority = PRIORITY.leader;
    const copy = deserialize(serialize(state, 0), content);
    expect(copy.loadouts.targetPriority).toBe(PRIORITY.leader);
    const raw = JSON.parse(serialize(createState(1, content))) as {
      v: number;
      state: { loadouts: Record<string, unknown> };
    };
    delete raw.state.loadouts.targetPriority;
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(loaded.loadouts.targetPriority).toBeNull();
  });

  it('marks the enemy the side aims at, for the screen', () => {
    const { fight, leader } = wolfFight(content);
    expect(aimedEnemy(fight, content, rules)).toBe(leader);
    const adds = wolfFight(content, 'adds');
    expect(adds.pack).toContain(aimedEnemy(adds.fight, content, rules));
  });
});
