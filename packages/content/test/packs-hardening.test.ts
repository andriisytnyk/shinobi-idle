/**
 * Pack data is untrusted, and the closure validator checks more than references: modifier keys,
 * icons, tiers, ranges. Each case mutates the test pack or builds a small pack and expects the
 * composer to name the pack at fault.
 */
import { describe, expect, it } from 'vitest';
import { testmodPack } from '@shinobi/content/testmod';
import { composeContent, corePack, validateClosure, type ContentPack } from '../src/index.ts';
import { mod, throwsFor } from './pack-helpers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test data is mutated loosely
type Loose = Omit<ContentPack, 'data'> & { data: Record<string, any> };

/** A mutable deep copy of the test pack (it is plain data). */
const tm = (change: (pack: Loose) => void): ContentPack => {
  const copy = JSON.parse(JSON.stringify(testmodPack)) as Loose;
  change(copy);
  return copy as unknown as ContentPack;
};
const both = composeContent([corePack, testmodPack]);
const tier = (pack: string, minTier = 0) => ({
  id: `${pack}:t`,
  minTier,
  rules: ['basic'],
  waitMs: 800,
  tactical: false,
});
const K = (p: Loose) => p.balance.K as Record<string, Record<string, number>>;

describe('pack data is untrusted: keys that reach the prototype chain', () => {
  const untouched = () => {
    expect(Object.hasOwn(Object.prototype, 'testmod:x')).toBe(false);
    expect(({} as Record<string, unknown>)['testmod:x']).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(Object.getPrototypeOf(Object)).toBe(Function.prototype);
    expect(Object.hasOwn(Object, 'testmod:x')).toBe(false);
  };

  it('rejects __proto__ in icons, balance, locales, data and patches, and leaves Object untouched', () => {
    const polluted = (field: string, json: string) => {
      const pack = mod('evil', { [field]: JSON.parse(json) } as Partial<ContentPack>);
      throwsFor([corePack, pack], 'evil', /forbidden key "__proto__"/);
      untouched();
    };
    polluted('icons', '{"__proto__":{"testmod:x":"a"}}');
    polluted('icons', '{"skill":{"__proto__":"a"}}');
    polluted('balance', '{"K":{"ext":{"evil":{"__proto__":{"testmod:x":1}}}}}');
    polluted('locales', '{"uk":{"__proto__":"x"}}');
    polluted('data', '{"tags":[{"id":"evil:t","__proto__":{"testmod:x":1}}]}');
    polluted(
      'patches',
      '[{"target":{"kind":"enemies","id":"core:wolf"},"set":{"__proto__":{"testmod:x":1}}}]',
    );
  });

  it('rejects constructor and prototype keys and ids, and a patch to a list named __proto__', () => {
    throwsFor(
      [corePack, mod('evil', { icons: JSON.parse('{"skill":{"constructor":"a"}}') })],
      'evil',
      /forbidden key "constructor"/,
    );
    throwsFor(
      [corePack, mod('evil', { data: { tags: [{ id: 'evil:constructor' }] } })],
      'evil',
      /forbidden id part/,
    );
    throwsFor(
      [corePack, mod('evil', { data: JSON.parse('{"constructor":[]}') })],
      'evil',
      /forbidden key "constructor"/,
    );
    const patch = mod('evil', {
      patches: [{ target: { kind: '__proto__', id: 'x' } as never, set: { a: 1 } }],
    });
    throwsFor([corePack, patch], 'evil', /unknown list "__proto__"/);
    untouched();
  });
});

