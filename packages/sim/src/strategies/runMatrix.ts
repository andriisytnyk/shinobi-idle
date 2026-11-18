import { content as builtIn, type ContentDb } from '@shinobi/content';
import { Worker } from 'node:worker_threads';
import { measureRun, naturesTriples, type RunMetrics } from './matrix.ts';
import type { MatrixJob } from './matrixWorker.ts';
import { STRATEGIES, STRATEGY_IDS, type StrategyId } from './strategies.ts';

export interface MatrixOptions {
  /** Seeds `1 .. seeds`. */
  seeds: number;
  hours: number;
  /** Which strategies and triples to play; all of them when absent. */
  strategies?: readonly StrategyId[];
  triples?: readonly (readonly string[])[];
  /** Worker threads; 1 plays everything in this thread. The result does not depend on it. */
  workers?: number;
  content?: ContentDb;
}

/** One strategy with one triple of natures and its runs over the seeds. */
export interface MatrixRow {
  strategy: StrategyId;
  triple: string[];
  runs: RunMetrics[];
}

export interface MatrixResult {
  hours: number;
  seeds: number[];
  rows: MatrixRow[];
}

export function matrixJobs(options: MatrixOptions): MatrixJob[] {
  const content = options.content ?? builtIn;
  const triples = options.triples ?? naturesTriples(content);
  const strategies = options.strategies ?? STRATEGY_IDS;
  const jobs: MatrixJob[] = [];
  for (const strategy of strategies) {
    for (const triple of triples) {
      for (let seed = 1; seed <= options.seeds; seed++) {
        jobs.push({
          index: jobs.length,
          strategy,
          triple: [...triple],
          seed,
          hours: options.hours,
        });
      }
    }
  }
  return jobs;
}

function collect(options: MatrixOptions, jobs: MatrixJob[], metrics: RunMetrics[]): MatrixResult {
  const rows: MatrixRow[] = [];
  jobs.forEach((job, i) => {
    const run = metrics[i] as RunMetrics;
    const last = rows[rows.length - 1];
    if (last && last.strategy === job.strategy && last.triple.join('+') === job.triple.join('+')) {
      last.runs.push(run);
    } else rows.push({ strategy: job.strategy, triple: job.triple, runs: [run] });
  });
  return {
    hours: options.hours,
    seeds: Array.from({ length: options.seeds }, (_, i) => i + 1),
    rows,
  };
}

/** Plays the whole matrix in this thread. */
export function runMatrixSerial(options: MatrixOptions): MatrixResult {
  const jobs = matrixJobs(options);
  const metrics = jobs.map((job) =>
    measureRun({
      strategy: STRATEGIES[job.strategy],
      triple: job.triple as never,
      seed: job.seed,
      hours: job.hours,
      ...(options.content ? { content: options.content } : {}),
    }),
  );
  return collect(options, jobs, metrics);
}

/**
 * Plays the whole matrix on worker threads (the jobs are dealt out round robin, so the slow
 * strategies spread over the workers). Every run is independent and seeded, so the result is the
 * same whatever the number of workers.
 */
export async function runMatrix(options: MatrixOptions): Promise<MatrixResult> {
  const workers = options.workers ?? 1;
  if (workers <= 1 || options.content) return runMatrixSerial(options);
  const jobs = matrixJobs(options);
  const lanes: MatrixJob[][] = Array.from({ length: Math.min(workers, jobs.length) }, () => []);
  jobs.forEach((job, i) => lanes[i % lanes.length]?.push(job));
  const metrics: RunMetrics[] = new Array(jobs.length);
  await Promise.all(
    lanes.map(
      (lane) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL('./matrixWorker.ts', import.meta.url), {
            workerData: lane,
          });
          worker.on('message', (m: { index: number; metrics: RunMetrics }) => {
            metrics[m.index] = m.metrics;
          });
          worker.on('error', reject);
          worker.on('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`)),
          );
        }),
    ),
  );
  return collect(options, jobs, metrics);
}
