import { content } from '@shinobi/content';
import { xpAt } from '@shinobi/core';

const counts: [string, number][] = [
  ['skills', content.skills.length],
  ['techniques', content.techniques.length],
  ['seals', content.seals.length],
  ['exercises', content.exercises.length],
  ['practices', content.practices.length],
  ['obstacles', content.obstacles.length],
  ['herbs', content.herbs.length],
  ['recipes', content.recipes.length],
  ['missions', content.missions.length],
  ['cells', content.cells.length],
  ['enemies', content.enemies.length],
  ['bosses', content.bosses.length],
  ['buildings', content.buildings.length],
];

for (const [name, n] of counts) console.log(`${name}: ${n}`);
console.log(`xpAt(50): ${xpAt(50)}`);