describe('the closure validator catches more than references', () => {
  it('checks the modifier key of a gear piece', () => {
    for (const key of ['xp.skill.testmod:nothing', 'xp.skil.testmod:forge'])
      throwsFor(
        [corePack, tm((p) => (p.data.gear![0]!.fx.key = key))],
        'testmod',
        /gear "testmod:anvil" field fx.key: unknown modifier key/,
      );
  });

  it('checks every modifier key in an entity, the nature of a modifier and a mission resource key', () => {
    throwsFor(
      [
        corePack,
        tm((p) => (p.data.buildings![0]!.capstone = [{ key: 'made.up', op: 'add', value: 1 }])),
      ],
      'testmod',
      /unknown modifier key "made.up"/,
    );
    throwsFor(
      [corePack, tm((p) => (p.data.buildings![0]!.effects[0].nature = 'testmod:nope'))],
      'testmod',
      /"testmod:nope" is not a known natures/,
    );
    throwsFor(
      [corePack, tm((p) => (p.data.missions![0]!.resourceMod = 'made.up'))],
      'testmod',
      /missions "testmod:test_run" field resourceMod/,
    );
  });

  it('checks that an icon names an entity of its kind', () => {
    throwsFor(
      [corePack, tm((p) => ((p.icons.skill ??= {})['testmod:ghost'] = 'anvil'))],
      'testmod',
      /icon skill "testmod:ghost" names no entity of that kind/,
    );
    throwsFor(
      [corePack, tm((p) => (p.icons['widget'] = { 'testmod:forge': 'anvil' }))],
      'testmod',
      /icon widget "testmod:forge" names no entity/,
    );
  });

  it('gives every icon of the composed database an icon name that exists in game-icons', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const collection = JSON.parse(
      readFileSync(
        createRequire(import.meta.url).resolve('@iconify-json/game-icons/icons.json'),
        'utf8',
      ),
    ) as { icons: Record<string, unknown>; aliases?: Record<string, unknown> };
    for (const [kind, table] of Object.entries(both.icons))
      for (const [id, name] of Object.entries(table))
        expect(
          Object.hasOwn(collection.icons, name) || Object.hasOwn(collection.aliases ?? {}, name),
          `${kind} ${id}: ${name}`,
        ).toBe(true);
  });

  it('keeps the player ranks in tier order and the AI tiers within them', () => {
    // The tier of a rank is its position, whatever number the pack gives.
    const odd = composeContent([corePack, tm((p) => (p.data.playerRanks![0]!.tier = 99))]);
    expect(odd.playerRanks.map((r) => [r.id, r.tier])).toContainEqual(['testmod:adept', 3]);
    // Two packs that each add a rank compose; ranks go behind the rank they name, ties by load order.
    const rankPack = (id: string, after?: string) =>
      mod(id, { data: { playerRanks: [{ id: `${id}:r`, tier: 0, ...(after ? { after } : {}) }] } });
    const both = composeContent([corePack, rankPack('aaa'), rankPack('bbb')]);
    expect(both.playerRanks.map((r) => r.id)).toEqual([
      'student',
      'genin',
      'chunin',
      'aaa:r',
      'bbb:r',
    ]);
    const placed = composeContent([
      corePack,
      rankPack('aaa'),
      rankPack('bbb', 'genin'),
      rankPack('ccc', 'genin'),
    ]);
    expect(placed.playerRanks.map((r) => [r.id, r.tier])).toEqual([
      ['student', 0],
      ['genin', 1],
      ['bbb:r', 2],
      ['ccc:r', 3],
      ['chunin', 4],
      ['aaa:r', 5],
    ]);
    throwsFor([corePack, rankPack('zzz', 'nobody')], 'zzz', /comes after "nobody"/);
    const lateAi = mod('lateai', {
      data: {
        ai: {
          visibleTraits: [],
          tiers: [
            {
              id: 'lateai:t',
              minTier: 9,
              rules: ['basic'],
              waitMs: 800,
              tactical: false,
            },
          ],
        },
      },
    });
    throwsFor([corePack, lateAi], 'lateai', /ai "lateai:t" field minTier/);
  });

  it('keeps the repeat share of a bounty between 0 and 1', () => {
    throwsFor(
      [corePack, tm((p) => (p.data.bosses![0]!.bounty.repeatShare = 5))],
      'testmod',
      /bosses: \d+\.bounty\.repeatShare/,
    );
  });

  it('requires ryoPerMin for a mission rank, and defaults reputation and rate cap to none', () => {
    throwsFor(
      [corePack, tm((p) => delete K(p).ryoPerMin)],
      'testmod',
      /missionRanks "testmod:trial" field ryoPerMin/,
    );
    const optional = tm((p) => {
      delete K(p).repPerMission;
      delete K(p).missionRateCap;
    });
    const db = composeContent([corePack, optional]);
    expect(db.balance.K.repPerMission['testmod:trial']).toBeUndefined();
    // The core rank OP has no rate cap or reputation entry either (V has both): the default is none.
    expect(db.balance.K.missionRateCap['OP']).toBeUndefined();
    expect(db.balance.K.repPerMission['OP']).toBeUndefined();
  });

  it('exercises the test pack: its rank, status and village stage are referenced and checked', () => {
    throwsFor(
      [corePack, tm((p) => (p.data.missions![0]!.unlock.rank = 'testmod:ghost'))],
      'testmod',
      /missions "testmod:test_run" field unlock.rank/,
    );
    throwsFor(
      [
        corePack,
        tm(
          (p) =>
            (p.data.items!.find((i: { id: string }) => i.id === 'testmod:elixir')!.fx.statuses = [
              'testmod:ghost',
            ]),
        ),
      ],
      'testmod',
      /items "testmod:elixir" field fx.statuses\[0\]/,
    );
    throwsFor(
      [corePack, tm((p) => (p.data.villageStages![0]!.rep = 'testmod:nothing'))],
      'testmod',
      /villageStages "testmod:stage3" field rep/,
    );
  });
});

