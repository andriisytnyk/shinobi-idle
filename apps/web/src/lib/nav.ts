import { navTarget } from './next-step.ts';
import type { Route } from './route.ts';

export interface NavItem {
  id: string;
  href: string;
  /** Localization key of the label. */
  label: string;
  /** Icon name: a game-icons name, or `lucide:<name>`. */
  icon: string;
  /** Shown in the phone tab bar. */
  tab: boolean;
  /** Shown in the wide-screen sidebar menu. */
  side: boolean;
}

/** The main navigation. The tab bar and the sidebar menu both read this list. */
export const NAV: readonly NavItem[] = [
  { id: 'skills', href: '#/skills', label: 'nav.skills', icon: 'fist', tab: true, side: false },
  {
    id: 'quests',
    href: '#/quests',
    label: 'nav.quests',
    icon: 'lucide:book-open',
    tab: true,
    side: true,
  },
  {
    id: 'combat',
    href: '#/combat',
    label: 'nav.combat',
    icon: 'crossed-swords',
    tab: true,
    side: true,
  },
  { id: 'bank', href: '#/bank', label: 'nav.bank', icon: 'lucide:package', tab: true, side: true },
  { id: 'rank', href: '#/rank', label: 'nav.rank', icon: 'rank-3', tab: false, side: true },
  {
    id: 'missions',
    href: '#/missions',
    label: 'nav.missions',
    icon: 'tied-scroll',
    tab: true,
    side: true,
  },
  {
    id: 'village',
    href: '#/village',
    label: 'nav.village',
    icon: 'huts-village',
    tab: true,
    side: true,
  },
  {
    id: 'help',
    href: '#/help',
    label: 'nav.help',
    icon: 'lucide:circle-help',
    tab: false,
    side: true,
  },
  {
    id: 'more',
    href: '#/more',
    label: 'nav.more',
    icon: 'lucide:ellipsis',
    tab: true,
    side: false,
  },
];

/** The nav item a route belongs to, or null when none does. */
export function activeNav(route: Route): string | null {
  switch (route.page) {
    case 'skills':
      return 'skills';
    case 'quests':
      return 'quests';
    case 'combat':
      return 'combat';
    case 'bank':
      return 'bank';
    case 'rank':
      return 'rank';
    case 'tab':
      return route.tab;
    case 'help':
      return 'help';
    case 'credits':
    case 'settings':
      return 'more';
    case 'entity':
      if (route.ref.kind === 'skill') return 'skills';
      if (route.ref.kind === 'quest') return 'quests';
      if (route.ref.kind === 'exam') return 'rank';
      return null;
    default:
      return null;
  }
}

/** Which nav item and which skill the suggested next step points at, from the step's target hash. */
export function markerOf(target: string | null): { nav: string | null; skill: string | null } {
  if (target === null) return { nav: null, skill: null };
  const { nav, skill } = navTarget(target);
  return { nav: NAV.some((n) => n.id === nav) ? nav : null, skill };
}
