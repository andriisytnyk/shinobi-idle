import { runCli } from './commands.ts';

const { code, out, err } = runCli(process.argv.slice(2));
for (const line of out) console.log(line);
for (const line of err) console.error(line);
process.exitCode = code;
