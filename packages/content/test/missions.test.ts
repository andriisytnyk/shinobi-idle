/** The hand-written part of the missions: requirements, stage shares, payments in kind, texts, the team and the crate. */
import { describe, expect, it } from 'vitest';
import { content, ukLocale, type Req } from '../src/index.ts';

const board = content.missions.filter((m) => m.rank !== 'OP');
const itemIds = new Set(content.items.map((i) => i.id));
const K = content.balance.K;

describe('missions: data', () => {
  it('opens D and village missions with the Genin rank, C with a flag, and the operation with nothing', () => {
    const genin: Req = { t: 'rank', rank: 'genin' };
    for (const m of content.missions) {
      if (m.rank === 'C') expect(m.unlock, m.id).toEqual({ t: 'flag', id: 'missions.c.unlocked' });
      else if (m.rank === 'OP') expect(m.unlock, m.id).toBeNull();
      else expect(m.unlock, m.id).toEqual(genin);
    }
    expect(board).toHaveLength(21);
  });

  it('splits the minutes with one positive share per stage', () => {
    for (const m of content.missions) {
      expect(m.shares, m.id).toHaveLength(m.stages.length);
      expect(m.slow, m.id).toHaveLength(m.stages.length);
    }
  });

  it('marks as slower fallbacks only Athletics alternatives of the fire and the drought', () => {
    const slow = content.missions.flatMap((m) =>
      m.slow.flatMap((list, stage) =>
        list.map((alt) => {
          const s = m.stages[stage];
          return s?.t === 'tech' ? `${m.id}:${stage}:${s.any[alt]?.skill}` : `${m.id}:${stage}:bad`;
        }),
      ),
    );
    expect(slow.sort()).toEqual(['core:drought:0:ath', 'core:fire:1:ath']);
  });

  it('buys the ambush stage of the caravan with Intel, as the balance says, and nothing else', () => {
    for (const m of content.missions) {
      expect(m.skip, m.id).toHaveLength(m.stages.length);
      expect(
        m.skip.some((n) => n > 0),
        m.id,
      ).toBe(m.id === 'core:caravan');
    }
    expect(content.missions.find((m) => m.id === 'core:caravan')?.skip).toEqual([
      K.intel.caravanSkip,
      0,
      0,
    ]);
  });

  it('scales the units of the sparring mission by its own modifier key', () => {
    const keyed = content.missions.filter((m) => m.resourceMod !== null);
    expect(keyed.map((m) => [m.id, m.resourceMod])).toEqual([['core:v_spar', 'power.sparring']]);
  });

  it('pays in kind as the balance tables say', () => {
    const pay = (id: string) => content.missions.find((m) => m.id === id)?.pay;
    expect(pay('core:weed')).toEqual([{ kind: 'item', item: 'core:rice', n: 6 }]);
    expect(pay('core:fire')).toEqual([{ kind: 'item', item: 'core:rice', n: 6 }]);
    expect(pay('core:drought')).toEqual([
      { kind: 'item', item: 'core:rice', n: 6 },
      { kind: 'item', item: 'core:spice', n: 2 },
    ]);
    expect(pay('core:rockfall')).toEqual([{ kind: 'item', item: 'core:salt', n: 6 }]);
    expect(pay('core:thief')).toEqual([{ kind: 'item', item: 'core:note', n: 1 }]);
    expect(pay('core:caravan')).toEqual([{ kind: 'item', item: 'core:crate', n: 1 }]);
    expect(pay('core:well')).toEqual([{ kind: 'item', item: 'core:spice', n: 2 }]);
    expect(pay('core:mail')).toEqual([{ kind: 'intel', n: K.intel.mail }]);
    expect(pay('core:dig')).toEqual([
      // The chance of the part is the `K.partDrop` entry that the payment names.
      { kind: 'scrollPart', technique: 'core:fire_dragon_flame_bullet', chance: 'mission' },
    ]);
    expect(K.partDrop.mission).toBe(0.15);
  });

  it('has every payment item and scroll part in the item list', () => {
    for (const m of content.missions) {
      for (const p of m.pay) {
        if (p.kind === 'item') expect(itemIds.has(p.item), `${m.id}: ${p.item}`).toBe(true);
        if (p.kind === 'scrollPart') {
          expect(itemIds.has(`core:scrollpart_${p.technique.replace('core:', '')}`), m.id).toBe(
            true,
          );
        }
      }
    }
  });

  it('pays Reputation and ryo per rank', () => {
    for (const m of board) {
      expect(m.rep > 0, m.id).toBe(m.team);
      if (m.rank !== 'V') expect(m.ryo, m.id).toBeGreaterThan(0);
      else expect(m.resource, m.id).not.toBeNull();
    }
  });
});

describe('missions: texts', () => {
  it('has a name, a client and a description, and a label for every stage', () => {
    for (const m of content.missions) {
      for (const part of ['name', 'client', 'desc']) {
        expect(ukLocale[`mission.${m.id}.${part}`], `${m.id} ${part}`).toBeTruthy();
      }
      m.stages.forEach((_, i) => {
        expect(ukLocale[`mission.${m.id}.stage.${i}.label`], `${m.id} stage ${i}`).toBeTruthy();
      });
    }
  });
});

describe('the team, the crate and the notes', () => {
  it('has Ren and Aya with a name, a role line and a description', () => {
    expect(content.team.map((t) => t.id)).toEqual(['core:ren', 'core:aya']);
    for (const t of content.team) {
      for (const part of ['name', 'desc', 'role']) {
        expect(ukLocale[`teammate.${t.id}.${part}`], `${t.id} ${part}`).toBeTruthy();
      }
    }
    expect(content.team.map((t) => t.natureOf)).toEqual(['rival', 'aya']);
  });

  it('gives each nature of the team a state or none', () => {
    expect(Object.keys(K.team.states).sort()).toEqual([
      'doton',
      'futon',
      'katon',
      'raiton',
      'suiton',
    ]);
  });

  it('has a crate table of items that exist, with bounds in order', () => {
    for (const [item, [min, max]] of Object.entries(K.crate.goods)) {
      expect(itemIds.has(item), item).toBe(true);
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeGreaterThanOrEqual(min);
    }
    expect(itemIds.has(K.crate.gem.item)).toBe(true);
    expect(K.crate.gem.chance).toBeGreaterThan(0);
    expect(K.crate.gem.chance).toBeLessThan(0.2);
    expect(content.items.find((i) => i.id === 'core:crate')?.fx).toEqual({ kind: 'crate' });
  });

  it('keeps the notes as an item that raises the Bingo level by one', () => {
    expect(content.items.find((i) => i.id === 'core:note')?.fx).toEqual({
      kind: 'bingoNote',
      levels: 1,
    });
  });

  it('has the ration with its share and the balance of the missions', () => {
    expect(content.items.find((i) => i.id === 'core:sushenyi_paiok')?.fx).toEqual({
      kind: 'ration',
      duration: -0.05,
      missions: 1,
    });
    expect(K.mission.success.cap).toBeLessThanOrEqual(0.99);
    expect(K.mission.slowAlt).toBe(2);
  });
});
