/** Content packs: composition of `core` with `testmod`, load order, and every error the composer reports. */
import { describe, expect, it } from 'vitest';
import { composeContent, corePack, type ContentPack, type PackData } from '../src/index.ts';
import { testmodPack } from '@shinobi/content/testmod';
import { descProblems } from './helpers.ts';

const both = composeContent([corePack, testmodPack]);
const coreOnly = composeContent([corePack]);

/** A pack with the given manifest and data on top of an empty body. */
const mod = (
  id: string,
  extra: Omit<Partial<ContentPack>, 'data'> & { data?: Record<string, unknown> } = {},
): ContentPack => ({
  manifest: { id, version: '1', dependsOn: ['core'], loadAfter: [] },
  balance: {},
  locales: { uk: {} },
  icons: {},
  patches: [],
  ...extra,
  data: (extra.data ?? {}) as unknown as PackData,
});

const throwsFor = (packs: ContentPack[], pack: string, message: RegExp | string) => {
  let error: Error | undefined;
  try {
    composeContent(packs);
  } catch (e) {
    error = e as Error;
  }
  expect(error, 'composeContent should throw').toBeDefined();
  expect(error?.message).toContain(pack);
  expect(error?.message).toMatch(message);
};

describe('composeContent([core, testmod])', () => {
  it('passes the closure and description validators and lists the manifests in load order', () => {
    expect(both.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
    expect(coreOnly.packs.map((p) => p.id)).toEqual(['core']);
  });

  it('contains one entity of every kind the test pack adds', () => {
    const has = (list: { id: string }[], id: string) => list.some((e) => e.id === id);
    expect(has(both.skills, 'testmod:forge')).toBe(true);
    expect(has(both.natures, 'testmod:aether')).toBe(true);
    expect(has(both.playerRanks, 'testmod:adept')).toBe(true);
    expect(has(both.missionRanks, 'testmod:trial')).toBe(true);
    expect(has(both.currencies, 'testmod:token')).toBe(true);
    expect(has(both.villageStages, 'testmod:stage3')).toBe(true);
    expect(has(both.traits, 'testmod:shelled')).toBe(true);
    expect(has(both.statuses, 'testmod:chill')).toBe(true);
    expect(has(both.combos, 'testmod:frostburn')).toBe(true);
    expect(has(both.tags, 'testmod:crack')).toBe(true);
    expect(has(both.roles, 'testmod:sapper')).toBe(true);
    expect(has(both.techniques, 'testmod:ember_pulse')).toBe(true);
    expect(has(both.seals, 'testmod:glyph')).toBe(true);
    expect(has(both.items, 'testmod:charm')).toBe(true);
    expect(has(both.recipes, 'testmod:elixir_brew')).toBe(true);
    expect(has(both.gear, 'testmod:anvil')).toBe(true);
    expect(has(both.enemies, 'testmod:shellback')).toBe(true);
    expect(has(both.bosses, 'testmod:boss_shell')).toBe(true);
    expect(has(both.regions, 'testmod:grove')).toBe(true);
    expect(has(both.cells, 'testmod:grove_edge')).toBe(true);
    expect(has(both.buildings, 'testmod:hut')).toBe(true);
    expect(has(both.missions, 'testmod:test_run')).toBe(true);
    expect(has(both.quests, 'testmod:test_chain')).toBe(true);
    expect(both.icons.skill?.['testmod:forge']).toBe('anvil');
    expect(both.modifierKeys['testmod:forge.bonus']).toBeDefined();
    expect(both.modifierKeys['xp.skill.testmod:forge']).toBeDefined();
    expect(both.balance.K.ext?.testmod?.shellArmor).toBe(0.2);
    expect(both.balance.K.ryoPerMin['testmod:trial' as 'D']).toBe(5);
  });

  it('applies the patch to the core enemy and leaves the core pack alone', () => {
    const wolf = both.enemies.find((e) => e.id === 'core:wolf');
    expect(wolf?.drops.map((d) => d.item)).toContain('testmod:pellet');
    const plain = coreOnly.enemies.find((e) => e.id === 'core:wolf');
    expect(plain?.drops.map((d) => d.item)).not.toContain('testmod:pellet');
  });

  it('gives every test entity a name and a plain Ukrainian description', () => {
    const kinds: [string, { id: string }[]][] = [
      ['skill', both.skills],
      ['technique', both.techniques],
      ['seal', both.seals],
      ['item', both.items],
      ['enemy', both.enemies],
      ['boss', both.bosses],
      ['building', both.buildings],
      ['region', both.regions],
      ['status', both.statuses],
      ['trait', both.traits],
      ['combo', both.combos],
    ];
    for (const [kind, list] of kinds)
      for (const e of list.filter((x) => x.id.startsWith('testmod:'))) {
        expect(descProblems(both.locales.uk[`${kind}.${e.id}.desc`]), `${kind} ${e.id}`).toEqual(
          [],
        );
        expect(both.locales.uk[`${kind}.${e.id}.name`], `${kind} ${e.id}`).toBeTruthy();
      }
  });

  it('keeps every core entity as it is in the core-only database', () => {
    for (const list of ['skills', 'techniques', 'items', 'bosses', 'missions'] as const)
      for (const e of coreOnly[list])
        expect(
          both[list].find((x) => x.id === e.id),
          `${list} ${e.id}`,
        ).toEqual(e);
  });

  it('does not depend on the order of the input array', () => {
    const swapped = composeContent([testmodPack, corePack]);
    expect(swapped).toEqual(both);
    expect(swapped.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
  });

  it('breaks ties between packs by pack id and honours loadAfter', () => {
    const a = mod('aaa');
    const z = mod('zzz', {
      manifest: { id: 'zzz', version: '1', dependsOn: ['core'], loadAfter: ['aaa'] },
    });
    const m = mod('mmm');
    expect(composeContent([z, m, a, corePack]).packs.map((p) => p.id)).toEqual([
      'core',
      'aaa',
      'mmm',
      'zzz',
    ]);
    const first = mod('b_first', {
      manifest: { id: 'b_first', version: '1', dependsOn: ['core'], loadAfter: ['a_last'] },
    });
    expect(composeContent([first, mod('a_last'), corePack]).packs.map((p) => p.id)).toEqual([
      'core',
      'a_last',
      'b_first',
    ]);
  });
});

describe('composeContent([core])', () => {
  it('contains no testmod id, text, key or icon', () => {
    expect(JSON.stringify(coreOnly)).not.toContain('testmod');
  });
});

describe('composeContent errors name the pack', () => {
  it('reports a missing dependency', () => {
    throwsFor(
      [
        corePack,
        mod('lonely', {
          manifest: { id: 'lonely', version: '1', dependsOn: ['ghost'], loadAfter: [] },
        }),
      ],
      'lonely',
      /depends on "ghost"/,
    );
  });

  it('reports a dependency cycle', () => {
    const a = mod('cyc_a', {
      manifest: { id: 'cyc_a', version: '1', dependsOn: ['cyc_b'], loadAfter: [] },
    });
    const b = mod('cyc_b', {
      manifest: { id: 'cyc_b', version: '1', dependsOn: ['cyc_a'], loadAfter: [] },
    });
    throwsFor([corePack, a, b], 'cyc_a', /cycle/);
  });

  it('reports a duplicate pack id', () => {
    throwsFor([corePack, corePack], 'core', /duplicate pack id/);
    throwsFor([corePack, mod('twin'), mod('twin')], 'twin', /duplicate pack id/);
  });

  it('reports an id outside the pack namespace', () => {
    const bad = mod('badns', { data: { tags: [{ id: 'other:thing' }] } });
    throwsFor([corePack, bad], 'badns', /outside the pack namespace/);
    const bare = mod('barens', { data: { tags: [{ id: 'bare' }] } });
    throwsFor([corePack, bare], 'barens', /outside the pack namespace/);
    const stealing = mod('thief', { data: { tags: [{ id: 'core:thing' }] } });
    throwsFor([corePack, stealing], 'thief', /outside the pack namespace/);
  });

  it('reports a duplicate entity id and refuses a silent overwrite of a core entity', () => {
    const dup = mod('dupmod', { data: { tags: [{ id: 'dupmod:x' }, { id: 'dupmod:x' }] } });
    throwsFor([corePack, dup], 'dupmod', /duplicate tags "dupmod:x"/);
    const clash = mod('clasher', { data: { items: [{ ...both.items[0], id: 'core:mint' }] } });
    throwsFor([corePack, clash], 'clasher', /outside the pack namespace/);
    const twoPacks = [corePack, mod('one', { data: { tags: [{ id: 'one:t' }] } })];
    const two = mod('one_b', { data: { tags: [{ id: 'one:t' }] } });
    throwsFor([...twoPacks, two], 'one_b', /outside the pack namespace/);
  });

  it('reports a dangling reference with the entity and the field', () => {
    const dangling = mod('dangler', {
      data: {
        traits: [
          {
            id: 'dangler:t',
            answer: 'dangler:nothing',
            numbers: { from: 'trait', keys: ['armor'] },
          },
        ],
      },
      locales: { uk: { 'trait.dangler:t.name': 'x', 'trait.dangler:t.desc': 'y' } },
    });
    throwsFor(
      [corePack, dangling],
      'dangler',
      /traits "dangler:t" field answer: "dangler:nothing" is not a known tags/,
    );
  });

  it('reports a vocabulary member that lacks its balance number', () => {
    const role = mod('norole', { data: { roles: [{ id: 'norole:r' }] } });
    throwsFor(
      [corePack, role],
      'norole',
      /roles "norole:r" field role: balance K.role.norole:r is missing/,
    );
  });

  it('reports a missing name or description locale key', () => {
    const noText = mod('notext', { data: { statuses: [{ id: 'notext:s' }] } });
    throwsFor([corePack, noText], 'notext', /missing locale key status.notext:s.name/);
  });

  it('reports a clashing locale key and a clashing icon', () => {
    const loc = mod('locclash', { locales: { uk: { 'rank.genin': 'Інший' } } });
    throwsFor([corePack, loc], 'locclash', /locale key "rank.genin".*"core"/);
    const icon = mod('iconclash', { icons: { skill: { tai: 'anvil' } } });
    throwsFor([corePack, icon], 'iconclash', /icon skill "tai".*"core"/);
  });

  it('reports a modifier key that no pack declares', () => {
    const bad = mod('badkey', {
      data: {
        buildings: [
          {
            id: 'badkey:b',
            tier6: null,
            role: 'bonus',
            effects: [{ key: 'made.up', op: 'add', value: 1 }],
            capstone: [],
            produces: [],
          },
        ],
      },
      locales: { uk: { 'building.badkey:b.name': 'x', 'building.badkey:b.desc': 'y' } },
    });
    throwsFor([corePack, bad], 'badkey', /unknown modifier key "made.up"/);
    const undeclared = mod('badkey2', {
      modifierKeys: { 'plain.key': { desc: 'A key without a prefix', flat: false, wired: false } },
    });
    throwsFor([corePack, undeclared], 'badkey2', /must start with "badkey2:"/);
  });

  it('reports a balance number that two packs both set, and a key outside the namespace', () => {
    const clash = mod('balclash', { balance: { K: { cap: 99 } } });
    throwsFor([corePack, clash], 'balclash', /balance "K.cap" is already set by pack "core"/);
    const stray = mod('balstray', { balance: { K: { brandNew: 1 } } });
    throwsFor([corePack, stray], 'balstray', /not in the pack namespace/);
    const ext = mod('balext', { balance: { K: { ext: { other: { x: 1 } } } } });
    throwsFor([corePack, ext], 'balext', /not in the pack namespace/);
    const first = mod('first_setter', { balance: { K: { ext: { first_setter: { x: 1 } } } } });
    const second = mod('second_setter', { balance: { K: { ext: { first_setter: { x: 2 } } } } });
    throwsFor([corePack, first, second], 'second_setter', /not in the pack namespace|already set/);
  });

  it('reports a patch to a missing entity and two patches to one field', () => {
    const missing = mod('patchy', {
      patches: [{ target: { kind: 'enemies', id: 'core:nobody' }, set: { cl: 1 } }],
    });
    throwsFor(
      [corePack, missing],
      'patchy',
      /patch targets enemies "core:nobody", which does not exist/,
    );
    const p1 = mod('p_one', {
      patches: [{ target: { kind: 'enemies', id: 'core:wolf' }, set: { cl: 11 } }],
    });
    const p2 = mod('p_two', {
      patches: [{ target: { kind: 'enemies', id: 'core:wolf' }, set: { cl: 12 } }],
    });
    throwsFor([corePack, p1, p2], 'p_two', /already patched by another pack/);
    const notList = mod('p_list', {
      patches: [{ target: { kind: 'enemies', id: 'core:wolf' }, append: { cl: [1] } }],
    });
    throwsFor([corePack, notList], 'p_list', /not a list/);
  });

  it('reports data that does not fit the schema', () => {
    const bad = mod('badshape', { data: { tags: [{ id: 'badshape:t', extra: 1 }] } });
    throwsFor([corePack, bad], 'badshape', /tags/);
    const unknown = mod('unknownlist', { data: { widgets: [] } });
    throwsFor([corePack, unknown], 'unknownlist', /unknown data list "widgets"/);
  });
});
