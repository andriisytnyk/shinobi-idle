/* Kills per 2 h (extrapolated from 30 min) for a few zones under a knob set: kscan.ts '{"wg":0.5}' bandit wolf */
import { content, type NatureId } from '@shinobi/content';
import { DEFAULTS, apply } from './fit.ts';
import { grindStats } from './sustained.ts';

apply({ ...DEFAULTS, ...(JSON.parse(process.argv[2] ?? '{}') as Record<string, number>) });
for (const id of process.argv.slice(3)) {
  const r = (['katon', 'doton'] as NatureId[]).map((n) => grindStats(`core:${id}`, n, 0.5).kills * 4);
  console.log(id, r.join(' '), content.enemies.find((e) => e.id === `core:${id}`)?.cl);
}
