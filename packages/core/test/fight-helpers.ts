import {
  content,
  type ContentDb,
  type NatureId,
  type SkillId,
  type Technique,
  type TraitId,
} from '@shinobi/content';
import {
  createFight,
  encounterFor,
  makeCtx,
  type Encounter,
  defaultRules,
  fightAdvance,
  fightNextEventIn,
  workOf,
  type CombatAi,
  type FightState,
  type PlayerSnapshot,
  type Rules,
} from '../src/index.ts';

export const K = content.balance.K;

/** A number of the balance object by its dotted path (`trait.armor`, `bossFx.twins.count`); a miss fails the test with the path. */
export function fig(path: string): number {
  let v: unknown = K;
  for (const part of path.split('.')) {
    v = (v as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof v !== 'number') throw new Error(`balance K.${path} is not a number`);
  return v;
}

/** A row of the balance object that holds numbers (`bossFx.twins`), by its dotted path. */
export function row(path: string): Record<string, number> {
  let v: unknown = K;
  for (const part of path.split('.')) {
    v = (v as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof v !== 'object' || v === null) throw new Error(`balance K.${path} is not a row`);
  return v as Record<string, number>;
}
export const rules = defaultRules;

/** A typical player build for combat level `c`, as in the balance simulator (`build`). */
export function levelsFor(c: number, nature: NatureId): PlayerSnapshot['levels'] {
  const style = Math.min(K.cap, Math.round(c * 1.12));
  const d = Math.min(K.cap, Math.max(1, Math.round((c - style / 2) * 2)));
  const levels = {} as PlayerSnapshot['levels'];
  for (const skill of content.skills) levels[skill.id] = 1;
  levels.tai = Math.max(1, style - 4);
  levels.nin = Math.max(1, style - 6);
  levels[nature] = style;
  levels.vit = d;
  levels.med = d;
  levels.ath = Math.min(K.cap, d);
  levels.cc = Math.min(K.cap, d);
  return levels;
}

/** Every technique the levels allow from the skills the player uses. */
export function knownFor(levels: PlayerSnapshot['levels'], nature: NatureId): string[] {
  const skills: SkillId[] = ['tai', 'nin', nature];
  return content.techniques
    .filter((t) => skills.includes(t.skill) && t.rank !== null && t.level <= (levels[t.skill] ?? 0))
    .map((t) => t.id);
}

export interface BuildOptions {
  mastery?: number;
  /** Drop techniques for which this returns true. */
  without?: (tags: readonly string[], state: string | null) => boolean;
}

export function playerFor(c: number, nature: NatureId, options: BuildOptions = {}): PlayerSnapshot {
  const levels = levelsFor(c, nature);
  const known = knownFor(levels, nature).filter((id) => {
    const tech = content.techniques.find((t) => t.id === id);
    return !(tech && options.without?.(tech.tags, tech.state));
  });
  const mastery: Record<string, number> = {};
  for (const id of known) mastery[id] = options.mastery ?? 20;
  return {
    levels,
    mastery,
    known,
    natures: [nature],
    costMod: { chakra: 1, stamina: 1 },
    // The full tactics: these tests are about what the AI can do, not about the rank it plays at.
    tier: 2,
  };
}

export function enemyAt(
  cl: number,
  traits: TraitId[] = [],
  nature: 'wheel' | NatureId | null = null,
): Encounter {
  const base = content.enemies.find((e) => e.id === 'core:bandit');
  if (!base) throw new Error('no bandit');
  return encounterFor({ ...base, id: 'core:test', cl, traits, nature, carries: null }, content);
}

/** A fight run to its end or the time cap. */
export function runFight(snap: PlayerSnapshot, enemy: Encounter, seed: number): FightState {
  const fight = createFight(snap, enemy, seed, content, rules);
  fightAdvance(fight, workOf(K.combat.fightCapMs), content, rules);
  return fight;
}

export const sec = (s: number): number => workOf(Math.round(s * 1000));

// ---------- micro-fights: one scripted technique at a time ----------

/** A player with the given techniques at level 40 in every skill and mastery 20. */
export function scripted(known: string[], levels: Partial<Record<SkillId, number>> = {}) {
  const all = {} as PlayerSnapshot['levels'];
  for (const skill of content.skills) all[skill.id] = 40;
  return {
    levels: { ...all, ...levels } as PlayerSnapshot['levels'],
    mastery: Object.fromEntries(known.map((id) => [id, 20])),
    known,
    natures: ['katon'],
    costMod: { chakra: 1, stamina: 1 },
    tier: 2,
  } satisfies PlayerSnapshot;
}

/** An AI that casts the first of `ids` that is ready and otherwise attacks. */
export const castSeq =
  (...ids: string[]): CombatAi =>
  (view) => {
    const id = ids.find((x) => view.techniques.some((r) => r.ready && r.tech.id === x));
    return id ? { type: 'technique', id } : { type: 'basic' };
  };

/** An AI that casts each of `ids` at most once, in order of readiness. */
export function castOnce(...ids: string[]): CombatAi {
  const used = new Set<string>();
  return (view) => {
    const id = ids.find(
      (x) => !used.has(x) && view.techniques.some((r) => r.ready && r.tech.id === x),
    );
    if (!id) return { type: 'basic' };
    used.add(id);
    return { type: 'technique', id };
  };
}

export const withAi = (combatAi: CombatAi, base: Rules = rules): Rules => ({ ...base, combatAi });

/** Gives the player endless health and a harmless basic attack, and the enemies huge health. */
export function quiet(fight: FightState, enemyHp = 1e9): FightState {
  fight.player.hp = fight.player.maxHp = 1e9;
  fight.player.damage = 0;
  for (const e of fight.enemies) e.hp = e.maxHp = enemyHp;
  return fight;
}

/** Stops the enemies' ordinary attacks (a timer that never fills in a test). */
export function pacify(fight: FightState): FightState {
  for (const e of fight.enemies) e.timer.need = 1e15;
  return fight;
}

/** Runs event by event until `done` holds or `limit` work units have passed. */
export function runUntil(
  fight: FightState,
  done: (f: FightState) => boolean,
  r: Rules,
  c: ContentDb = content,
  limit = sec(600),
): FightState {
  while (!done(fight) && fight.result === 'ongoing' && fight.t < limit) {
    fightAdvance(fight, fightNextEventIn(fight, content, rules) ?? 1, c, r);
  }
  return fight;
}

export interface Scene {
  known: string[];
  enemy: Encounter;
  ai: () => CombatAi;
  levels?: Partial<Record<SkillId, number>>;
  /** Changes the fight before it starts. */
  setup?: (f: FightState) => void;
  content?: ContentDb;
  /** A further condition the fight must meet at the moment of the cast. */
  ok?: (f: FightState) => boolean;
}

/**
 * Plays seeds until `tech` is cast and lands (its damage tally is above zero), and returns the
 * fight at the moment of the cast, with the seed. Fails if no seed does.
 */
export function castAndHit(
  scene: Scene,
  tech: string,
  until = 1,
): { fight: FightState; seed: number } {
  const c = scene.content ?? content;
  for (let seed = 1; seed < 400; seed++) {
    const r = withAi(scene.ai());
    const fight = createFight(scripted(scene.known, scene.levels), scene.enemy, seed, c, r);
    quiet(fight);
    scene.setup?.(fight);
    runUntil(fight, (f) => (f.tally.uses[tech] ?? 0) >= until, r, c);
    if ((fight.tally.damage[tech] ?? 0) > 0 && (scene.ok?.(fight) ?? true)) return { fight, seed };
  }
  throw new Error(`no seed lands ${tech}`);
}

export const tech = (fight: FightState, id: string) => {
  const t = fight.kit.techniques.find((x) => x.id === id);
  if (!t) throw new Error(`no ${id} in the kit`);
  return t;
};

/** A content copy with extra techniques, for tags no shipped technique carries yet. */
export function withTechniques(extra: Technique[]): ContentDb {
  return { ...content, techniques: [...content.techniques, ...extra] };
}

export function syntheticTechnique(id: string, tags: Technique['tags']): Technique {
  const base = content.techniques.find((t) => t.id === 'core:sensing');
  if (!base) throw new Error('no sensing');
  return { ...base, id, tags, level: 1, skill: 'nin', state: null, noDamage: true };
}

/** A ctx for helpers that take one. */
export const ctxOf = (fight: FightState) => makeCtx(fight, content, rules);
