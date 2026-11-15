import type {
  ContentDb,
  NumRef,
  SkillId,
  Status,
  TagEntity,
  TraitEntity,
  StatusEffectData,
} from '@shinobi/content';
import type { ModStat } from './fight-types.ts';

/*
 * The fight vocabulary of a content database, read once into lookups: statuses and the effects they
 * put on a body, tags and what they do, traits, combos, natures and the wheel between them. The
 * engine never names one of these; it asks this index, so a pack that adds a status, a combo, a
 * trait, a nature or a tag changes the fight without a line of engine code.
 */

type Balance = Record<string, unknown>;

/** A number of the balance object, read when it is needed (the balance may be patched by a pack). */
export type Num = (K: Balance) => number;

/** Reads the balance path `path` (`wet.slow`), or throws: the closure validator proves it exists. */
function read(K: Balance, parts: readonly string[]): number {
  let v: unknown = K;
  for (const part of parts) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part)) {
      throw new Error(`balance K.${parts.join('.')} is missing`);
    }
    v = (v as Balance)[part];
  }
  if (typeof v !== 'number') throw new Error(`balance K.${parts.join('.')} is not a number`);
  return v;
}

export function compileNum(ref: NumRef): Num {
  if (typeof ref === 'number') return () => ref;
  if (typeof ref === 'string') {
    const parts = ref.split('.');
    return (K) => read(K, parts);
  }
  const parts = ref.path.split('.');
  return (K) => 1 - read(K, parts);
}

/** One effect of a status, with its numbers ready to read. */
export type EffectDef =
  | { kind: 'modifier'; stat: ModStat; op: 'mul' | 'add'; value: Num }
  | { kind: 'periodic'; from: 'hit' | 'maxHp'; amount: Num; over: Num | null };

/** What a status or an effect a tag defines is made of. */
export interface StatusDef {
  /** The id of the first effect it puts on a body; later ones are `<id>#<n>`. */
  id: string;
  effects: EffectDef[];
  /** Seconds, or null when the status has no duration of its own. */
  duration: Num | null;
  /** The row of the balance object that gives the seconds by technique rank. */
  durationByRank: string | null;
  suppresses: string | null;
  stacks: number;
  refresh: 'replace' | 'longest' | 'strongest';
  interrupts: boolean;
  /** The name the report counts it under; null: not counted. */
  tally: { as: string; whenSuppressing: boolean } | null;
}

export type TagOp = { op: 'status'; def: StatusDef; value: Num | null } | { op: 'cancelCast' };

export interface TagDef {
  id: string;
  hitsAll: boolean;
  /** Whether a technique or tool with the tag stops interruptible casts. */
  interrupts: boolean;
  onHit: TagOp[];
  onUse: TagOp[];
  removes: string[];
  pouch: string | null;
  guard: boolean;
}

export interface TraitMod {
  stat: ModStat;
  op: 'mul' | 'add';
  value: Num;
}

export interface TraitDef {
  id: string;
  answer: string;
  mods: TraitMod[];
  regen: Num | null;
  hook: string | null;
  inflicts: string[];
  casts: boolean;
  /** The balance row that makes a body of the trait a swarm. */
  swarm: string | null;
  priority: number | null;
}

export type ComboEffect = 'boost' | 'lengthen' | 'status' | 'burst';

export interface ComboDef {
  id: string;
  /** The skill of the technique that triggers it, or null when a tag does. */
  nature: string | null;
  tag: string | null;
  /** The effect ids that count as the state: the statuses whose `state` is `onState`. */
  onState: string;
  kind: ComboEffect;
  /** The status a `status` combo applies. */
  status: StatusDef | null;
}

export interface FightData {
  statuses: Map<string, StatusDef>;
  byState: Map<string, StatusDef>;
  tags: Map<string, TagDef>;
  /** Roles whose techniques hit every body. */
  wideRoles: Set<string>;
  traits: Map<string, TraitDef>;
  combos: ComboDef[];
  /** The natures each nature is strong against. */
  strong: Map<string, ReadonlySet<string>>;
  /** Natures in list order. */
  natures: string[];
  ranks: string[];
  /** Skills whose techniques are cast (activity `tech`). */
  techSkills: SkillId[];
  /** The skill of basic attacks, and the skills whose techniques spend stamina and use the physical damage stat. */
  basicSkill: SkillId | null;
  physical: Set<string>;
  /** Traits the player AI answers with its own priority rule, in order, split by what they do. */
  answerOrder: { status: TraitDef[]; trait: TraitDef[] };
  /** Every name the report counts a status under: the ids of the statuses and the names their data gives. */
  tallyNames: Set<string>;
  /** What the player AI knows of the traits. */
  ai: { inflicted: { trait: string; effects: string[] }[]; answered: string[]; casters: string[] };
}

