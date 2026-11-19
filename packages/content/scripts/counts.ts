import { testmodPack } from '@shinobi/content/testmod';
import { composeContent, corePack, ENTITY_LISTS, ownsId } from '../src/index.ts';

/** Counts of the entities each pack owns, by list; lists a pack leaves empty are skipped. */
function perPack(label: string, packs: Parameters<typeof composeContent>[0]): string[] {
  const db = composeContent(packs);
  const lines = [`== ${label} ==`];
  for (const pack of db.packs) {
    const counts = ENTITY_LISTS.map(
      (list) => [list, db[list].filter((e) => ownsId(pack.id, e.id)).length] as const,
    ).filter(([, n]) => n > 0);
    lines.push(
      `pack ${pack.id} ${pack.version}: ${counts.reduce((sum, [, n]) => sum + n, 0)} entities`,
      ...counts.map(([list, n]) => `  ${list}: ${n}`),
    );
  }
  return lines;
}

const lines = [
  ...perPack('app content', [corePack]),
  ...perPack('with the test pack', [corePack, testmodPack]),
];

// The slice numbers of the pack core, as promised for stage 0.
const content = composeContent([corePack]);
const training = content.techniques.filter((t) => t.role === 'drill').length;
lines.push(
  '== slice ==',
  `${content.techniques.length} techniques (${content.techniques.length - training} non-training + ${training} training)`,
  `${content.seals.length} seals`,
  `${content.exercises.length} exercises`,
  `${content.practices.length} practices`,
  `${content.obstacles.length} obstacles`,
  `${content.herbs.length} herbs`,
  `${content.recipes.length} recipes`,
  `${content.missions.length} missions`,
  `${content.cells.length} cells`,
  `${content.enemies.length} enemy entries (${content.enemies.length - 1} types + training dummy)`,
  `${content.bosses.length} boss entries`,
  `${content.buildings.length} buildings`,
  `${content.items.filter((i) => i.scroll).length} scrolls (${content.items.filter((i) => i.part).length} scroll-part items)`,
  `${content.zones.length} zones`,
  `${content.operations.length} operations`,
  `${content.fieldworks.length} fieldworks`,
  `${content.statuses.length} statuses`,
  `${content.traits.length} traits`,
  `${content.combos.length} combos`,
);
console.log(lines.join('\n'));
