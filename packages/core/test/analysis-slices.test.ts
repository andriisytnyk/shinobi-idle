/**
 * A forecast cut into fine steps: the result is exactly the one the whole run gives, and no step
 * plays more than a set amount of game time, so the page that runs it in slices is never held long.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  SESSION_STEP_MS,
  defaultRules,
  startAnalysis,
  stepAnalysis,
  type AnalysisJob,
} from '../src/index.ts';
import { analyze, boss, build, hideout, zone, type Case } from './analysis-helpers.ts';

const FIGHT_CAP_MS = content.balance.K.combat.fightCapMs;

const cases: [string, Case, object][] = [
  ['a boss', boss(46), { samples: 60, minSessions: 3, maxSessions: 3, sessionMinutes: 10 }],
  ['a zone', zone(false), { samples: 100, minSessions: 3, maxSessions: 3, sessionMinutes: 5 }],
  ['an operation', hideout, { samples: 6, minSessions: 2, maxSessions: 2, sessionMinutes: 4 }],
];

function start(c: Case, opts: object): AnalysisJob {
  const job = startAnalysis(build(c, 80), c.target, opts, content, defaultRules);
  if (!job) throw new Error('no job');
  return job;
}

describe('a forecast cut into fine steps', () => {
  it.each(cases)('gives exactly the forecast of the whole run, with %s', (_name, c, opts) => {
    const direct = analyze(build(c, 80), c.target, opts);
    const job = start(c, opts);
    let steps = 0;
    let last = '';
    for (;;) {
      const { progress, result } = stepAnalysis(job, 1, content, defaultRules);
      steps++;
      last = JSON.stringify(result);
      if (progress.finished) break;
    }
    expect(last).toBe(JSON.stringify(direct));
    // A session takes several steps, it is not one.
    expect(steps).toBeGreaterThan((job.sessions.length + job.after.length) * 2);
  });

  it.each(cases)('plays at most one step of game time per unit, with %s', (_name, c, opts) => {
    const job = start(c, opts);
    for (;;) {
      const before = job.simulatedMs;
      const inFresh = job.fresh.done < job.fresh.batches;
      const { progress } = stepAnalysis(job, 1, content, defaultRules);
      const played = job.simulatedMs - before;
      // A step of the first-fight run is one fight (or one run of an operation); a session step is a slice of its game time.
      if (inFresh) expect(played).toBeLessThanOrEqual(FIGHT_CAP_MS * 10);
      else expect(played).toBeLessThanOrEqual(SESSION_STEP_MS);
      if (progress.finished) break;
    }
    expect(job.simulatedMs).toBeGreaterThan(0);
  });
});
