import type { NavEntry, UiRegistry } from './ext/registry.ts';
import { navTarget } from './next-step.ts';

/*
 * The main navigation is not listed here: the built-in game and every UI pack register their nav
 * items and pages in the UI registry. These helpers only read it.
 */

/** The items of the sidebar menu, in order. */
export const sideItems = (registry: UiRegistry): NavEntry[] =>
  registry.navItems.filter((n) => n.group !== 'tab').sort((a, b) => a.order - b.order);

/** The items of the phone tab bar, in order. */
export const tabItems = (registry: UiRegistry): NavEntry[] =>
  registry.navItems
    .filter((n) => n.group !== 'side')
    .sort((a, b) => (a.tabOrder ?? a.order) - (b.tabOrder ?? b.order));

/** Ids of the items that have no tab of their own on a phone: they are reached from «Ще» and keep that tab lit. */
export const morePages = (registry: UiRegistry): string[] =>
  registry.navItems.filter((n) => n.group === 'side').map((n) => n.id);

/** The nav item a location hash belongs to, or null when none does. */
export function activeNav(hash: string, registry: UiRegistry): string | null {
  return registry.matchPage(hash)?.page.nav ?? null;
}

/** Which nav item and which skill the suggested next step points at, from the step's target hash. */
export function markerOf(
  target: string | null,
  registry: UiRegistry | null,
): { nav: string | null; skill: string | null } {
  if (target === null) return { nav: null, skill: null };
  const { nav, skill } = navTarget(target);
  return { nav: registry?.navItems.some((n) => n.id === nav) ? nav : null, skill };
}
