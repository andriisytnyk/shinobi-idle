/**
 * The findings of the review of the raid: the dormant data of a pack's raid, a clone that loses the raid fight,
 * the report of a raid met while away, and the migration reading the step that asks for a raid.
 */
import { readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  advanceOffline,
  deserialize,
  dispatch,
  growSlots,
  serialize,
  updateQuests,
  villageRaids,
  type GameState,
} from '../src/index.ts';
import { fighter } from './prep-state.ts';
import { modContent, modGenin, modRules, plainContent, plainRules } from './packs-helpers.ts';

const TICK = content.balance.K.tickMin * 60_000;
const raid = content.raids[0]!;
const QUEST = 'core:outskirts';
const STEP = raid.trigger.t === 'quest' ? (raid.trigger.step ?? 0) : 0;
const village = (s: GameState) => {
  if (!s.village) throw new Error('no village');
  return s.village;
};

describe('the raid of a pack and a save loaded without the pack', () => {
  const PACK_RAID = 'testmod:raid_probe';
  const pack = modContent.raids.find((r) => r.id === PACK_RAID)!;

  /** A game with the pack whose raid has come, been stopped by the village and ended; the hut is damaged. */
  function finished(): GameState {
    const s = modGenin(3);
    s.flags['testmod.raid.call'] = true;
    village(s).levels['testmod:hut'] = 1;
    updateQuests(s, modContent);
    advance(s, (pack.lead + pack.hold + 1) * TICK, modContent, modRules);
    return s;
  }

  it('is data of the pack: it is called by its own trigger and ends with damage', () => {
    const s = finished();
    expect(village(s).raids[PACK_RAID]).toMatchObject({ phase: 'over', breached: 1 });
    expect(village(s).damage['testmod:hut']).toBeGreaterThan(0);
  });

  it('is kept while the pack is away and is not called and paid again when the pack is back', () => {
    const s = finished();
    const ryo = s.currencies.ryo ?? 0;
    const text = serialize(s);
    // Loaded without the pack, saved, loaded with the pack again.
    const without = deserialize(text, plainContent, plainRules);
    expect(without.village?.raids[PACK_RAID]).toBeUndefined();
    expect(without.village?.damage['testmod:hut']).toBeUndefined();
    const back = deserialize(serialize(without), modContent, modRules);
    expect(village(back).raids[PACK_RAID]).toMatchObject({ phase: 'over', breached: 1 });
    expect(village(back).damage['testmod:hut']).toBe(village(s).damage['testmod:hut']);
    expect(back.flags[`raid.${PACK_RAID}.over`]).toBe(true);
    // Time passes: nothing is called again, nothing is paid again.
    back.events = [];
    advance(back, 6 * TICK, modContent, modRules);
    expect(back.events.filter((e) => e.type === 'raidCalled' || e.type === 'raidArrived')).toEqual(
      [],
    );
    expect(back.currencies.ryo ?? 0).toBeLessThanOrEqual(ryo + 1_000);
    expect(village(back).raids[PACK_RAID]?.phase).toBe('over');
  });
});

describe('a clone that loses the raid fight', () => {
  it('pays nothing, counts no pack, and leaves the raid at the gates', () => {
    // The same raid against an enemy far too strong for a level 1 clone: the clone loses the fights it starts.
    const hard = { ...content, raids: [{ ...raid, enemy: 'core:foreign_genin' }] };
    const s = fighter(7, 1);
    s.quests[QUEST] = { step: STEP, base: 0, done: false };
    updateQuests(s, hard);
    advance(s, raid.lead * TICK, hard);
    s.known['core:shadow_clone'] = true;
    growSlots(s, hard);
    const start = { type: 'action.start', slot: 1, kind: 'fight', id: raid.id } as const;
    expect(dispatch(s, start, hard).ok).toBe(true);
    const money = { ...s.currencies };
    s.events = [];
    for (let i = 0; i < 30; i++) advance(s, 30_000, hard);
    expect(s.events.some((e) => e.type === 'playerDefeated' && e.clone === true)).toBe(true);
    const info = villageRaids(s, hard)[0]!;
    // What the clone lost is not counted as a pack repelled, and nothing is paid before the raid ends.
    expect(info.repelled).toBe(0);
    expect(info.phase).toBe('active');
    expect(s.currencies).toEqual(money);
    expect(village(s).raids[raid.id]?.ryo).toBe(0);
  });
});

describe('a raid met while away', () => {
  it('is told in the summary of the time away, the end replacing the arrival', () => {
    const s = fighter(7, 1);
    s.quests[QUEST] = { step: STEP, base: 0, done: false };
    updateQuests(s, content);
    const part = raid.defence[0]!;
    village(s).levels[part.id] = Math.ceil((raid.packs * raid.perPack) / part.per);
    const summary = advanceOffline(s, (raid.lead + raid.hold + 2) * TICK, content);
    expect(summary.raids).toHaveLength(1);
    expect(summary.raids?.[0]).toMatchObject({
      raid: raid.id,
      over: true,
      byVillage: raid.packs,
      breached: 0,
    });
    // The queued events of the player are untouched by the catch-up.
    expect(s.events.filter((e) => e.type === 'raidOver')).toEqual([]);
  });

  it('says nothing when no raid came', () => {
    const s = fighter(7, 1);
    const summary = advanceOffline(s, 3 * TICK, content);
    expect(summary.raids).toEqual([]);
  });
});

describe('the migration reads the step that asks for the raid', () => {
  const fixtures = JSON.parse(
    readFileSync(new URL('./fixtures/save-v18-real.json', import.meta.url), 'utf8'),
  ) as Record<string, { save: string }>;
  const over = `raid.${raid.id}.over`;
  /** The content with the step that asks for the raid written as another tree. */
  const asking = (req: unknown) => ({
    ...content,
    quests: content.quests.map((q) => ({
      ...q,
      steps: q.steps.map((st) =>
        st.objective.t === 'req' && st.objective.req.t === 'flag' && st.objective.req.id === over
          ? { ...st, objective: { t: 'req', req } }
          : st,
      ),
    })),
  });

  it('takes a step that asks for the flag inside `all` as past, so the raid is over and not called', () => {
    const db = asking({
      t: 'all',
      of: [
        { t: 'flag', id: over },
        { t: 'currency', role: 'money', n: 1 },
      ],
    }) as typeof content;
    const state = deserialize(fixtures['outskirts-done']!.save, db);
    expect(village(state).raids[raid.id]?.phase).toBe('over');
  });

  it('does not take a step that asks for it through `any`: the step could have been done another way', () => {
    const db = asking({
      t: 'any',
      of: [
        { t: 'flag', id: over },
        { t: 'currency', role: 'money', n: 1 },
      ],
    }) as typeof content;
    const state = deserialize(fixtures['outskirts-done']!.save, db);
    expect(village(state).raids[raid.id]?.phase).not.toBe('over');
  });
});
