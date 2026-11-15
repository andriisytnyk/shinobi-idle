import { isEntityKind } from '../entities.ts';
import { parseHash } from '../route.ts';
import { worldFocus } from '../world.ts';
import BankPage from '../../pages/BankPage.svelte';
import BuildingPage from '../../pages/BuildingPage.svelte';
import CombatPage from '../../pages/CombatPage.svelte';
import CreditsPage from '../../pages/CreditsPage.svelte';
import EntityPage from '../../pages/EntityPage.svelte';
import GearPage from '../../pages/GearPage.svelte';
import HelpPage from '../../pages/HelpPage.svelte';
import HomePage from '../../pages/HomePage.svelte';
import ItemPage from '../../pages/ItemPage.svelte';
import MorePage from '../../pages/MorePage.svelte';
import NaturePage from '../../pages/NaturePage.svelte';
import PlaceholderPage from '../../pages/PlaceholderPage.svelte';
import QuestsPage from '../../pages/QuestsPage.svelte';
import RankPage from '../../pages/RankPage.svelte';
import RecipePage from '../../pages/RecipePage.svelte';
import SettingsPage from '../../pages/SettingsPage.svelte';
import ShopPage from '../../pages/ShopPage.svelte';
import SkillPage from '../../pages/SkillPage.svelte';
import SkillsPage from '../../pages/SkillsPage.svelte';
import TechniquePage from '../../pages/TechniquePage.svelte';
import PwaSection from '../../components/PwaSection.svelte';
import CoursePanel from '../../components/CoursePanel.svelte';
import MeditationPanel from '../../components/MeditationPanel.svelte';
import ScoutPanel from '../../components/ScoutPanel.svelte';
import PoiLoot from '../../components/poi/PoiLoot.svelte';
import PoiNote from '../../components/poi/PoiNote.svelte';
import PoiTraining from '../../components/poi/PoiTraining.svelte';
import PoiZone from '../../components/poi/PoiZone.svelte';
import VillagePage from '../../pages/VillagePage.svelte';
import WorldPage from '../../pages/WorldPage.svelte';
import { svelteWidget } from './svelte-widget.ts';
import type { UiPack } from './types.ts';

/**
 * The built-in interface as a UI pack: its pages, its navigation and its base theme go through the
 * same registries as the pages and navigation of any other pack.
 */
