import { content } from '@shinobi/content';
import {
  advance,
  createState,
  dispatch,
  foldEvents,
  newTelemetry,
  observeState,
  snapshotForTelemetry,
} from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import { buildEnvironment } from '../src/env.ts';
import { runTelemetryReportCli } from '../src/telemetryReport.ts';

function exported(): string {
  const state = createState(5, content);
  const rec = newTelemetry(1_800_000_000_000);
  dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' }, content);
  for (let i = 0; i < 300; i++) {
    const before = snapshotForTelemetry(state, content);
    advance(state, 1000, content);
    foldEvents(rec, state.events, rec.created + i * 1000);
    state.events = [];
    observeState(rec, before, state, content, rec.created + i * 1000);
  }
  return JSON.stringify({
    format: 'shinobi-telemetry',
    exportedAt: rec.created,
    game: { now: state.now, rank: state.player.rank, stateVersion: state.v, packs: [] },
    record: rec,
  });
}

describe('telemetry-report', () => {
  const env = buildEnvironment(['core']);
  it('turns an exported file into Markdown', () => {
    const result = runTelemetryReportCli(['f.json'], env, () => exported());
    expect(result.code).toBe(0);
    const text = result.out.join('\n');
    expect(text).toContain('# Звіт телеметрії');
    expect(text).toContain('## Віхи');
    expect(text).toContain('fight');
  });
  it('refuses a file that is not telemetry', () => {
    const result = runTelemetryReportCli(['f.json'], env, () => '{"a":1}');
    expect(result.code).toBe(1);
    expect(result.err.join()).toContain('shinobi-telemetry');
    expect(runTelemetryReportCli([], env, () => '').code).toBe(1);
  });
});
