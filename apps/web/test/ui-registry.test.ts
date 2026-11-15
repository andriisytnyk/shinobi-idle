import { describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { createRegistry, UiPackError } from '../src/lib/ext/registry.ts';
import { isSlotName, SLOT_NAMES } from '../src/lib/ext/slots.ts';
import type { UiPack, UiRegistrar } from '../src/lib/ext/types.ts';
import { testmodUi } from './fixtures/testmod-ui.ts';

const pack = (id: string, setup: (ui: UiRegistrar) => void): UiPack => ({ id, setup });
const noop = () => {};
const page = (id: string, route: string) => ({ id, route, title: 'x', mount: noop });

/** The message of the error a registration throws. */
function failure(packs: UiPack[]): string {
  try {
    createRegistry(packs);
  } catch (error) {
    expect(error).toBeInstanceOf(UiPackError);
    return (error as Error).message;
  }
  throw new Error('expected the registration to be rejected');
}

describe('registration rules (A6)', () => {
  it('rejects duplicate ids and names the pack', () => {
    expect(
      failure([
        pack(
          'dup',
          (ui) => ui.addPage(page('p', '#/x/dup/p')) ?? ui.addPage(page('p', '#/x/dup/q')),
        ),
      ]),
    ).toMatch(/UI pack "dup".*duplicate page "dup:p"/);
    expect(
      failure([
        pack('dup', (ui) => {
          ui.addWidget('topbar', noop, { id: 'w' });
          ui.addWidget('settings', noop, { id: 'w' });
        }),
      ]),
    ).toMatch(/UI pack "dup".*duplicate widget "dup:w"/);
    const nav = {
      group: 'side',
      title: 'x',
      icon: 'lucide:map',
      route: '#/x/dup/p',
      order: 1,
    } as const;
    expect(
      failure([
        pack('dup', (ui) => {
          ui.addNavItem({ id: 'n', ...nav });
          ui.addNavItem({ id: 'n', ...nav });
        }),
      ]),
    ).toMatch(/UI pack "dup".*duplicate nav "dup:n"/);
    expect(
      failure([
        pack('dup', (ui) => {
          ui.addTheme({ id: 't', name: 'x', tokens: {} });
          ui.addTheme({ id: 't', name: 'x', tokens: {} });
        }),
      ]),
    ).toMatch(/UI pack "dup".*duplicate theme/);
    expect(failure([{ id: 'same' }, { id: 'same' }])).toMatch(/UI pack "same".*twice/);
  });

  it('keeps packs from colliding: the same local id in two packs is fine', () => {
    const registry = createRegistry([
      pack('a', (ui) => ui.addWidget('topbar', noop, { id: 'w' })),
      pack('b', (ui) => ui.addWidget('topbar', noop, { id: 'w' })),
    ]);
    expect(registry.widgets('topbar').map((w) => w.key)).toEqual(['a:w', 'b:w']);
  });

  it('rejects a locale key outside x.<packId>.', () => {
    expect(failure([pack('mod', (ui) => ui.addLocale('uk', { 'nav.skills': 'підміна' }))])).toMatch(
      /UI pack "mod".*"nav.skills".*x\.mod\./,
    );
    expect(failure([pack('mod', (ui) => ui.addLocale('uk', { 'x.other.key': 'a' }))])).toMatch(
      /UI pack "mod"/,
    );
    const ok = createRegistry([pack('mod', (ui) => ui.addLocale('uk', { 'x.mod.key': 'a' }))]);
    expect(ok.messages['x.mod.key']).toBe('a');
  });

  it('rejects a page route outside #/x/<packId>/ for packs other than core', () => {
    expect(failure([pack('mod', (ui) => ui.addPage(page('p', '#/skills')))])).toMatch(
      /UI pack "mod".*#\/x\/mod\//,
    );
    expect(failure([pack('mod', (ui) => ui.addPage(page('p', '#/x/other/p')))])).toMatch(
      /UI pack "mod"/,
    );
    expect(failure([pack('mod', (ui) => ui.addPage(page('p', 'x/mod/p')))])).toMatch(
      /UI pack "mod"/,
    );
    expect(() =>
      createRegistry([pack('mod', (ui) => ui.addPage(page('p', '#/x/mod/p/:id')))]),
    ).not.toThrow();
    expect(() => createRegistry([coreUi])).not.toThrow();
  });

  it('rejects unknown slots, bad settings and tokens that are not variables', () => {
    expect(failure([pack('mod', (ui) => ui.addWidget('nowhere' as never, noop))])).toMatch(
      /UI pack "mod".*slot/,
    );
    expect(
      failure([
        pack('mod', (ui) => ui.addSetting({ id: 's', title: 'x', kind: 'toggle', default: 'yes' })),
      ]),
    ).toMatch(/UI pack "mod"/);
    expect(
      failure([
        pack('mod', (ui) =>
          ui.addSetting({
            id: 's',
            title: 'x',
            kind: 'select',
            options: [{ value: 'a', label: 'x' }],
            default: 'b',
          }),
        ),
      ]),
    ).toMatch(/UI pack "mod"/);
    expect(
      failure([
        pack('mod', (ui) => ui.addTheme({ id: 't', name: 'x', tokens: { accent: 'red' } })),
      ]),
    ).toMatch(/UI pack "mod".*CSS variable/);
    expect(failure([pack('Bad-Id', () => {})])).toMatch(/UI pack "Bad-Id"/);
    expect(failure([pack('mod', (ui) => ui.addEntityLink({ kind: 'skill', title: 'x' }))])).toMatch(
      /UI pack "mod"/,
    );
  });

  it('rejects overrides of what does not exist, naming the pack', () => {
    const attempts: [string, (ui: UiRegistrar) => void][] = [
      ['replacePage', (ui) => ui.replacePage('core:nothing', noop)],
      ['wrapPage', (ui) => ui.wrapPage('core:nothing', noop)],
      ['removeNavItem', (ui) => ui.removeNavItem('core:nothing')],
      ['moveNavItem', (ui) => ui.moveNavItem('core:nothing', { order: 1 })],
      ['removeWidget', (ui) => ui.removeWidget('core:nothing')],
      ['reorderWidget', (ui) => ui.reorderWidget('core:nothing', 1)],
    ];
    for (const [name, attempt] of attempts) {
      expect(failure([coreUi, pack('mod', attempt)]), name).toMatch(
        new RegExp(`UI pack "mod".*${name}.*core:nothing`),
      );
    }
  });

  it('applies overrides: replace, remove, move, reorder', () => {
    const registry = createRegistry([
      coreUi,
      pack('one', (ui) => ui.addWidget('topbar', noop, { id: 'a', order: 10 })),
      pack('two', (ui) => {
        ui.addWidget('topbar', noop, { id: 'b', order: 20 });
        ui.moveNavItem('core:bank', { group: 'tab', tabOrder: 5 });
        ui.reorderWidget('one:a', 30);
        ui.removeNavItem('core:help');
      }),
    ]);
    expect(registry.widgets('topbar').map((w) => w.key)).toEqual(['two:b', 'one:a']);
    expect(registry.navItems.find((n) => n.key === 'core:bank')?.group).toBe('tab');
    expect(registry.isNavRemoved('core:help', () => ({}) as never)).toBe(true);
    expect(registry.isNavRemoved('core:bank', () => ({}) as never)).toBe(false);
    const gone = createRegistry([
      pack('one', (ui) => ui.addWidget('topbar', noop, { id: 'a' })),
      pack('two', (ui) => ui.removeWidget('one:a')),
    ]);
    expect(gone.widgets('topbar')).toEqual([]);
  });

  it('warns when a later pack replaces a page again, and the later one wins', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = vi.fn();
    const second = vi.fn();
    const registry = createRegistry([
      coreUi,
      pack('one', (ui) => ui.replacePage('core:help', first)),
      pack('two', (ui) => ui.replacePage('core:help', second)),
    ]);
    expect(registry.matchPage('#/help')?.page.mount).toBe(second);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"one"');
    expect(String(warn.mock.calls[0]?.[0])).toContain('"two"');
    warn.mockRestore();
  });
});