describe('errors name the pack that caused them', () => {
  it('names the patching pack when a patch makes a core entity invalid', () => {
    const bad = mod('patcher', {
      patches: [{ target: { kind: 'enemies', id: 'core:wolf' }, set: { hp: 'abc' } }],
    });
    throwsFor([corePack, bad], 'patcher', /after composing and patching: enemies/);
    const unknown = mod('patcher2', {
      patches: [{ target: { kind: 'enemies', id: 'core:wolf' }, set: { nope: 1 } }],
    });
    throwsFor([corePack, unknown], 'patcher2', /after composing and patching/);
  });

  it('names the pack that adds an unknown visible trait', () => {
    const bad = mod('traitor', {
      data: { ai: { visibleTraits: ['traitor:ghost'], tiers: [tier('traitor')] } },
    });
    throwsFor([corePack, bad], 'traitor', /"traitor:ghost" is not a known traits/);
  });

  it('refuses a declared modifier key that a skill family already produces', () => {
    // A pack other than core cannot declare such a key (it must start with its own prefix), so the
    // invariant is exercised with a core whose declarations clash with its own skill families.
    const clash = {
      ...corePack,
      modifierKeys: {
        ...corePack.modifierKeys,
        'xp.skill.tai': { desc: 'A key that a family produces', flat: false, wired: false },
      },
    };
    throwsFor([clash], 'core', /modifier key "xp.skill.tai" is already defined by pack "core"/);
  });

  it('copies the modifier keys of a pack instead of sharing them', () => {
    const key = both.modifierKeys['testmod:forge.bonus'];
    expect(key).toBeDefined();
    expect(key).not.toBe(testmodPack.modifierKeys?.['testmod:forge.bonus']);
  });
});

describe('a malformed pack is named, not thrown as a TypeError', () => {
  const broken = (change: (p: Record<string, unknown>) => void, name = 'broken'): ContentPack => {
    const pack = JSON.parse(JSON.stringify(mod(name))) as Record<string, unknown>;
    change(pack);
    return pack as unknown as ContentPack;
  };

  it('names the pack for null, missing or wrongly typed fields', () => {
    for (const field of ['data', 'balance', 'locales', 'icons', 'patches'])
      throwsFor([corePack, broken((p) => (p[field] = null))], 'broken', /malformed pack/);
    throwsFor([corePack, broken((p) => (p.locales = 5))], 'broken', /malformed pack/);
    throwsFor([corePack, broken((p) => (p.patches = [null]))], 'broken', /malformed pack/);
    throwsFor([corePack, broken((p) => (p.patches = [{}]))], 'broken', /malformed pack/);
    throwsFor([corePack, broken((p) => (p.extra = 1))], 'broken', /malformed pack/);
  });

  it('names the pack by its position when its id cannot be read', () => {
    throwsFor([corePack, broken((p) => delete p.manifest)], '#1', /malformed pack/);
    throwsFor([corePack, broken((p) => (p.manifest = null))], '#1', /malformed pack/);
    throwsFor([corePack, null as unknown as ContentPack], '#1', /must be an object/);
  });

  it('does not throw an unnamed error for a patch value that JSON cannot carry', () => {
    const pack = mod('undef', {
      patches: [{ target: { kind: 'enemies', id: 'core:wolf' }, set: { cl: undefined } }],
    });
    throwsFor([corePack, pack], 'undef', /after composing and patching|malformed/);
  });

  it('rejects pack ids that are member names of Object', () => {
    for (const id of ['constructor', 'prototype'])
      throwsFor([corePack, mod(id)], id, /member name of Object/);
  });
});

describe('balance patches', () => {
  const patch = (id: string, path: string, set: unknown): ContentPack =>
    mod(id, { patches: [{ balance: { path, set } } as never] });

  it('replaces an existing leaf in load order', () => {
    const db = composeContent([corePack, patch('tweaker', 'K.power.E', 12)]);
    expect(db.balance.K.power['E']).toBe(12);
    expect(corePack.balance.K).toBeDefined();
    expect(composeContent([corePack]).balance.K.power['E']).toBe(10);
  });

  it('refuses a missing path, an object, a clash and a bad value, naming the pack', () => {
    throwsFor([corePack, patch('tweaker', 'K.nothing.here', 1)], 'tweaker', /does not exist/);
    throwsFor([corePack, patch('tweaker', 'K.power', 1)], 'tweaker', /is not a leaf/);
    throwsFor(
      [corePack, patch('tweak_a', 'K.power.E', 11), patch('tweak_b', 'K.power.E', 12)],
      'tweak_b',
      /already set by another pack/,
    );
    throwsFor([corePack, patch('tweaker', 'K.power.E', 'abc')], 'tweaker', /after composing/);
    throwsFor([corePack, patch('tweaker', 'K.__proto__.x', 1)], 'tweaker', /does not exist/);
  });
});

