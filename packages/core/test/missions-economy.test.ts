/** A10: the economy of the board — ryo, Reputation and XP per hour at the natural level of each mission. */
import { content, type Mission, type SkillId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { defaultRules, missionForecast, type MissionForecast } from '../src/index.ts';
import { BOARD, mission, natureFor, player } from './missions-helpers.ts';

const K = content.balance.K;
const LEVELS_ABOVE = 5;

/** A player at the natural level for `m`: five levels above what its stages ask, the techniques of the board known. */
function natural(m: Mission, team: boolean) {
  const levels: Partial<Record<SkillId, number>> = { tai: 20, vit: 20, eva: 20 };
  for (const stage of m.stages) {
    if (stage.t === 'skill') levels[stage.skill] = stage.min + LEVELS_ABOVE;
    if (stage.t === 'tech') {
      const alt = stage.any[0];
      if (alt) levels[alt.skill] = alt.min + LEVELS_ABOVE;
    }
    if (stage.t === 'named') {
      const tech = content.techniques.find((t) => t.id === stage.technique);
      if (tech) levels[tech.skill] = tech.level;
    }
  }
  return player({
    natures: [natureFor(m)],
    levels,
    team,
    known: ['core:enclosing', 'core:shadow_clone'],
    bank: { 'core:antidote': 10, 'core:wire': 20 },
  });
}

const forecastOf = (m: Mission, team = true): MissionForecast =>
  missionForecast(natural(m, team), m, content, defaultRules);

describe('A10: the economy of the board', () => {
  it('prints ryo, Reputation and XP per hour for each mission', () => {
    const rows = BOARD.map((m) => {
      const f = forecastOf(m);
      const xp = Object.values(f.xpPerHour).reduce((a, b) => a + b, 0);
      return (
        `${m.id.padEnd(18)} ${m.rank} ${String(m.minutes).padStart(2)} min  ` +
        `${f.doable ? 'ok  ' : 'NO  '} ryo/min ${(f.ryo / m.minutes).toFixed(1).padStart(5)}  ` +
        `with failures ${(f.ryoPerHour / 60).toFixed(1).padStart(5)}  rep/h ${f.repPerHour.toFixed(1).padStart(5)}  ` +
        `xp/h ${xp.toFixed(0).padStart(6)}`
      );
    });
    console.log(
      `\nEconomy of the board (natural level: ${LEVELS_ABOVE} above the requirement)\n${rows.join('\n')}`,
    );
    expect(BOARD.every((m) => forecastOf(m).doable)).toBe(true);
  });

  it('pays about 12 ryo a minute for D and 22 for C, before bonuses', () => {
    for (const rank of ['D', 'C'] as const) {
      const list = BOARD.filter((m) => m.rank === rank);
      const ryo = list.reduce((s, m) => s + m.ryo, 0);
      const minutes = list.reduce((s, m) => s + m.minutes, 0);
      const perMin = ryo / minutes;
      console.log(
        `${rank} missions pay ${perMin.toFixed(2)} ryo per minute (the balance says ${K.ryoPerMin[rank]})`,
      );
      expect(Math.abs(perMin - K.ryoPerMin[rank]) / K.ryoPerMin[rank]).toBeLessThan(0.05);
    }
  });

  it('reports the hours of missions that Reputation 120 and 300 take', () => {
    const rate = (ranks: string[], team = true) =>
      Math.max(
        ...BOARD.filter((m) => ranks.includes(m.rank) && m.rep > 0).map(
          (m) => forecastOf(m, team).repPerHour,
        ),
      );
    const rows: string[] = [];
    for (const [label, ranks] of [
      ['D team missions', ['D']],
      ['C team missions', ['C']],
      ['village missions', ['V']],
      ['all team missions', ['D', 'C', 'V']],
    ] as const) {
      const best = rate([...ranks]);
      rows.push(
        `${label.padEnd(18)} best ${best.toFixed(1).padStart(5)} Reputation/h: ` +
          `120 in ${(120 / best).toFixed(1)} h, 300 in ${(300 / best).toFixed(1)} h`,
      );
    }
    // The average of every team mission of a rank, for a player who does them all in turn.
    for (const rank of ['D', 'C', 'V']) {
      const list = BOARD.filter((m) => m.rank === rank && m.rep > 0);
      const hours = list.reduce((s, m) => s + forecastOf(m).expectedMs, 0) / 3_600_000;
      const rep = list.reduce((s, m) => s + forecastOf(m).rep, 0);
      rows.push(
        `${rank} team missions in turn   ${(rep / hours).toFixed(1).padStart(5)} Reputation/h: 120 in ${(120 / (rep / hours)).toFixed(1)} h, 300 in ${(300 / (rep / hours)).toFixed(1)} h`,
      );
    }
    console.log(`\nReputation\n${rows.join('\n')}`);
    expect(Math.min(...BOARD.map((m) => forecastOf(m).expectedMs))).toBeGreaterThan(0);
    expect(mission('core:cat').rep).toBe(K.repPerMission.D);
  });

  it('shortens the time with mastery and level, and pays more per hour for it', () => {
    const m = mission('core:rockfall');
    const slow = missionForecast(natural(m, false), m, content, defaultRules);
    const fast = natural(m, false);
    fast.skills.doton.xp *= 4;
    const quick = missionForecast(fast, m, content, defaultRules);
    expect(quick.nominalMs).toBeLessThan(slow.nominalMs);
    expect(quick.ryoPerHour).toBeGreaterThan(slow.ryoPerHour);
  });

  it('forecasts the next Mastery step of the technique a stage uses', () => {
    const m = mission('core:rockfall');
    const f = missionForecast(natural(m, false), m, content, defaultRules);
    const stage = f.stages[0];
    expect(stage?.path?.tech).not.toBe('');
    expect(stage?.next?.ms).toBeLessThan(stage?.ms ?? 0);
    expect(stage?.next?.chance).toBeGreaterThan(stage?.chance ?? 1);
  });
});