type Body = Omit<Status, 'id' | 'state'>;

function defOf(id: string, body: Body, ranks: readonly string[]): StatusDef {
  void ranks;
  const d = body.duration;
  const byRank = d !== undefined && typeof d === 'object' && 'byRank' in d ? d.byRank : null;
  return {
    id,
    effects: (body.effects ?? []).map((e: StatusEffectData): EffectDef =>
      e.kind === 'modifier'
        ? { kind: 'modifier', stat: e.stat, op: e.op, value: compileNum(e.value) }
        : {
            kind: 'periodic',
            from: e.from,
            amount: compileNum(e.amount),
            over: e.over === undefined ? null : compileNum(e.over),
          },
    ),
    duration: d === undefined || byRank !== null ? null : compileNum(d as NumRef),
    durationByRank: byRank,
    suppresses: body.suppresses ?? null,
    stacks: body.stacks ?? 1,
    refresh: body.refresh ?? 'replace',
    interrupts: body.interrupts === true,
    tally:
      body.tally === false
        ? null
        : body.tally
          ? { as: body.tally.as, whenSuppressing: body.tally.whenSuppressing === true }
          : { as: id, whenSuppressing: false },
  };
}

function build(content: ContentDb): FightData {
  const ranks = content.techRanks.map((r) => r.id);
  const statuses = new Map<string, StatusDef>();
  const byState = new Map<string, StatusDef>();
  for (const s of content.statuses) {
    const def = defOf(s.id, s, ranks);
    statuses.set(s.id, def);
    if (s.state !== undefined && !byState.has(s.state)) byState.set(s.state, def);
  }
  const ops = (list: TagEntity['onHit']): TagOp[] => {
    const out: TagOp[] = [];
    for (const o of list ?? []) {
      if (o.op === 'cancelCast') out.push({ op: 'cancelCast' });
      else if (o.op === 'status') {
        const def = statuses.get(o.status);
        if (def)
          out.push({
            op: 'status',
            def,
            value: o.value === undefined ? null : compileNum(o.value),
          });
      } else {
        const { op: _op, id, ...body } = o;
        void _op;
        out.push({ op: 'status', def: defOf(id, body, ranks), value: null });
      }
    }
    return out;
  };
  const tags = new Map<string, TagDef>();
  for (const t of content.tags) {
    tags.set(t.id, {
      id: t.id,
      hitsAll: t.hitsAll === true,
      interrupts: (t.onHit ?? []).some((o) => o.op === 'cancelCast'),
      onHit: ops(t.onHit),
      onUse: ops(t.onUse),
      removes: [...(t.removes ?? [])],
      pouch: t.pouch ?? null,
      guard: t.guard === true,
    });
  }
  const traits = new Map<string, TraitDef>();
  for (const t of content.traits as readonly TraitEntity[]) {
    traits.set(t.id, {
      id: t.id,
      answer: t.answer,
      mods: (t.mods ?? []).map((m) => ({ stat: m.stat, op: m.op, value: compileNum(m.value) })),
      regen: t.regen === undefined ? null : compileNum(t.regen),
      hook: t.hook ?? null,
      inflicts: [...(t.inflicts ?? [])],
      casts: t.casts === true,
      swarm: t.swarm ?? null,
      priority: t.priority ?? null,
    });
  }
  const combos: ComboDef[] = content.combos.map((c) => ({
    id: c.id,
    nature: c.nature ?? null,
    tag: c.tag ?? null,
    onState: c.onState,
    kind: c.effect.kind,
    status: c.effect.status === undefined ? null : (statuses.get(c.effect.status) ?? null),
  }));
  const strong = new Map<string, ReadonlySet<string>>();
  for (const n of content.natures) strong.set(n.id, new Set(n.strongAgainst));
  const byPriority = (a: TraitDef, b: TraitDef) => (a.priority ?? 0) - (b.priority ?? 0);
  const all = [...traits.values()];
  const answerOrder = {
    status: all.filter((t) => t.inflicts.length > 0 && t.priority !== null).sort(byPriority),
    trait: all.filter((t) => t.inflicts.length === 0 && t.priority !== null).sort(byPriority),
  };
  const tallyNames = new Set<string>();
  for (const def of [
    ...statuses.values(),
    ...[...tags.values()].flatMap((t) =>
      [...t.onHit, ...t.onUse].flatMap((o) => (o.op === 'status' ? [o.def] : [])),
    ),
  ]) {
    if (def.tally) tallyNames.add(def.tally.as);
  }
  const ai = {
    inflicted: answerOrder.status.map((t) => ({ trait: t.id, effects: [...t.inflicts] })),
    answered: answerOrder.trait.map((t) => t.id),
    casters: all.filter((t) => t.casts).map((t) => t.id),
  };
  return {
    statuses,
    byState,
    tags,
    wideRoles: new Set(content.roles.filter((r) => r.hitsAll === true).map((r) => r.id)),
    traits,
    combos,
    strong,
    natures: content.natures.map((n) => n.id),
    ranks,
    techSkills: content.skills.filter((k) => k.activity === 'tech').map((k) => k.id),
    basicSkill: content.skills.find((k) => k.fight?.basic === true)?.id ?? null,
    physical: new Set(content.skills.filter((k) => k.fight?.physical === true).map((k) => k.id)),
    answerOrder,
    tallyNames,
    ai,
  };
}

