import { content } from '../src/index.ts';

const training = content.techniques.filter((t) => t.role === 'drill').length;
const lines = [
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
];
console.log(lines.join('\n'));
