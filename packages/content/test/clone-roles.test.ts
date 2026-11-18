/** The roles of the combat clones: data that passes the schema, has its texts and is closed over, and mods may add rows. */
import { describe, expect, it } from 'vitest';
import { composeContent, content, corePack, ukLocale } from '../src/index.ts';
import { testmodPack } from '../src/packs/testmod/index.ts';
import { descProblems } from './helpers.ts';
import { mod, throwsFor } from './pack-helpers.ts';

const CORE_ROLES = [
  'core:role_mirror',
  'core:role_assault',
  'core:role_support',
  'core:role_distract',
];

describe('clone roles of the core pack', () => {
  it('are the four roles, with the mirror as the only default', () => {
    expect(content.cloneRoles.map((r) => r.id)).toEqual(CORE_ROLES);
    expect(content.cloneRoles.filter((r) => r.default === true).map((r) => r.id)).toEqual([
      'core:role_mirror',
    ]);
    expect(content.cloneRoles[0]?.hand).toEqual({ mode: 'copy' });
    expect(content.cloneRoles[0]?.threat).toBe(1);
  });

  it('carry a name and a plain description in Ukrainian', () => {
    for (const r of content.cloneRoles) {
      expect(ukLocale[`cloneRole.${r.id}.name`], `${r.id} name`).toBeTruthy();
      expect(descProblems(ukLocale[`cloneRole.${r.id}.desc`]), `${r.id} desc`).toEqual([]);
    }
  });

  it('draw their numbers from data: distraction draws the enemies, the others do not', () => {
    const by = Object.fromEntries(content.cloneRoles.map((r) => [r.id, r]));
    expect(by['core:role_distract']?.threat).toBeGreaterThan(1);
    expect(by['core:role_assault']?.threat).toBe(1);
  });
});

describe('clone roles of packs', () => {
  it('a mod adds a role of its own, with its texts', () => {
    const db = composeContent([corePack, testmodPack]);
    expect(db.cloneRoles.map((r) => r.id)).toContain('testmod:role_decoy');
    expect(db.locales.uk['cloneRole.testmod:role_decoy.name']).toBeTruthy();
  });

  it('refuses a second default role, naming the pack', () => {
    const rival = mod('rival', {
      data: {
        cloneRoles: [{ id: 'rival:role', default: true, threat: 1, hand: { mode: 'copy' } }],
      },
      locales: {
        uk: { 'cloneRole.rival:role.name': 'Інша', 'cloneRole.rival:role.desc': 'Опис.' },
      },
    });
    throwsFor([corePack, rival], 'rival', /second default clone role/);
  });

  it('refuses a role that is not in the pack namespace or breaks the schema', () => {
    const bare = mod('rival', {
      data: { cloneRoles: [{ id: 'core:role_x', threat: 1, hand: { mode: 'copy' } }] },
    });
    throwsFor([corePack, bare], 'rival', /./);
    const broken = mod('rival', {
      data: {
        cloneRoles: [
          {
            id: 'rival:role',
            threat: 0,
            hand: { mode: 'pick', size: 0, weights: { damage: 1, status: 0, opens: 0, cheap: 0 } },
          },
        ],
      },
    });
    throwsFor([corePack, broken], 'rival', /./);
  });

  it('refuses a role without its name and description', () => {
    const silent = mod('rival', {
      data: { cloneRoles: [{ id: 'rival:role', threat: 1, hand: { mode: 'copy' } }] },
    });
    throwsFor([corePack, silent], 'rival', /locale/);
  });
});
