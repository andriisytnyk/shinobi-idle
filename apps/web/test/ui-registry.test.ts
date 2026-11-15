import { describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { createRegistry } from '../src/lib/ext/registry.ts';
import { isSlotName, SLOT_NAMES } from '../src/lib/ext/slots.ts';
import type { UiPack, UiRegistrar } from '../src/lib/ext/types.ts';
import { testmodUi } from '../dev-packs/testmod-ui.ts';

const pack = (id: string, setup: (ui: UiRegistrar) => void): UiPack => ({ id, setup });
const noop = () => {};
const page = (id: string, route: string) => ({ id, route, title: 'x', mount: noop });

/** Why the last pack was switched off: a pack that breaks a rule is disabled, never thrown out of the boot. */
function failure(packs: UiPack[]): string {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const registry = createRegistry(packs);
    const message = registry.disabled.at(-1)?.message;
    if (message === undefined) throw new Error('expected the pack to be disabled');
    return message;
  } finally {
    warn.mockRestore();
  }
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
    expect(registry.navRemovals('core:help')).toHaveLength(1);
    expect(registry.navRemovals('core:bank')).toHaveLength(0);
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

describe('a pack that fails is switched off as a whole', () => {
  it('rolls back everything it registered, leaves the others alone, and does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = pack('good', (ui) => ui.addWidget('topbar', noop, { id: 'w' }));
    const bad = pack('bad', (ui) => {
      ui.addWidget('topbar', noop, { id: 'w' });
      ui.addPage(page('p', '#/x/bad/p'));
      ui.addLocale('uk', { 'x.bad.key': 'a' });
      ui.addSetting({ id: 's', title: 'x', kind: 'toggle', default: false });
      ui.addTheme({ id: 't', name: 'x', tokens: {} });
      ui.addStylesheet('a { }');
      ui.moveNavItem('core:bank', { order: 99 });
      ui.removeNavItem('core:help');
      ui.removeWidget('good:w');
      ui.reorderWidget('good:w', 1);
      ui.replacePage('core:help', noop);
      ui.wrapPage('core:help', noop);
      ui.removeNavItem('core:nope');
    });
    const registry = createRegistry([coreUi, good, bad]);
    expect(registry.disabled.map((d) => d.packId)).toEqual(['bad']);
    expect(registry.disabled[0]?.message).toMatch(/UI pack "bad".*removeNavItem.*core:nope/);
    expect(registry.packs).toEqual(['core', 'good']);
    expect(registry.widgets('topbar').map((w) => w.key)).toEqual(['good:w']);
    expect(registry.pages.some((p) => p.packId === 'bad')).toBe(false);
    expect(registry.matchPage('#/x/bad/p')).toBeNull();
    expect(registry.messages['x.bad.key']).toBeUndefined();
    expect(registry.settings).toEqual([]);
    expect(registry.themes.map((t) => t.key)).toEqual(['core:base']);
    expect(registry.stylesheets).toEqual([]);
    expect(registry.navItems.find((n) => n.key === 'core:bank')?.order).toBe(40);
    expect(registry.navRemovals('core:help')).toEqual([]);
    expect(registry.widgets('topbar')[0]?.order).toBe(100);
    const help = registry.pages.find((p) => p.key === 'core:help');
    expect(help?.wraps).toEqual([]);
    expect(help?.replacedBy).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('survives a pack that throws a plain error, a bad id and a repeated id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = createRegistry([
      coreUi,
      pack('boom', () => {
        throw new Error('kaput');
      }),
      pack('Bad Id', noop),
      pack('twice', noop),
      pack('twice', noop),
    ]);
    expect(registry.disabled.map((d) => d.packId)).toEqual(['boom', 'Bad Id', 'twice']);
    expect(registry.disabled[0]?.message).toBe('kaput');
    expect(registry.packs).toEqual(['core', 'twice']);
    warn.mockRestore();
  });

  it('lets the built-in pack stop the boot', () => {
    expect(() =>
      createRegistry([
        pack('core', () => {
          throw new Error('core is broken');
        }),
      ]),
    ).toThrow('core is broken');
  });

  it('warns with both pack ids for every kind of conflict; the later pack wins', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = createRegistry([
      coreUi,
      pack('one', (ui) => {
        ui.addWidget('topbar', noop, { id: 'w', order: 10 });
        ui.moveNavItem('core:bank', { order: 11 });
        ui.wrapPage('core:help', noop);
        ui.reorderWidget('one:w', 20);
      }),
      pack('two', (ui) => {
        ui.moveNavItem('core:bank', { order: 12 });
        ui.wrapPage('core:help', noop);
        ui.reorderWidget('one:w', 30);
      }),
    ]);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    for (const subject of ['nav item "core:bank"', 'page "core:help"', 'widget "one:w"']) {
      const line = lines.find((l) => l.includes(subject));
      expect(line, subject).toContain('"one"');
      expect(line, subject).toContain('"two"');
    }
    expect(registry.navItems.find((n) => n.key === 'core:bank')?.order).toBe(12);
    expect(registry.widgets('topbar')[0]?.order).toBe(30);
    expect(registry.pages.find((p) => p.key === 'core:help')?.wraps.map((w) => w.packId)).toEqual([
      'one',
      'two',
    ]);
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
