import { content } from '@shinobi/content';
import { createState } from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import { HINTS, nextStateHint } from '../src/lib/hints.ts';

describe('the hint for newly opened missions reads the data of the missions', () => {
  const only = (id: string) => (hint: string) => hint === id;

  it('stays quiet while every mission asks no more than a rank', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    expect(nextStateHint(state, content, only('missionsOpened'))).toBeNull();
  });

  it('fires once the unlock of a mission (here the permission flag of its data) holds', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    const gated = content.missions.find((m) => m.unlock !== null && m.unlock.t === 'flag');
    if (gated?.unlock?.t !== 'flag') throw new Error('no mission gated by a flag');
    state.flags[gated.unlock.id] = true;
    expect(nextStateHint(state, content, only('missionsOpened'))?.id).toBe('missionsOpened');
  });

  it('fires for a pack that gates a mission another way, and names no flag in its source', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    const open = {
      ...content,
      missions: content.missions.map((m, i) =>
        i === 0 ? { ...m, unlock: { t: 'skill' as const, skill: 'tai', level: 1 } } : m,
      ),
    };
    state.skills.tai!.xp = 1e9;
    expect(nextStateHint(state, open, only('missionsOpened'))?.id).toBe('missionsOpened');
    expect(HINTS.some((h) => h.id === 'cMissions')).toBe(false);
  });
});

describe('a finished item step', () => {
  it('shows its requirement as met, whatever the bank holds now', async () => {
    const { evalReq } = await import('@shinobi/core');
    const { asMet } = await import('../src/lib/next-step.ts');
    const step = content.quests
      .find((q) => q.id === 'core:mission_board')
      ?.steps.map((s) => s.objective)
      .find((o) => o.t === 'req' && o.req.t === 'item');
    if (step?.t !== 'req') throw new Error('no item step');
    const state = createState(1, content);
    const live = evalReq(state, step.req, content);
    expect(live.met).toBe(false);
    const shown = asMet(live);
    expect(shown.met).toBe(true);
    expect(shown.current).toBe(shown.target);
  });
});
