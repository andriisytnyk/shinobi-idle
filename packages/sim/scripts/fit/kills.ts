/* Sustained zone kills and defeats per 2 h for katon and doton, the harness of sustained.test.ts. */
import { content, type NatureId } from '@shinobi/content';
import { grindStats } from './sustained.ts';

const regular = content.enemies.filter(
  (e) => e.id !== 'core:dummy' && content.zones.some((z) => z.enemy === e.id),
);
for (const e of regular) {
  const r = (['katon', 'doton'] as NatureId[]).map((n) => grindStats(e.id, n, 2));
  console.log(
    `${e.id.replace('core:', '').padEnd(14)} katon ${r[0]!.kills}/${r[0]!.defeats}  doton ${r[1]!.kills}/${r[1]!.defeats}`,
  );
}
