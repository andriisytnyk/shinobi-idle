import { z } from 'zod';

/** Schemas for the source files in docs/. They describe only the fields the importer reads. */

const str = z.string();
const num = z.number();

export const rawTechnique = z.object({
  skill: str,
  level: num,
  uk: str,
  en: str,
  rank: str,
  rankCanon: z.boolean(),
  role: str,
  tags: z.array(str),
  state: str,
  src: str,
  home: str,
  home2: str,
  req: str,
  note: str,
  id: str,
  sealSeq: z.array(str),
  sealsCanon: z.boolean(),
  tier: num,
  noDamage: z.boolean(),
});

const rawSimple = z.object({ level: num, uk: str, req: str, note: str });

const rawStage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('skill'), s: str, min: num, label: str }),
  z.object({ t: z.literal('tech'), any: z.array(z.tuple([str, num])), label: str }),
  z.object({ t: z.literal('named'), tech: str, alts: z.array(str) }),
  z.object({ t: z.literal('combat'), enemy: str }),
  z.object({ t: z.literal('items'), item: str, n: num }),
]);

export const rawSlice = z.object({
  seals: z.record(str, z.object({ uk: str, jp: str, glyph: str, kind: str })),
  techniques: z.array(rawTechnique),
  exercises: z.array(rawSimple),
  practices: z.array(
    z.object({
      level: num,
      uk: str,
      pair: str,
      insight: z.array(str),
      enlight: z.array(str),
    }),
  ),
  obstacles: z.array(rawSimple),
  herbs: z.array(rawSimple.extend({ id: str })),
  recipes: z.array(
    z.object({
      skill: str,
      level: num,
      uk: str,
      act: str,
      ing: z.array(z.tuple([str, num])),
      out: num,
      tags: z.array(str),
    }),
  ),
  coat: z.array(z.object({ poison: str, base: str, n: num, out: str, tags: z.array(str) })),
  pools: z.record(str, z.array(z.object({ pct: num, text: str }))),
  tools: z.record(str, z.tuple([str, str, str, z.array(str)])),
  misc: z.record(str, z.tuple([str, str, str])),
  market: z.array(z.tuple([str, str, num])),
  missions: z.array(
    z.object({
      id: str,
      rk: str,
      name: str,
      client: str.optional(),
      team: z.boolean(),
      min: num,
      stages: z.array(rawStage),
      pay: z.array(str).optional(),
      res: str.optional(),
    }),
  ),
  regions: z.array(
    z.object({
      id: str,
      name: str,
      scout: num,
      cells: z.array(z.tuple([str, str.nullable(), str.nullable()])),
    }),
  ),
  enemies: z.array(z.tuple([str, str, str, num, z.array(str), str.nullable(), str.nullable()])),
  bosses: z.array(z.tuple([str, str, str, num, z.array(str), str.nullable(), str.nullable(), str])),
  buildings: z.array(z.tuple([str, str, str, z.boolean(), z.record(str, num).nullable()])),
  gear: z.array(z.tuple([str, str, z.array(z.tuple([str, num, str.nullable()])), str])),
});

export const rawBalance = z.object({
  params: z.record(str, z.unknown()),
  pace: z.record(str, z.array(num)),
  capHours: num,
  milestones: z.record(str, num),
  missions: z.array(z.object({ id: str, min: num, ryo: num, rep: num })),
  enemies: z.array(z.object({ id: str, cl: num, hp: num, dmg: num })),
});

export const rawMap = z.object({
  N: z.array(
    z.object({
      id: str,
      g: str,
      name: str,
      mt: str.optional(),
      unlock: str.optional(),
      lore: str.optional(),
    }),
  ),
  ITEMS: z.record(str, z.tuple([str, str, str])),
});

export type RawSlice = z.infer<typeof rawSlice>;
export type RawBalance = z.infer<typeof rawBalance>;
export type RawMap = z.infer<typeof rawMap>;
