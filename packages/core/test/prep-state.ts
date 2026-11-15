import { content, type NatureId, type SkillId } from '@shinobi/content';
import {
  advance,
  createState,
  dispatch,
  refreshUnlocks,
  setFlag,
  teamFor,
  updateQuests,
  type Command,
  type GameState,
} from '../src/index.ts';
import { setLevel } from './helpers.ts';

/** A genin whose combat skills stand at `level`, with the techniques those levels open. */
export function fighter(seed = 1, level = 36, nature: NatureId = 'katon'): GameState {
  const state = createState(seed, content);
  state.player.rank = 'genin';
  state.player.natures = [nature];
  const skills: SkillId[] = ['tai', 'nin', nature, 'vit', 'eva', 'med', 'ath', 'cc'];
  for (const skill of skills) setLevel(state, skill, level);
  // The state a played game would be in: the team follows the native nature, the quests have noticed the levels.
  state.team = teamFor(nature);
  // The graduation gave the medic pouch.
  state.bank['core:medpouch'] = 1;
  refreshUnlocks(state, content, true);
  updateQuests(state, content);
  state.events = [];
  return state;
}

/** Puts items in the bank. */
export function stock(state: GameState, items: Record<string, number>): void {
  for (const [id, n] of Object.entries(items)) state.bank[id] = (state.bank[id] ?? 0) + n;
}

/** Runs a command and fails the test when it is refused. */
export function run(state: GameState, command: Command) {
  const result = dispatch(state, command, content);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
  return result;
}

export const startFight = (state: GameState, id: string, slot = 0) =>
  dispatch(state, { type: 'action.start', slot, kind: 'fight', id }, content);

export const startOperation = (state: GameState, id: string, slot = 0) =>
  dispatch(state, { type: 'action.start', slot, kind: 'operation', id }, content);

/** Opens a boss zone or an operation by its content flag. */
export function unlock(state: GameState, flag: string): void {
  setFlag(state, flag);
}

/** Advances in `chunk`-ms steps up to `total` ms. */
export function stepThrough(state: GameState, total: number, chunk: number): void {
  for (let t = 0; t < total; t += chunk) advance(state, Math.min(chunk, total - t), content);
}

export const ids = {
  heal: 'core:bulion_ramenu',
  bigHeal: 'core:iakitori_shynobi',
  kunai: 'core:kunai',
  shuriken: 'core:shuriken',
  senbon: 'core:senbon',
  tag: 'core:tag',
  wiretrap: 'core:wiretrap',
  parSenbon: 'core:parsenbon',
  poisonSenbon: 'core:psenbon',
  smoke: 'core:dymova_bomba',
  tear: 'core:slozohinna_bomba',
  salt: 'core:niukhalna_sil',
  antidote: 'core:antidote',
  sleep: 'core:sonnyi_poroshok',
  medpouch: 'core:medpouch',
  ointment: 'core:krovospynna_maz',
  bloodPill: 'core:krovotvorna_piliulia',
  chakraPill: 'core:piliulia_vidnovlennia_chakry',
  burnOintment: 'core:maz_vid_opikiv',
};
