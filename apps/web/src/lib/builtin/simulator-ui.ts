import { svelteWidget } from '../ext/svelte-widget.ts';
import type { UiPack } from '../ext/types.ts';
import SimBingo from './SimBingo.svelte';
import SimPrep from './SimPrep.svelte';

/**
 * «Симулятор бою»: the official built-in UI pack that shows the exact numbers of the battle analysis.
 * It ships with the game and is off by default; the player switches it on in the settings. It is a
 * UI pack like any other: it registers widgets in slots and texts under `x.simulator.`, and reads the
 * game only through `UiApi` (`api.core` selectors and forecasts, `api.read`, `api.t`).
 */

export const SIMULATOR_ID = 'simulator';

export const SIMULATOR_UK: Record<string, string> = {
  'x.simulator.title': 'Симулятор бою',
  'x.simulator.unknown': 'Невідомий ворог: чисел немає. Побач його в бою або вивчи в Бінґо-книзі.',
  'x.simulator.sameHand': 'Порада збігається з твоєю рукою: порівнювати нічого.',
  'x.simulator.col.now': 'Твоя рука',
  'x.simulator.col.suggested': 'Порада',
  'x.simulator.first': 'Перший бій',
  'x.simulator.session': 'Сесія боїв',
  'x.simulator.interval': '{p} (від {lo} до {hi}, боїв: {n})',
  'x.simulator.wins': 'Перемог за годину',
  'x.simulator.money': 'Рьо за годину',
  'x.simulator.xp': 'Досвіду за годину',
  'x.simulator.wounds': 'Ран за годину',
  'x.simulator.note':
    'Числа складено з багатьох розіграних боїв із твоїм нинішнім набором, сумкою й Ранами. Інтервал чесно показує, наскільки вони певні.',
  'x.simulator.calc': 'Порахувати',
  'x.simulator.running': 'Лічу…',
  'x.simulator.failed': 'Порахувати не вдалося.',
  'x.simulator.winTime': 'Середня перемога триває {n} с',
  'x.simulator.woundsHour': 'Ран за годину таких боїв: {n}',
};

export const simulatorUi: UiPack = {
  id: SIMULATOR_ID,
  setup(ui) {
    ui.addLocale('uk', SIMULATOR_UK);
    ui.addWidget('prep.verdict', svelteWidget<'prep.verdict'>(SimPrep), { id: 'prep', order: 100 });
    ui.addWidget('bingo.entry', svelteWidget<'bingo.entry'>(SimBingo), { id: 'bingo', order: 100 });
  },
};
