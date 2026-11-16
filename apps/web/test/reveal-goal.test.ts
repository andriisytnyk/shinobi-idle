import { content } from '@shinobi/content';
import { createState } from '@shinobi/core';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import GoalPanel from '../src/components/GoalPanel.svelte';
import PinGoal from '../src/components/PinGoal.svelte';
import { game } from '../src/lib/store.ts';
import { coreContext } from './helpers/core-registry.ts';

const freshState = () => {
  const state = createState(1, content);
  state.player.name = 'Тест';
  return state;
};
const textsOf = ({ kind, id }: { kind: string; id: string }) => ({
  name: content.locales.uk[kind + '.' + id + '.name'] ?? '',
});

describe('goals and pins (R1)', () => {
  it('prints a hidden pinned goal as «???» with its hint, never its name or tree', () => {
    const state = freshState();
    state.goal = { kind: 'boss', id: 'core:boss_ren2' };
    game.replaceState(state);
    const body = render(GoalPanel, { props: { onClose: () => {} }, context: coreContext() }).body;
    expect(body).toContain('data-goal-unrevealed');
    expect(body).toContain('???');
    expect(body).not.toContain(textsOf({ kind: 'boss', id: 'core:boss_ren2' }).name);
    expect(body).not.toContain('boss_ren2');
  });

  it('does not offer the pin on a hidden entity, and offers it on a shown one', () => {
    game.replaceState(freshState());
    const pin = (kind: string, id: string) =>
      render(PinGoal, { props: { kind, id, variant: 'button' as const } }).body;
    expect(pin('boss', 'core:boss_ren2')).not.toContain('data-ui="pin-goal"');
    expect(pin('skill', 'tai')).toContain('data-ui="pin-goal"');
  });
});
