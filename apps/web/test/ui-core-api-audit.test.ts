import * as core from '@shinobi/core';
import { createState, defaultRules, syncVillage } from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import { CORE_API } from '../src/lib/ext/core-allowlist.ts';
import { deepFreeze } from '../src/lib/freeze.ts';
import { composeBoot } from '../src/lib/boot.ts';

/*
 * Audit of `api.core` (issue #53): a pack receives a deep-frozen state and deep-frozen content, so a
 * function on the allowlist that writes into either would throw «read only» the first time a pack
 * calls it. Each function is called with a frozen state and frozen content and plausible arguments
 * (picked by parameter name); a write shows up as a TypeError about a read-only or non-extensible
 * object. Functions whose arguments could not be guessed are listed, not trusted: they are covered
 * by the reading of the code recorded in the pull request.
 */

const { content } = composeBoot();
const state = createState(1, content);
state.player.name = 'Audit';
state.player.rank = content.playerRanks[1]?.id as never;
syncVillage(state, content);
const frozenState = deepFreeze(structuredClone(state));
const frozenContent = deepFreeze(structuredClone(content));

const first = <T extends { id: string }>(list: readonly T[], at = 0): string => list[at]?.id ?? '';
const POOL: Record<string, unknown[]> = {
  state: [frozenState],
  s: [frozenState],
  gs: [frozenState],
  content: [frozenContent],
  rules: [defaultRules],
  skill: ['tai', 'herb', 'alch', 'scout'],
  technique: [first(content.techniques)],
  tech: [first(content.techniques)],
  item: [first(content.items)],
  recipe: [first(content.recipes)],
  herb: [first(content.herbs)],
  building: [first(content.buildings), first(content.buildings, 3)],
  cell: [first(content.cells), content.cells[0]],
  cellId: [first(content.cells)],
  region: [first(content.regions)],
  zone: [first(content.zones)],
  mission: [first(content.missions), content.missions[0]],
  action: [{ kind: 'practice', id: first(content.techniques) }],
  level: [5],
  lvl: [5],
  n: [5],
  ms: [1000],
  xp: [1000],
  key: ['xp.all'],
  keys: [['xp.all']],
  req: [{ t: 'skill', skill: 'tai', level: 2 }],
  cap: [content.balance.K.cap],
  id: [first(content.items), first(content.techniques), first(content.buildings)],
  mastery: [3],
  tier: [1],
  size: [5],
  pct: [10],
};

const paramNames = (fn: (...a: never[]) => unknown): string[] => {
  const text = Function.prototype.toString.call(fn);
  const m = /^[^(]*\(([^)]*)\)/.exec(text);
  return (m?.[1] ?? '')
    .split(',')
    .map((p) =>
      p
        .replace(/=.*$/, '')
        .replace(/[:?].*$/, '')
        .trim(),
    )
    .filter(Boolean);
};

const WRITE =
  /read only|not extensible|Cannot (assign|add|delete|define)|object is not extensible/i;

type Outcome = 'ok' | 'write' | 'unreached';

function audit(fn: (...a: never[]) => unknown): { outcome: Outcome; message?: string } {
  const names = paramNames(fn);
  // One combination per position of the candidate lists: enough to reach the body of most functions.
  const lists = names.map((n) => POOL[n] ?? [undefined]);
  const longest = Math.max(1, ...lists.map((l) => l.length));
  let reached = false;
  for (let i = 0; i < longest; i++) {
    const args = lists.map((l) => l[i % l.length]);
    try {
      fn(...(args as never[]));
      reached = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof TypeError && WRITE.test(message)) return { outcome: 'write', message };
    }
  }
  return { outcome: reached ? 'ok' : 'unreached' };
}

describe('api.core allowlist: nothing writes into a frozen state or content (#53)', () => {
  const names = Object.values(CORE_API).flat();
  const functions = names.filter((n) => typeof (core as Record<string, unknown>)[n] === 'function');

  it('lists the functions it audits', () => {
    expect(functions.length).toBeGreaterThan(90);
  });

  /** Functions whose arguments cannot be guessed from their names get explicit calls. */
  const EXPLICIT: Record<string, () => unknown> = {
    natureSetSummary: () => core.natureSetSummary(['katon'] as never, frozenContent),
    nextTierPrice: () =>
      core.nextTierPrice(frozenState, frozenContent.gear[0] as never, frozenContent),
    nextTierReq: () => core.nextTierReq(frozenState, frozenContent.gear[0] as never),
    analyzeFight: () =>
      core.analyzeFight(
        frozenState,
        { kind: 'zone', id: first(content.zones) } as never,
        { samples: 3 } as never,
        frozenContent,
        defaultRules,
      ),
    startAnalysis: () => {
      const job = core.startAnalysis(
        frozenState,
        { kind: 'zone', id: first(content.zones) } as never,
        { samples: 3 } as never,
        frozenContent,
        defaultRules,
      );
      if (job) core.stepAnalysis(job, 1, frozenContent, defaultRules);
      if (job) core.analysisProgress(job, frozenContent);
      return job;
    },
  };
  function auditExplicit(name: string): { outcome: Outcome; message?: string } | null {
    const call = EXPLICIT[name];
    if (!call) return null;
    try {
      call();
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return error instanceof TypeError && WRITE.test(message)
        ? { outcome: 'write', message }
        : { outcome: 'unreached', message };
    }
  }

  const results = Object.fromEntries(
    functions.map((name) => [
      name,
      auditExplicit(name) ??
        audit((core as unknown as Record<string, (...a: never[]) => unknown>)[name] as never),
    ]),
  );

  it('finds no function that writes into the state or the content it was given', () => {
    const writers = Object.entries(results)
      .filter(([, r]) => r.outcome === 'write')
      .map(([name, r]) => `${name}: ${r.message}`);
    expect(writers).toEqual([]);
  });

  it('reaches the body of most functions with the arguments it guessed', () => {
    const reached = Object.values(results).filter((r) => r.outcome === 'ok').length;
    // The rest need arguments that cannot be guessed from names; the report names them.
    expect(reached / functions.length).toBeGreaterThan(0.5);
    const unreached = Object.entries(results)
      .filter(([, r]) => r.outcome === 'unreached')
      .map(([name]) => name);
    console.info(
      `api.core audit: ${reached} of ${functions.length} reached; not reached: ${unreached.join(', ')}`,
    );
  });
});