describe('the public lists', () => {
  it('names the slots, and the testmod fixture registers into real ones only', () => {
    expect(SLOT_NAMES).toEqual([
      'skill.header',
      'skill.footer',
      'action.tile',
      'now.bar',
      'goal.panel',
      'entity.sections',
      'sidebar.skill',
      'topbar',
      'settings',
      'village.header',
      'page.footer',
    ]);
    expect(SLOT_NAMES.every(isSlotName)).toBe(true);
    const registry = createRegistry([coreUi, testmodUi]);
    expect(registry.widgets('skill.header').map((w) => w.key)).toEqual(['testmod:figures']);
  });

  it('matches routes by specificity and decodes the parameters', () => {
    const registry = createRegistry([coreUi]);
    expect(registry.matchPage('#/shop/sell')?.page.key).toBe('core:shop.sell');
    expect(registry.matchPage('#/skill/tai')?.params).toEqual({ id: 'tai' });
    expect(registry.matchPage('#/technique/core:great_fireball')?.params.id).toBe(
      'core:great_fireball',
    );
    expect(registry.matchPage('#/enemy/core%3Adummy')?.params).toEqual({
      kind: 'enemy',
      id: 'core:dummy',
    });
    expect(registry.matchPage('#/bogus/x')).toBeNull();
    expect(registry.matchPage('#/skill/%E0%A4%A')).toBeNull();
    expect(registry.matchPage('')?.page.key).toBe('core:home');
  });
});
