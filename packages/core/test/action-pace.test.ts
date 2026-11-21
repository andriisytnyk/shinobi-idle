/**
 * The pace of actions (issue #69): cycle and XP per cycle are data of each action, the cycle grows
 * along a skill, Mastery XP per action grows with the mastery level of the action while skill XP does
 * not, and a technique still reaches mastery 25 in about 45 minutes of use.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  courseKind,
  defaultRules,
  dispatch,
  cycleSeconds,
  cycleXp,
  masteryLevel,
  masteryXpPerAction,
  masteryXpPerHour,
  practiceXp,
  rate,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { genin, plainRules, setLevel, start } from './helpers.ts';

const K = content.balance.K;
const MINUTE = 60_000;
const ok = (s: GameState, kind: string, id: string) =>
  expect(dispatch(s, start(kind, id), content, plainRules)).toEqual({ ok: true });

describe('explicit cycle and XP per action', () => {
  const lists = [
    ['drill', content.exercises],
    ['meditate', content.practices],
    ['gather', content.herbs],
    ['obstacle', content.obstacles],
    ['craft', content.recipes],
  ] as const;

  it('every action of the built-in content carries its cycle and its XP', () => {
    for (const [kind, list] of lists) {
      expect(list.length, kind).toBeGreaterThan(0);
      for (const a of list) {
        expect(a.cycle, `${kind} ${a.id}`).toBeGreaterThan(0);
        expect(a.xp, `${kind} ${a.id}`).toBeGreaterThan(0);
      }
    }
    for (const t of content.techniques) expect(t.practiceXp, t.id).toBeGreaterThan(0);
  });

  it('is what the action runs and pays: a drill cycle is the data, a completion pays the data', () => {
    const drill = content.exercises[4]!;
    const s = genin();
    setLevel(s, 'cc', Math.max(drill.level, 1));
    const info = actionInfo(s, { kind: 'drill', id: drill.id }, content, plainRules);
    expect(info?.baseMs).toBe(Math.round((drill.cycle ?? 0) * 1000));
    expect(info?.intervalMs).toBe(Math.round((drill.cycle ?? 0) * 1000));
    ok(s, 'drill', drill.id);
    const before = s.skills.cc!.xp;
    advance(s, info!.intervalMs, content, plainRules);
    expect(s.skills.cc!.xp - before).toBeCloseTo(drill.xp ?? 0, 9);
  });

  it('pays an action without data the pace of its level over the first-tier cycle (packs need not carry it)', () => {
    const bare = { level: 20 };
    expect(cycleSeconds('drill', bare, content)).toBe(K.drill);
    expect(cycleXp('drill', bare, content)).toBeCloseTo((rate(20, content) * K.drill) / 3600, 9);
    expect(cycleXp('craft', bare, content)).toBeCloseTo(
      (rate(20, content) * K.craft * K.craftXpMult) / 3600,
      9,
    );
  });

  it('keeps the pace of the balance model: XP per hour of every action is the rate of its level', () => {
    // The identity of the change: the data was generated as rate x cycle (a herb also pays its share of
    // the regrow pause of a first-size bush, a craft its multiplier), so XP per hour is what it was.
    for (const e of content.exercises) {
      // The Vitality drills pay the share of the pace a fight pays the skill (K.combatXp.vit).
      const share = e.skill === 'vit' ? (K.combatXp.vit ?? 1) : 1;
      expect(((e.xp ?? 0) * 3600) / (e.cycle ?? 1) / rate(e.level, content), e.id).toBeCloseTo(
        share,
        3,
      );
    }
    for (const o of content.obstacles) {
      expect(((o.xp ?? 0) * 3600) / (o.cycle ?? 1) / rate(o.level, content), o.id).toBeCloseTo(
        1,
        3,
      );
    }
    for (const p of content.practices) {
      expect(((p.xp ?? 0) * 3600) / (p.cycle ?? 1) / rate(p.level, content), p.id).toBeCloseTo(
        1,
        3,
      );
    }
    for (const r of content.recipes) {
      const perHour = ((r.xp ?? 0) * 3600) / (r.cycle ?? 1);
      expect(perHour / (rate(r.level, content) * K.craftXpMult), r.id).toBeCloseTo(1, 3);
    }
    // The work that found points open follows the pace of its level too (it has no regrow pause).
    for (const w of content.fieldworks) {
      const perHour = (w.xp * 3600) / w.cycle;
      expect(perHour / rate(w.level, content), w.id).toBeCloseTo(1, 3);
    }
    // A first-size bush gathered steadily holds out size / (1 - cycle / regrowEachMs) herbs, then pauses regrowMs.
    for (const h of content.herbs) {
      const cycle = h.cycle ?? 1;
      const run = (K.field.stockBase + 1) / (1 - (cycle * 1000) / K.field.regrowEachMs);
      const pause = K.field.regrowMs / 1000 / run;
      const perHour = ((h.xp ?? 0) * 3600) / (cycle + pause);
      expect(perHour / rate(h.level, content), h.id).toBeCloseTo(1, 3);
    }
  });

  it('pays a practice cycle the pace of the technique at mastery 1: its XP per hour is what it was', () => {
    const t = content.techniques.find((x) => x.id === 'core:great_fireball')!;
    // The importer's number and the core fallback (a technique of a pack without the field) agree.
    expect(t.practiceXp).toBeDefined();
    expect(practiceXp({ ...t, practiceXp: undefined }, content)).toBeCloseTo(t.practiceXp!, 2);
    const s = genin();
    s.player.natures = [t.skill];
    setLevel(s, t.skill, t.level);
    s.known[t.id] = true;
    const info = actionInfo(s, { kind: 'practice', id: t.id }, content, plainRules);
    expect((info?.xpPerHour ?? 0) / rate(t.level, content)).toBeCloseTo(1, 3);
  });
});

describe('the cycle grows along a skill', () => {
  const grows = (cycles: number[]) => {
    expect(cycles.length).toBeGreaterThan(2);
    for (let i = 1; i < cycles.length; i++) {
      expect(cycles[i], `step ${i}`).toBeGreaterThanOrEqual(cycles[i - 1]!);
    }
    expect(cycles[cycles.length - 1]!).toBeGreaterThan(cycles[0]! * 2);
  };
  const byLevel = <T extends { level: number; cycle?: number | undefined }>(list: readonly T[]) =>
    [...list].sort((a, b) => a.level - b.level).map((a) => a.cycle ?? 0);

  it('lengthens drills, herbs and obstacles with their level, up to the cycle of the skill cap', () => {
    grows(byLevel(content.exercises));
    grows(byLevel(content.herbs));
    grows(byLevel(content.obstacles));
    const last = (list: readonly { level: number; cycle?: number | undefined }[]) =>
      byLevel(list)[list.length - 1];
    expect(last(content.exercises)).toBe(K.cycleMax.drill);
    expect(last(content.herbs)).toBe(K.cycleMax.gather);
  });

  it('keeps the artisan skills and Meditation at a constant cycle, as exceptions of the data', () => {
    for (const r of content.recipes) expect(r.cycle, r.id).toBe(K.craft);
    for (const p of content.practices) expect(p.cycle, p.id).toBe(K.meditate);
  });

  it('lengthens the practice cycle of the techniques of a skill with their level', () => {
    const cycles = content.techniques
      .filter((t) => t.skill === 'katon')
      .sort((a, b) => a.level - b.level)
      .map((t) => {
        const s = genin();
        s.player.natures = ['katon'];
        setLevel(s, 'katon', t.level);
        s.known[t.id] = true;
        return actionInfo(s, { kind: 'practice', id: t.id }, content, plainRules)!.baseMs;
      });
    expect(cycles[cycles.length - 1]!).toBeGreaterThan(cycles[0]!);
  });

  it('runs a lap as long as the cycles of its obstacles added up', () => {
    const s = genin();
    setLevel(s, 'ath', 50);
    s.currencies.ryo = 1_000_000;
    s.course = { '1': 'core:bih_navkolo_sela', '3': 'core:ukhylennia_vid_kunaiv' };
    const total = ['core:bih_navkolo_sela', 'core:ukhylennia_vid_kunaiv']
      .map((id) => content.obstacles.find((o) => o.id === id)!)
      .reduce((sum, o) => sum + Math.round((o.cycle ?? 0) * 1000), 0);
    expect(courseKind.intervalMs(s, 'ath', content, defaultRules)).toBe(total);
  });
});

describe('Mastery XP grows with the mastery level of the action, skill XP does not', () => {
  const at = (level: number) => ({ xp: level <= 1 ? 0 : xpAt(level) });

  it('pays more Mastery per action at a higher mastery level, the same skill XP', () => {
    const drill = content.exercises[2]!;
    const gain = (level: number) => {
      const s = genin();
      setLevel(s, 'cc', Math.max(drill.level, 1));
      s.mastery[drill.id] = at(level);
      const m0 = s.mastery[drill.id]!.xp;
      const x0 = s.skills.cc!.xp;
      ok(s, 'drill', drill.id);
      advance(s, Math.round((drill.cycle ?? 0) * 1000), content, plainRules);
      return { mastery: s.mastery[drill.id]!.xp - m0, xp: s.skills.cc!.xp - x0 };
    };
    const low = gain(1);
    const mid = gain(25);
    const high = gain(60);
    expect(mid.mastery).toBeGreaterThan(low.mastery * 2);
    expect(high.mastery).toBeGreaterThan(mid.mastery * 1.5);
    expect(mid.xp).toBe(low.xp);
    expect(high.xp).toBe(low.xp);
    const seconds = drill.cycle ?? 0;
    expect(low.mastery).toBeCloseTo(masteryXpPerAction(1, seconds, content), 6);
    expect(high.mastery).toBeCloseTo(masteryXpPerAction(60, seconds, content), 6);
  });

  it('grows the share of the pool with it', () => {
    const drill = content.exercises[2]!;
    const pool = (level: number) => {
      const s = genin();
      setLevel(s, 'cc', Math.max(drill.level, 1));
      s.mastery[drill.id] = at(level);
      ok(s, 'drill', drill.id);
      advance(s, Math.round((drill.cycle ?? 0) * 1000), content, plainRules);
      return s.pools.cc!.xp;
    };
    expect(pool(40)).toBeCloseTo(
      (pool(1) * masteryXpPerHour(40, content)) / masteryXpPerHour(1, content),
      6,
    );
  });

  it('pays more per second of a technique used in a fight at a higher mastery level', () => {
    const fightGain = (level: number) => {
      const s = genin(3);
      s.known['core:leaf_whirlwind'] = true;
      s.mastery['core:leaf_whirlwind'] = at(level);
      const before = s.mastery['core:leaf_whirlwind']!.xp;
      dispatch(s, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' }, content);
      advance(s, 5 * MINUTE, content);
      return s.mastery['core:leaf_whirlwind']!.xp - before;
    };
    expect(fightGain(30)).toBeGreaterThan(fightGain(1) * 2);
  });

  it('is the formula of the balance: perSecond x (base + level)', () => {
    for (const level of [1, 25, 50, 99]) {
      expect(masteryXpPerHour(level, content)).toBeCloseTo(
        K.mastery.perSecond * (K.mastery.base + level) * 3600,
        6,
      );
    }
  });
});

describe('the mastery milestones of the model', () => {
  it('reaches mastery 25 in about 45 minutes of using a technique (35 to 55)', () => {
    const t = content.techniques.find((x) => x.id === 'core:leaf_whirlwind')!;
    const s = genin();
    s.known[t.id] = true;
    dispatch(s, start('practice', t.id), content, plainRules);
    let minutes = 0;
    while (masteryLevel(s, t.id, content) < 25 && minutes < 120) {
      advance(s, MINUTE, content, plainRules);
      minutes++;
    }
    expect(minutes).toBeGreaterThanOrEqual(35);
    expect(minutes).toBeLessThanOrEqual(55);
  });

  it('costs about 4 to 6 hours for mastery 50 and a few hundred for mastery 99', () => {
    const hoursTo = (level: number): number => {
      let xp = 0;
      let t = 0;
      const step = 10;
      while (xp < xpAt(level)) {
        xp += (masteryXpPerHour(Math.max(1, masteryLevelAt(xp)), content) * step) / 3600;
        t += step;
      }
      return t / 3600;
    };
    const masteryLevelAt = (xp: number): number => {
      let l = 1;
      while (l < K.masteryCap && xpAt(l + 1) <= xp) l++;
      return l;
    };
    expect(hoursTo(25)).toBeGreaterThan(0.6);
    expect(hoursTo(25)).toBeLessThan(0.9);
    expect(hoursTo(50)).toBeGreaterThan(4);
    expect(hoursTo(50)).toBeLessThan(6);
    expect(hoursTo(99)).toBeGreaterThan(200);
    expect(hoursTo(99)).toBeLessThan(400);
  });
});