export const coreUi: UiPack = {
  id: 'core',
  theme: { id: 'base', name: 'theme.base', tokens: {} },
  setup(ui) {
    // The «Застосунок» section of the settings page: install state, version, update.
    ui.addWidget('settings', svelteWidget(PwaSection), { id: 'pwa', order: 10 });

    ui.addPage({ id: 'home', route: '#/', title: 'home.title', mount: { svelte: HomePage } });
    ui.addPage({
      id: 'skills',
      route: '#/skills',
      title: 'nav.skills',
      nav: 'skills',
      mount: { svelte: SkillsPage },
    });
    ui.addPage({
      id: 'settings',
      route: '#/settings',
      title: 'settings.title',
      nav: 'more',
      mount: { svelte: SettingsPage },
    });
    ui.addPage({
      id: 'credits',
      route: '#/credits',
      title: 'credits.title',
      nav: 'more',
      mount: { svelte: CreditsPage },
    });
    ui.addPage({
      id: 'quests',
      route: '#/quests',
      title: 'nav.quests',
      nav: 'quests',
      mount: { svelte: QuestsPage },
    });
    ui.addPage({
      id: 'rank',
      route: '#/rank',
      title: 'nav.rank',
      nav: 'rank',
      mount: { svelte: RankPage },
    });
    ui.addPage({
      id: 'combat',
      route: '#/combat',
      title: 'nav.combat',
      nav: 'combat',
      mount: { svelte: CombatPage },
    });
    ui.addPage({
      id: 'bank',
      route: '#/bank',
      title: 'nav.bank',
      nav: 'bank',
      mount: { svelte: BankPage },
    });
    ui.addPage({
      id: 'shop',
      route: '#/shop',
      title: 'nav.shop',
      nav: 'shop',
      mount: { svelte: ShopPage },
    });
    ui.addPage({
      id: 'shop.sell',
      route: '#/shop/sell',
      title: 'nav.shop',
      nav: 'shop',
      mount: { svelte: ShopPage, props: () => ({ section: 'sell' }) },
    });
    ui.addPage({
      id: 'world',
      route: '#/world',
      title: 'nav.world',
      nav: 'world',
      mount: { svelte: WorldPage },
    });
    ui.addPage({
      id: 'nature',
      route: '#/nature',
      title: 'nature.title',
      nav: 'skills',
      mount: { svelte: NaturePage },
    });
    ui.addPage({
      id: 'help',
      route: '#/help',
      title: 'nav.help',
      nav: 'help',
      mount: { svelte: HelpPage },
    });
    ui.addPage({
      id: 'more',
      route: '#/more',
      title: 'nav.more',
      nav: 'more',
      mount: { svelte: MorePage },
    });
    ui.addPage({
      id: 'missions',
      route: '#/missions',
      title: 'nav.missions',
      nav: 'missions',
      mount: { svelte: PlaceholderPage, props: () => ({ title: 'nav.missions' }) },
    });
    ui.addPage({
      id: 'village',
      route: '#/village',
      title: 'nav.village',
      nav: 'village',
      mount: { svelte: VillagePage },
    });
    ui.addPage({
      id: 'village.focus',
      route: '#/village/*focus',
      title: 'nav.village',
      nav: 'village',
      mount: { svelte: VillagePage, props: ({ params }) => ({ focus: params.focus ?? null }) },
    });

    // Pages of entities. The kinds without a page of their own fall back to the generic one below.
    const byId = (C: typeof SkillPage) => ({
      svelte: C,
      props: ({ params }: { params: Record<string, string> }) => ({ id: params.id }),
    });
    const entity = (
      kind: string,
      mount: Parameters<typeof ui.addPage>[0]['mount'],
      nav?: string,
    ): void =>
      ui.addPage({
        id: `entity.${kind}`,
        route: `#/${kind}/*id`,
        title: `entity.kind.${kind}`,
        nav,
        mount,
      });
    entity('quest', { svelte: QuestsPage }, 'quests');
    entity('exam', { svelte: RankPage }, 'rank');
    entity('skill', byId(SkillPage), 'skills');
    entity('technique', byId(TechniquePage));
    entity('recipe', byId(RecipePage), 'skills');
    entity('gear', byId(GearPage), 'shop');
    entity('building', byId(BuildingPage), 'village');
    entity('item', byId(ItemPage));
    const world = {
      svelte: WorldPage,
      props: ({ hash }: { hash: string }) => ({ focus: worldFocus(parseHash(hash)) }),
    };
    for (const kind of ['cell', 'region', 'poi']) entity(kind, world, 'world');
    ui.addPage({
      id: 'entity',
      route: '#/:kind/*id',
      title: 'route.entity',
      guard: ({ kind }) => kind !== undefined && isEntityKind(kind),
      mount: {
        svelte: EntityPage,
        props: ({ params }) => ({ entity: { kind: params.kind, id: params.id } }),
      },
    });

    // What the skill page draws for each skill activity; an activity that is not listed gets the action tiles.
    ui.addSkillPanel('map', { mount: { svelte: ScoutPanel }, place: 'replace' });
    ui.addSkillPanel('course', { mount: { svelte: CoursePanel }, place: 'replace' });
    ui.addSkillPanel('insight', { mount: { svelte: MeditationPanel } });
    ui.addSkillPanel('patch', { hint: 'herbalism' });
    ui.addSkillPanel('recipe', { hint: 'crafting' });
    ui.addSkillPanel('station', { hint: 'crafting' });

    // How each kind of point of interest is drawn in the cell panel; other kinds are drawn generically.
    ui.addPoiRenderer('outpost', { icon: 'lucide:tent', mount: { svelte: PoiNote } });
    ui.addPoiRenderer('training', { icon: 'lucide:dumbbell', mount: { svelte: PoiTraining } });
    ui.addPoiRenderer('zone', { icon: 'lucide:swords', mount: { svelte: PoiZone } });
    ui.addPoiRenderer('story', { icon: 'lucide:scroll-text', mount: { svelte: PoiNote } });
    ui.addPoiRenderer('deposit', { icon: 'lucide:pickaxe', mount: { svelte: PoiNote } });
    ui.addPoiRenderer('cache', { icon: 'lucide:gift', mount: { svelte: PoiLoot } });
    ui.addPoiRenderer('vault', { icon: 'lucide:key-round', mount: { svelte: PoiLoot } });
    ui.addPoiRenderer('mission', { icon: 'lucide:clipboard-list', mount: { svelte: PoiNote } });

    ui.addNavItem({
      id: 'skills',
      group: 'tab',
      title: 'nav.skills',
      icon: 'fist',
      route: '#/skills',
      order: 0,
      tabOrder: 10,
    });
    ui.addNavItem({
      id: 'quests',
      group: 'main',
      title: 'nav.quests',
      icon: 'lucide:book-open',
      route: '#/quests',
      order: 10,
      tabOrder: 40,
    });
    ui.addNavItem({
      id: 'combat',
      group: 'main',
      title: 'nav.combat',
      icon: 'crossed-swords',
      route: '#/combat',
      order: 20,
      tabOrder: 30,
    });
    ui.addNavItem({
      id: 'world',
      group: 'main',
      title: 'nav.world',
      icon: 'lucide:map',
      route: '#/world',
      order: 30,
      tabOrder: 20,
    });
    ui.addNavItem({
      id: 'bank',
      group: 'side',
      title: 'nav.bank',
      icon: 'lucide:package',
      route: '#/bank',
      order: 40,
    });
    ui.addNavItem({
      id: 'shop',
      group: 'side',
      title: 'nav.shop',
      icon: 'lucide:store',
      route: '#/shop',
      order: 50,
    });
    ui.addNavItem({
      id: 'village',
      group: 'side',
      title: 'nav.village',
      icon: 'lucide:landmark',
      route: '#/village',
      order: 60,
    });
    ui.addNavItem({
      id: 'rank',
      group: 'side',
      title: 'nav.rank',
      icon: 'rank-3',
      route: '#/rank',
      order: 70,
    });
    ui.addNavItem({
      id: 'help',
      group: 'side',
      title: 'nav.help',
      icon: 'lucide:circle-help',
      route: '#/help',
      order: 80,
    });
    ui.addNavItem({
      id: 'more',
      group: 'tab',
      title: 'nav.more',
      icon: 'lucide:ellipsis',
      route: '#/more',
      order: 0,
      tabOrder: 50,
    });
  },
};
