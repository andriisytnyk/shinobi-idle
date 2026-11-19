import { content as defaultContent, type ContentDb } from '@shinobi/content';
import { moneyOf } from '@shinobi/core';
import {
  actionsKey,
  buyPrice,
  defaultRules,
  levelAt,
  sellPrice,
  type GameState,
  type Rules,
} from '@shinobi/core';
import type { Bot } from './bot.ts';
import { KIND_CRAFT, KIND_GATHER } from './constants.ts';
import { runBot } from './runner.ts';

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
  /** Enemies defeated, in all and by enemy id, and times the player was defeated. */
  kills: number;
  killsBy: Record<string, number>;
  defeats: number;
  /** The action in slot 0 at the end of the hour (kind and id), and the Wound stacks then. */
  action: { kind: string; id: string } | null;
  wounds: number;
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

const withPrefix = (counters: Record<string, number>, prefix: string): Record<string, number> =>
  Object.fromEntries(
    Object.entries(counters)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, n]) => [key.slice(prefix.length), n]),
  );
const total = (counters: Record<string, number>): number =>
  Object.values(counters).reduce((a, b) => a + b, 0);

/**
 * Plays `hours` game hours with `bot`, one `runBot` call per hour, and reports each hour. A step
 * in which the bot left slot 0 empty after it had been asked counts as idle time.
 */
export function runHourly(bot: Bot, o: HourlyOptions): HourlyResult {
  const content = o.content ?? defaultContent;
  const rules = o.rules ?? defaultRules;
  let state = structuredClone(o.initialState);
  state.events.splice(0);
  const start = state.now;
  const rows: HourRow[] = [];
  let rejected = 0;
  let firstRejection: string | null = null;

  for (let hour = 1; hour <= o.hours; hour++) {
    const before = state;
    let sold = 0;
    let spent = 0;
    let idle = 0;
    const run = runBot(bot, {
      seed: o.seed,
      initialState: state,
      content,
      rules,
      limitMs: start + hour * HOUR_MS,
      ...(o.stepMs === undefined ? {} : { stepMs: o.stepMs }),
      ...(o.rejectLimit === undefined ? {} : { rejectLimit: o.rejectLimit }),
      observer: {
        command(command, result) {
          if (!result.ok) return;
          if (command.type === 'shop.sell')
            sold += (sellPrice(command.item, content) ?? 0) * command.n;
          else if (command.type === 'shop.buy')
            spent += (buyPrice(command.item, content) ?? 0) * command.n;
        },
        step(now, ms) {
          if (!now.slots[0]?.action) idle += ms;
        },
      },
    });
    state = run.state;
    rejected += run.rejected;
    firstRejection ??= run.firstRejection;
    const cap = content.balance.K.cap;
    const count = (key: string) => (s: GameState) => s.counters[key] ?? 0;
    const diff = (key: string) => count(key)(state) - count(key)(before);
    const killsNow = withPrefix(state.counters, 'kills.');
    const killsThen = withPrefix(before.counters, 'kills.');
    rows.push({
      hour,
      levels: Object.fromEntries(
        Object.entries(state.skills).map(([id, s]) => [id, levelAt(s.xp, cap)]),
      ),
      xp: Object.fromEntries(
        Object.entries(state.skills)
          .map(
            ([id, s]) =>
              [
                id,
                Math.round(s.xp - (before.skills[id as keyof typeof before.skills]?.xp ?? 0)),
              ] as const,
          )
          .filter(([, gained]) => gained > 0),
      ),
      ryoSold: sold,
      ryoSpent: spent,
      ryo: state.currencies[moneyOf(content)] ?? 0,
      crafted: diff(actionsKey(KIND_CRAFT)),
      gathered: diff(actionsKey(KIND_GATHER)),
      kills: total(killsNow) - total(killsThen),
      killsBy: Object.fromEntries(
        Object.entries(killsNow)
          .map(([id, n]) => [id, n - (killsThen[id] ?? 0)] as const)
          .filter(([, n]) => n > 0),
      ),
      defeats:
        total(withPrefix(state.counters, 'defeats.')) -
        total(withPrefix(before.counters, 'defeats.')),
      action: state.slots[0]?.action ? { ...state.slots[0].action } : null,
      wounds: state.wounds.stacks,
      idleMs: idle,
    });
    if (run.ended === 'failed') break;
  }
  return { bot: bot.name, seed: o.seed, rows, rejected, firstRejection, state };
}
