/**
 * Pack data is untrusted, and the closure validator checks more than references: modifier keys,
 * icons, tiers, ranges. Each case mutates the test pack or builds a small pack and expects the
 * composer to name the pack at fault.
 */
import { describe, expect, it } from 'vitest';
import { testmodPack } from '@shinobi/content/testmod';
import { composeContent, corePack, type ContentPack } from '../src/index.ts';
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
  defends: 'all',
  reaction: false,
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
    throwsFor(
      [corePack, tm((p) => (p.data.playerRanks![0]!.tier = 99))],
      'testmod',
      /playerRanks "testmod:adept" field tier: 99 must be the position 3/,
    );
    const lateAi = mod('lateai', {
      data: {
        ai: {
          visibleTraits: [],
          tiers: [
            {
              id: 'lateai:t',
              minTier: 9,
              rules: ['basic'],
              defends: 'all',
              reaction: false,
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
      /bosses/,
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
    // The core ranks V and OP have no rate cap or reputation entry either: the default is none.
    expect(db.balance.K.missionRateCap['OP']).toBeUndefined();
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

  it('names the pack whose modifier key clashes with a skill family key', () => {
    const skill = mod('famclash', {
      data: {
        skills: [{ id: 'famclash:s', group: 'craft', activity: 'none', unlockReq: null }],
      },
      locales: {
        uk: {
          'skill.famclash:s.name': 'x',
          'skill.famclash:s.desc': 'y',
        },
      },
      modifierKeys: {
        'famclash:a': { desc: 'A key of a test pack', flat: false, wired: false },
      },
    });
    expect(() => composeContent([corePack, skill])).not.toThrow();
  });

  it('copies the modifier keys of a pack instead of sharing them', () => {
    const key = both.modifierKeys['testmod:forge.bonus'];
    expect(key).toBeDefined();
    expect(key).not.toBe(testmodPack.modifierKeys?.['testmod:forge.bonus']);
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
