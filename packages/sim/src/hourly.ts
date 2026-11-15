import { content as defaultContent, type ContentDb } from '@shinobi/content';
import {
  actionsKey,
  advance,
  buyPrice,
  defaultRules,
  dispatch,
  levelAt,
  sellPrice,
  type GameState,
  type Rules,
} from '@shinobi/core';
import type { Bot } from './bot.ts';

export const HOUR_MS = 3_600_000;

/** What happened in one game hour of a bot's play. */
export interface HourRow {
  hour: number;
  /** Skill levels at the end of the hour. */
  levels: Record<string, number>;
  /** Skill XP gained during the hour (whole numbers), skills with none left out. */
  xp: Record<string, number>;
  /** Ryo the shop paid for what the bot sold, and what it paid for what it bought. */
  ryoSold: number;
  ryoSpent: number;
  /** Ryo in the bank at the end of the hour. */
  ryo: number;
  /** Craft cycles finished, and gather cycles finished. */
  crafted: number;
  gathered: number;
  /** Enemies defeated, and times the player was defeated. */
  kills: number;
  defeats: number;
  /** Game time during which no action ran because the bot found nothing to start, ms. */
  idleMs: number;
}

export interface HourlyOptions {
  seed: number;
  hours: number;
  initialState: GameState;
  content?: ContentDb;
  rules?: Rules;
  /** Game time between looks at the state, ms (default 500). */
  stepMs?: number;
  rejectLimit?: number;
}

export interface HourlyResult {
  bot: string;
  seed: number;
  rows: HourRow[];
  rejected: number;
  firstRejection: string | null;
  state: GameState;
}

const sum = (counters: Record<string, number>, prefix: string): number =>
  Object.entries(counters)
    .filter(([key]) => key.startsWith(prefix))
    .reduce((total, [, n]) => total + n, 0);

/**
 * Plays `hours` game hours with `bot` through `dispatch` and `advance` only, and reports each
 * hour. The bot is asked whenever a slot is idle, a skill level changed, or its review time has
 * passed. A step in which the bot left slot 0 empty counts as idle time.
 */
export function runHourly(bot: Bot, o: HourlyOptions): HourlyResult {
  const content = o.content ?? defaultContent;
  const rules = o.rules ?? defaultRules;
  const stepMs = o.stepMs ?? 500;
  const rejectLimit = o.rejectLimit ?? 100;
  const state = structuredClone(o.initialState);
  state.events.splice(0);
  const start = state.now;
  const rows: HourRow[] = [];
  let rejected = 0;
  let firstRejection: string | null = null;
  let changed = true;
  let lastDecision = -Infinity;

  const xpNow = () => Object.fromEntries(Object.entries(state.skills).map(([id, s]) => [id, s.xp]));
  const counts = () => ({
    crafted: state.counters[actionsKey('craft')] ?? 0,
    gathered: state.counters[actionsKey('gather')] ?? 0,
    kills: sum(state.counters, 'kills.'),
    defeats: sum(state.counters, 'defeats.'),
  });
  let xpBefore = xpNow();
  let countsBefore = counts();
  let sold = 0;
  let spent = 0;
  let idle = 0;

  for (let hour = 1; hour <= o.hours; hour++) {
    const end = start + hour * HOUR_MS;
    while (state.now < end && rejected <= rejectLimit) {
      const due = bot.reviewMs !== undefined && state.now - lastDecision >= bot.reviewMs;
      if (changed || due || state.slots.some((slot) => !slot.action)) {
        changed = false;
        lastDecision = state.now;
        for (const command of bot.decide({ state, content, rules }) ?? []) {
          const result = dispatch(state, command, content, rules);
          if (!result.ok) {
            rejected++;
            firstRejection ??= result.reason;
          } else if (command.type === 'shop.sell') {
            sold += (sellPrice(command.item, content) ?? 0) * command.n;
          } else if (command.type === 'shop.buy') {
            spent += (buyPrice(command.item, content) ?? 0) * command.n;
          }
        }
      }
      const step = Math.min(stepMs, end - state.now);
      if (!state.slots[0]?.action) idle += step;
      advance(state, step, content, rules);
      for (const event of state.events.splice(0)) {
        if (event.type === 'levelUp' || event.type === 'rankUp') changed = true;
      }
    }
    const xp = xpNow();
    const now = counts();
    rows.push({
      hour,
      levels: Object.fromEntries(
        Object.entries(state.skills).map(([id, s]) => [id, levelAt(s.xp, content.balance.K.cap)]),
      ),
      xp: Object.fromEntries(
        Object.entries(xp)
          .map(([id, value]) => [id, Math.round(value - (xpBefore[id] ?? 0))] as const)
          .filter(([, gained]) => gained > 0),
      ),
      ryoSold: sold,
      ryoSpent: spent,
      ryo: state.currencies.ryo,
      crafted: now.crafted - countsBefore.crafted,
      gathered: now.gathered - countsBefore.gathered,
      kills: now.kills - countsBefore.kills,
      defeats: now.defeats - countsBefore.defeats,
      idleMs: idle,
    });
    xpBefore = xp;
    countsBefore = now;
    sold = 0;
    spent = 0;
    idle = 0;
    if (rejected > rejectLimit) break;
  }
  return { bot: bot.name, seed: o.seed, rows, rejected, firstRejection, state };
}
