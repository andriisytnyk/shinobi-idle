/** Save version 15: the Evasion skill is gone from the game, and a v14 save loses its entries and keeps the rest. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { createState, deserialize, serialize, STATE_VERSION } from '../src/index.ts';

describe('migration v14 -> v15', () => {
  it('drops the XP and pool entries of the removed Evasion skill and nothing else', () => {
    const state = createState(1, content);
    state.skills.tai = { xp: 1234 };
    state.pools.tai = { xp: 77 };
    const raw = JSON.parse(serialize(state, 0)) as {
      v: number;
      state: { v: number; skills: Record<string, unknown>; pools: Record<string, unknown> };
    };
    raw.v = 14;
    raw.state.v = 14;
    raw.state.skills.eva = { xp: 999 };
    raw.state.pools.eva = { xp: 50 };
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(Object.keys(loaded.skills)).not.toContain('eva');
    expect(Object.keys(loaded.pools)).not.toContain('eva');
    expect(loaded.skills.tai?.xp).toBe(1234);
    expect(loaded.pools.tai?.xp).toBe(77);
    expect(content.skills).toHaveLength(15);
  });
});
