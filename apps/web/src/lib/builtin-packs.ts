import { simulatorUi } from './builtin/simulator-ui.ts';
import type { UiPack } from './ext/types.ts';

/*
 * The UI packs that ship with the game and are off by default: «Вбудовані розширення» in the
 * settings. They are ordinary UI packs (the same registration third-party packs use); what makes
 * them built-in is only that the game lists them for the player to switch on. The enabled set is a
 * setting of the interface (`settings.builtinPacks`) and is applied when the app starts.
 */

export interface BuiltinPack {
  /** The id of the UI pack. */
  id: string;
  /** Localization keys of the name and of a one-line description. */
  name: string;
  desc: string;
  ui: UiPack;
}

export const BUILTIN_PACKS: readonly BuiltinPack[] = [
  {
    id: simulatorUi.id,
    name: 'builtin.simulator.name',
    desc: 'builtin.simulator.desc',
    ui: simulatorUi,
  },
];

/** The UI packs of the built-in packs whose ids are enabled, in the order of the list; unknown ids are ignored. */
export function enabledBuiltin(ids: readonly string[]): UiPack[] {
  return BUILTIN_PACKS.filter((p) => ids.includes(p.id)).map((p) => p.ui);
}
