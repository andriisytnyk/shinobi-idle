// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/lib/game.svelte.ts';
import { t } from '../src/lib/i18n.ts';
import { refusalParams } from '../src/lib/toasts.svelte.ts';

/*
 * D9: what the player is told when the packs of the game changed since the save, and when a rule of a
 * pack failed. The events come from the core; the store turns them into notices.
 */

function make() {
  const toasts = { push: vi.fn() };
  const game = createGame({ clock: { now: () => 0 }, toasts });
  const emit = (event: object) => {
    game.state.events.push({ at: 0, ...event } as never);
    game.devAdvance(0);
  };
  return { game, toasts, emit };
}

describe('packsChanged (D9)', () => {
  it('says that a pack of the save is gone, in the words of the design', () => {
    const { toasts, emit } = make();
    emit({ type: 'packsChanged', added: [], removed: ['testmod'], updated: [] });
    const call = toasts.push.mock.calls[0]?.[0];
    expect(call.persistent).toBe(true);
    expect(t(call.key, call.params)).toBe(
      'Збереження зроблено з розширенням «testmod», якого зараз немає. Його дані збережено й повернуться разом із ним.',
    );
  });

  it('says that a pack appeared, and that a pack was updated', () => {
    const { toasts, emit } = make();
    emit({
      type: 'packsChanged',
      added: ['a'],
      removed: [],
      updated: [{ id: 'b', from: '1.0.0', to: '1.1.0' }],
    });
    const texts = toasts.push.mock.calls.map(([c]) => t(c.key, c.params));
    expect(texts).toEqual([
      "З'явилося нове розширення: «a».",
      'Розширення оновлено: b 1.0.0 → 1.1.0.',
    ]);
  });
});

describe('ruleDisabled (D9)', () => {
  it('tells once per rule and lists it for the session', () => {
    const { game, toasts, emit } = make();
    const event = { type: 'ruleDisabled', pack: 'testmod', rule: 'system.x', reason: 'boom' };
    emit(event);
    emit(event);
    emit({ ...event, rule: 'system.y' });
    const told = toasts.push.mock.calls.filter(([c]) => c.key === 'toast.ruleDisabled');
    expect(told).toHaveLength(2);
    expect(t('toast.ruleDisabled', { pack: 'testmod' })).toBe(
      'Частину розширення «testmod» вимкнено через помилку. Гра працює далі.',
    );
    expect(game.ruleNotices.map((n) => n.rule)).toEqual(['system.x', 'system.y']);
  });
});

describe('refusals that name a currency', () => {
  it('show its name', () => {
    const p = refusalParams({ params: { currency: 'ryo' } });
    expect(t('error.notEnoughCurrency', p)).toBe('Недостатньо: Рьо');
  });
});
