import { content } from '@shinobi/content';
import type { PlayerSnapshot } from '../src/index.ts';

const K = content.balance.K;
export const NATURES = ['katon', 'futon', 'raiton', 'doton', 'suiton'] as const;

/** The yardstick player: a typical build for combat level `c`, full tactics, no pouch. */
export function yardstick(c: number, nature: string): PlayerSnapshot {
  const style = Math.min(K.cap, Math.round(c * 1.12));
  const d = Math.min(K.cap, Math.max(1, Math.round((c - style / 2) * 2)));
  const levels = {} as PlayerSnapshot['levels'];
  for (const skill of content.skills) levels[skill.id] = 1;
  levels.tai = Math.max(1, style - 4);
  levels.nin = Math.max(1, style - 6);
  for (const n of NATURES) levels[n] = style;
  levels.vit = d;
  levels.eva = d;
  levels.med = d;
  levels.ath = Math.min(K.cap, d);
  levels.cc = Math.min(K.cap, d);
  const skills: string[] = ['tai', 'nin', ...NATURES];
  const known = content.techniques
    .filter((t) => skills.includes(t.skill) && t.rank !== null && t.level <= (levels[t.skill] ?? 0))
    .map((t) => t.id);
  return {
    levels,
    mastery: Object.fromEntries(known.map((id) => [id, 20])),
    known,
    natures: [nature] as PlayerSnapshot['natures'],
    costMod: { chakra: 1, stamina: 1 },
    tier: 2,
  };
}