describe('the closure validator scans every list of the database', () => {
  it('finds an unknown modifier key in an extra field of the first entity of each list', () => {
    const lists = Object.entries(both).filter(
      ([k, v]) =>
        !['balance', 'packs', 'modifierKeys', 'icons', 'locales'].includes(k) &&
        typeof v === 'object',
    );
    expect(lists.length).toBeGreaterThan(40);
    for (const [list, value] of lists) {
      const copy = JSON.parse(JSON.stringify(both)) as Record<string, unknown>;
      const target = copy[list] as Record<string, unknown>;
      const holder: Record<string, unknown> = Array.isArray(target)
        ? (target[0] as Record<string, unknown>)
        : target;
      if (typeof holder !== 'object' || holder === null) continue;
      holder.zz = { key: 'made.up', op: 'add', value: 1 };
      const problems = validateClosure(copy as unknown as typeof both, {
        owner: () => 'testmod',
        iconOwner: () => 'testmod',
        described: {},
      });
      expect(
        problems.some((p) => p.message.includes('unknown modifier key "made.up"')),
        `${list} is not scanned`,
      ).toBe(true);
      void value;
    }
  });
});

describe('patch rules', () => {
  it('lets two packs append to one list', () => {
    const wolf = (id: string, item: string) =>
      mod(id, {
        patches: [
          {
            target: { kind: 'enemies', id: 'core:wolf' },
            append: { drops: [{ item, chance: 0.01 }] },
          },
        ],
      });
    const db = composeContent([corePack, wolf('app_a', 'core:pelt'), wolf('app_b', 'core:fang')]);
    const drops = db.enemies.find((e) => e.id === 'core:wolf')?.drops ?? [];
    expect(drops.slice(-2).map((d) => d.item)).toEqual(['core:pelt', 'core:fang']);
  });
});

describe('closure of the fields packs added in the review fixes', () => {
  it('refuses an unknown skill on an exercise, a practice and a herb', () => {
    throwsFor(
      [
        corePack,
        mod('xx', { data: { exercises: [{ id: 'xx:e', level: 1, skill: 'xx:nothing' }] } }),
      ],
      'xx',
      /skill/,
    );
    throwsFor(
      [
        corePack,
        mod('yy', { data: { herbs: [{ id: 'yy:h', level: 1, skill: 'yy:nothing', req: null }] } }),
      ],
      'yy',
      /skill/,
    );
  });

  it('refuses an unknown currency in a mission payment, a cache and a stage cap above the top level', () => {
    const cell = (extra: Record<string, unknown>) => ({
      regions: [{ id: 'zz:r', scout: 1, cells: ['zz:c'] }],
      cells: [
        {
          id: 'zz:c',
          region: 'zz:r',
          index: 0,
          key: null,
          story: false,
          pois: [{ id: 'zz:p', kind: 'cache', items: [], ryo: 0, ...extra }],
        },
      ],
    });
    throwsFor(
      [corePack, mod('zz', { data: cell({ currencies: { 'zz:nothing': 1 } }) })],
      'zz',
      /currenc/,
    );
    throwsFor(
      [corePack, mod('cap', { data: { villageStages: [{ id: 'cap:s', rep: null, cap: 99 }] } })],
      'cap',
      /cap/,
    );
  });

  it('says cycle for ranks that wait for each other', () => {
    const ranked = (id: string, after: string) =>
      mod(id, { data: { playerRanks: [{ id: `${id}:r`, tier: 0, after }] } });
    throwsFor([corePack, ranked('aa', 'bb:r'), ranked('bb', 'aa:r')], 'aa', /cycle/);
  });
});

describe('a defensive technique of a pack needs a row of K.passiveFx', () => {
  const veil = (p: Loose, fx: string) => {
    const tech = (p.data.techniques as { id: string; combat: { passive: { fx: string } } }[]).find(
      (t) => t.id === 'testmod:glass_veil',
    );
    if (!tech) throw new Error('no glass_veil');
    tech.combat.passive.fx = fx;
  };

  it('is rejected, naming the pack and the key, when the key has no row (a typo)', () => {
    throwsFor(
      [corePack, tm((p) => veil(p, 'testmod:vail'))],
      'testmod',
      /glass_veil.*combat.passive.fx.*passiveFx.testmod:vail.evasion is missing/,
    );
  });

  it('is rejected for a key that is a prototype property, not a row', () => {
    throwsFor([corePack, tm((p) => veil(p, 'constructor'))], 'testmod', /passiveFx.constructor/);
  });

  it('passes for the real key', () => {
    expect(() => composeContent([corePack, tm((p) => veil(p, 'testmod:veil'))])).not.toThrow();
  });
});
