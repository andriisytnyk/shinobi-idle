import { parentPort, workerData } from 'node:worker_threads';
import { measureRun } from './matrix.ts';
import { STRATEGIES, type StrategyId } from './strategies.ts';

/** One job of the matrix: a strategy, an ordered triple of natures, a seed. */
export interface MatrixJob {
  index: number;
  strategy: StrategyId;
  triple: string[];
  seed: number;
  hours: number;
}

/** Runs the jobs it was given and sends each result back, tagged with the job index. */
const jobs = workerData as MatrixJob[];
for (const job of jobs) {
  const metrics = measureRun({
    strategy: STRATEGIES[job.strategy],
    triple: job.triple as never,
    seed: job.seed,
    hours: job.hours,
  });
  parentPort?.postMessage({ index: job.index, metrics });
}
