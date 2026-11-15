import type { Bot } from '../bot.ts';
import { academyBot } from './academy.ts';

/** Every bot the CLI can run, by name. Later stages add theirs here. */
export const bots: Readonly<Record<string, Bot>> = { [academyBot.name]: academyBot };
