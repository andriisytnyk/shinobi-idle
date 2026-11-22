import type { ContentDb } from '@shinobi/content';
import {
  startAnalysis,
  stepAnalysis,
  type GameState,
  type Unknown,
  type Verdict,
} from '@shinobi/core';
import { runAnalysis, laterInBrowser } from './analysis-runner.ts';
import { disclosure, knowledgeOfTarget, type PrepTarget } from './prep.ts';
import { game } from './store.ts';

/*
 * The quick forecast of a card on the combat list: the same core analysis the preparation screen runs
 * (`startAnalysis` / `stepAnalysis`), at the player's knowledge of the enemy, run lazily for the cards
 * that are on screen, one at a time, in slices. The result is cached by the inputs the forecast depends
 * on (the same ones as the preparation screen's), so a game tick never reruns it.
 */

/** What a card shows of a finished forecast. */
export interface CardForecast {
  verdict: Verdict | null;
  /** Ryo per hour; null while the Bingo book hides it. */
  ryoPerHour: number | null;
  /** Skill XP per hour by skill. */
  xpPerHour: Record<string, number>;
  /** The target cannot be started from this state. */
  blocked: boolean;
}

const known = (v: number | Unknown): number | null => (typeof v === 'number' ? v : null);

/** What the forecast of a zone depends on; '' when the knowledge of the enemy is too low for a verdict. */
export function forecastKeyOf(gs: GameState, target: PrepTarget, content: ContentDb): string {
  const level = knowledgeOfTarget(gs, target, content);
  if (!disclosure(level).verdict) return '';
  return JSON.stringify([
    target,
    level,
    gs.player.rank,
    Object.keys(gs.known).filter((id) => gs.known[id]).length,
    gs.loadouts.active,
    gs.loadouts.auto,
    gs.loadouts.cloneRole,
    gs.pouch.slots.map((s) => [
      s.id,
      s.id === '' ? 0 : Math.min(s.amount, s.n + (gs.bank[s.id] ?? 0)),
    ]),
    gs.pouch.medic,
    gs.wounds.stacks,
  ]);
}

const MAX_CACHE = 200;

class Forecasts {
  /** Finished forecasts by key; a new object on every change, so readers follow it. */
  done = $state.raw<Record<string, CardForecast>>({});
  private queue: { key: string; target: PrepTarget }[] = [];
  private queued = new Set<string>();
  private running = false;

  /** Asks for the forecast; a key already done or waiting is not asked twice. */
  request(key: string, target: PrepTarget): void {
    if (key === '' || key in this.done || this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push({ key, target });
    this.pump();
  }

  finish(key: string, value: CardForecast): void {
    const entries = Object.entries(this.done);
    const kept =
      entries.length >= MAX_CACHE ? entries.slice(entries.length - MAX_CACHE / 2) : entries;
    this.done = { ...Object.fromEntries(kept), [key]: value };
    this.queued.delete(key);
    this.running = false;
    this.pump();
  }

  private pump(): void {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    const content = game.content;
    runAnalysis({
      start: () =>
        startAnalysis(
          game.state,
          { kind: next.target.kind, id: next.target.id },
          {},
          content,
          game.rules,
        ),
      step: (job, n) => stepAnalysis(job, n, content, game.rules),
      now: () => performance.now(),
      later: laterInBrowser,
      onUpdate(progress, result) {
        if (!progress.finished) return;
        const s = result?.session ?? null;
        forecasts.finish(next.key, {
          verdict: s?.verdict ?? null,
          ryoPerHour: s ? known(s.ryoPerHour) : null,
          xpPerHour: (s?.xpPerHour ?? {}) as Record<string, number>,
          blocked: result?.sessionBlocked != null,
        });
      },
      onFail() {
        forecasts.finish(next.key, {
          verdict: null,
          ryoPerHour: null,
          xpPerHour: {},
          blocked: false,
        });
      },
    });
  }
}

export const forecasts = new Forecasts();
