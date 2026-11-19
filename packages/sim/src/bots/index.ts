import type { Bot } from '../bot.ts';
import { academyBot } from './academy.ts';
import { clonesBot } from './clones.ts';
import { fighterBot } from './fighter.ts';

/** Every bot the CLI can list, by name. The fighter has its own command with an hourly report: `pnpm sim fighter`. */
export const bots: Readonly<Record<string, Bot>> = {
  [academyBot.name]: academyBot,
  [fighterBot.name]: fighterBot,
  [clonesBot.name]: clonesBot,
};