const cache = new WeakMap<ContentDb, FightData>();

/** The fight vocabulary of a content database, built once. */
export function fightData(content: ContentDb): FightData {
  let data = cache.get(content);
  if (!data) {
    data = build(content);
    cache.set(content, data);
  }
  return data;
}

/** Whether a technique answers a trait: it carries the tag that counters the trait, or its state switches the trait off. */
export function answersTraitData(
  data: FightData,
  tags: readonly string[],
  state: string | null,
  trait: TraitDef,
): boolean {
  if (tags.includes(trait.answer)) return true;
  return state !== null && data.byState.get(state)?.suppresses === trait.id;
}

/** The balance object as a plain record, for `Num`s. */
export const balanceOf = (content: ContentDb): Balance => content.balance.K as unknown as Balance;

/** Seconds that a row of the balance object gives for a rank: the row's own entry, else the nearest rank that has one. */
export function secondsByRank(content: ContentDb, row: string, rank: string | null): number {
  const data = fightData(content);
  const table = read2(balanceOf(content), row);
  const at = rank === null ? -1 : data.ranks.indexOf(rank);
  let best: { dist: number; seconds: number } | null = null;
  for (const [i, r] of data.ranks.entries()) {
    const seconds = Object.hasOwn(table, r) ? table[r] : undefined;
    if (typeof seconds !== 'number') continue;
    const dist = at < 0 ? i : Math.abs(i - at);
    if (!best || dist < best.dist) best = { dist, seconds };
  }
  if (!best) throw new Error(`balance K.${row} has no entry for any rank`);
  return best.seconds;
}

function read2(K: Balance, path: string): Record<string, unknown> {
  let v: unknown = K;
  for (const part of path.split('.')) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part)) {
      throw new Error(`balance K.${path} is missing`);
    }
    v = (v as Balance)[part];
  }
  return v as Record<string, unknown>;
}

/**
 * The share of the hit's damage that a status deals over its whole duration when it is a damage
 * over time of a share of the hit (burning); 0 for a status that is not.
 */
export function dotShareOf(def: StatusDef, content: ContentDb): number {
  const K = balanceOf(content);
  for (const e of def.effects) {
    if (e.kind !== 'periodic' || e.from !== 'hit') continue;
    const seconds = def.duration ? def.duration(K) : 0;
    return e.amount(K) * (e.over ? seconds / e.over(K) : seconds);
  }
  return 0;
}

/** The natures that beat `nature` in the wheel, in list order. */
export function beatenBy(content: ContentDb, nature: string): string | null {
  const data = fightData(content);
  for (const n of data.natures) if (data.strong.get(n)?.has(nature)) return n;
  return null;
}
