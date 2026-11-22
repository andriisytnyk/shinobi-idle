// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { performerMaxHp } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ReportModal from '../src/components/ReportModal.svelte';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { formatHpRate } from '../src/lib/format.ts';
import { buildReport } from '../src/lib/persistence.ts';
import { hpText, regenText, vitalsOf } from '../src/lib/vitals.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

let booted: BootedApp | null = null;
beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
});

describe('the health of the character outside a fight', () => {
  it('shows in the top bar with its regeneration per second, and follows the state', async () => {
    booted = await bootApp([coreUi]);
    const bar = booted.target.querySelector<HTMLElement>('header.topbar')!;
    const value = bar.querySelector('[data-hp-value]');
    const max = performerMaxHp(game.state, content);
    expect(value?.textContent).toBe(hpText(vitalsOf(game.state, 0, content, game.rules)));
    expect(value?.textContent?.replace(/\s/g, '')).toContain(`/${Math.round(max)}`);
    // The regeneration is a signed rate per second, with a decimal comma.
    const regen = bar.querySelector('[data-hp-regen]')?.textContent ?? '';
    expect(regen).toMatch(/^\+\d+,\d+\/с$/);
    expect(regen).toBe(regenText(vitalsOf(game.state, 0, content, game.rules)));
    // A hurt character shows what it has.
    game.state.player.hp = 12;
    game.tick();
    flushSync();
    expect(vitalsOf(game.state, 0, content, game.rules).hp).toBe(12);
  });

  it('writes the rate with two decimals under a tenth and one above', () => {
    expect(formatHpRate(0.06)).toBe('0,06');
    expect(formatHpRate(0.4)).toBe('0,4');
    expect(formatHpRate(1.25)).toBe('1,3');
  });
});

describe('the report of the time away', () => {
  const summary = (before: number, after: number) => ({
    requestedMs: 3_600_000,
    simulatedMs: 3_600_000,
    capped: false,
    skillXp: { tai: 5 },
    levelsGained: {},
    masteryLevelsGained: {},
    techniquesLearned: [],
    actionsStopped: [],
    reports: {},
    hp: { before, after, max: 120 },
  });

  it('carries the health when it changed by a point or more, and not when it did not', () => {
    expect(buildReport(summary(34, 120))?.hp).toEqual({ before: 34, after: 120, max: 120 });
    expect(buildReport(summary(120, 120))?.hp).toBeUndefined();
  });

  it('says it in the modal', () => {
    const report = buildReport(summary(34, 120));
    if (!report) throw new Error('no report');
    const target = document.createElement('div');
    document.body.append(target);
    const app = mount(ReportModal, { target, props: { report, onClose: () => {} } });
    flushSync();
    const row = document.body.querySelector('[data-report-hp]');
    expect(row?.textContent).toContain('34');
    expect(row?.textContent).toContain('120');
    unmount(app);
    target.remove();
  });
});
