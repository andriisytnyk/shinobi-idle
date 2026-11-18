import { runCli, type CliResult } from './commands.ts';
import { runStrategiesCli } from './strategies/cliStrategies.ts';

const argv = process.argv.slice(2);
// `strategies` plays on worker threads, so it is the one command that answers later.
const { code, out, err }: CliResult =
  argv[0] === 'strategies' ? await runStrategiesCli(argv.slice(1)) : runCli(argv);
for (const line of out) console.log(line);
for (const line of err) console.error(line);
process.exitCode = code;
