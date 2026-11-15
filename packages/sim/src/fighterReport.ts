import { content as defaultContent, type ContentDb } from '@shinobi/content';
import { defaultRules, type Rules } from '@shinobi/core';
import { createFighterBot } from './bots/fighter.ts';
import { buildGeninStart } from './character.ts';
import { combatSkills, defaultNature, styleSkills } from './constants.ts';
import { runHourly } from './hourly.ts';

/** Ryo a fresh Genin starts the fighter run with, to stock the pouch before the first fights. */
export const FIGHTER_START_RYO = 500;

export interface FighterHour {
  hour: number;
  /** The action in slot 0 at the end of the hour (a zone when it is fighting), or null. */
  action: string | null;
  kills: number;
  defeats: number;
  /** Enemies defeated this hour, by enemy id. */
  killsBy: Record<string, number>;
  /** XP gained this hour in the combat and technique skills, by skill id. */
  combatXp: Record<string, number>;
  ryo: number;
  /** Ryo paid in the shop this hour (pouch goods). */
  ryoSpent: number;
  wounds: number;
}

export interface FighterReport {
  seed: number;
  hours: number;
  rows: FighterHour[];
  rejected: number;
  firstRejection: string | null;
}

export function fighterReport(o: {
  seed: number;
  hours: number;
  content?: ContentDb;
  rules?: Rules;
}): FighterReport {
  const content = o.content ?? defaultContent;
  const rules = o.rules ?? defaultRules;
  const run = runHourly(createFighterBot(), {
    seed: o.seed,
    hours: o.hours,
    initialState: buildGeninStart(content, o.seed, FIGHTER_START_RYO, [defaultNature()]),
    content,
    rules,
  });
  const combat = new Set<string>([...combatSkills(content), ...styleSkills(content)]);
  return {
    seed: o.seed,
    hours: o.hours,
    rows: run.rows.map((r) => ({
      hour: r.hour,
      action: r.action ? r.action.id : null,
      kills: r.kills,
      defeats: r.defeats,
      killsBy: r.killsBy,
      combatXp: Object.fromEntries(Object.entries(r.xp).filter(([id]) => combat.has(id))),
      ryo: r.ryo,
      ryoSpent: r.ryoSpent,
      wounds: r.wounds,
    })),
    rejected: run.rejected,
    firstRejection: run.firstRejection,
  };
}
