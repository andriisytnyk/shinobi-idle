import type { BuildingEffect, BuildingInfo } from '@shinobi/core';
import { entityName } from './entities.ts';
import { formatInt } from './format.ts';
import { fallbackText, t } from './i18n.ts';
import { game } from './store.ts';

/** The order the roles are listed in on the village page. */
export const ROLE_ORDER = ['producer', 'storage', 'shop', 'bonus', 'admin', 'defence'] as const;

/** The icon of a resource: the one its data names (Shinobi Power and the unnamed ones share a generic one). */
export const resourceIcon = (id: string): string =>
  game.content.resources.find((r) => r.id === id)?.icon ?? 'lucide:users';
export const resourceName = (id: string): string => t(`resource.${id}.name`);

/** Village ticks in one hour. */
export const ticksPerHour = (): number => 60 / game.content.balance.K.tickMin;

/** A per-tick amount as an amount per hour. */
export const perHour = (perTick: number): number => perTick * ticksPerHour();

/** A modifier value as the text a player reads: `+1%`, `−5%`, `×2`. */
export function formatEffectValue(effect: BuildingEffect): string {
  if (effect.op === 'mul') return `×${formatInt(effect.value)}`;
  const pct = Math.round(effect.value * 1000) / 10;
  const text = new Intl.NumberFormat('uk', { maximumFractionDigits: 1 }).format(Math.abs(pct));
  return `${pct < 0 ? '−' : '+'}${text}%`;
}

/** The family a modifier key belongs to, and the skill it names when it has one. */
function familyOf(key: string): { family: string; skill: string | null } {
  const m = /^(xp|speed)\.skill\.([a-z0-9_:]+)$/.exec(key);
  return m ? { family: m[1] ?? key, skill: m[2] ?? null } : { family: key, skill: null };
}

/** Effects as lines of text; the skills that share a value in one family are listed on one line. */
export function effectLines(effects: readonly BuildingEffect[]): string[] {
  const lines = new Map<string, { family: string; key: string; skills: string[]; value: string }>();
  for (const e of effects) {
    const { family, skill } = familyOf(e.key);
    const value = formatEffectValue(e);
    const id = `${family}|${skill === null ? e.key : ''}|${value}`;
    const line = lines.get(id) ?? { family, key: e.key, skills: [], value };
    if (skill) line.skills.push(entityName({ kind: 'skill', id: skill }));
    lines.set(id, line);
  }
  return [...lines.values()].map((l) => {
    const known = `village.fx.${l.family}`;
    const text =
      l.family === 'xp' || l.family === 'speed'
        ? t(known, { skills: l.skills.join(', '), value: l.value })
        : t(known, { value: l.value });
    // An unknown key shows its name rather than nothing.
    return text === known
      ? t('village.fx.other', { key: fallbackText(`x.${l.key}`), value: l.value })
      : text;
  });
}

/** The missions that bring in a shinobi resource. */
export const missionsGiving = (resource: string): string[] =>
  game.content.missions.filter((m) => m.resource === resource).map((m) => m.id);

/** The need lines to show with have / need: the civil resources, the treasury and the shinobi resources. */
export function costLines(info: BuildingInfo): BuildingInfo['needs'] {
  return info.needs.filter(
    (n) => n.kind === 'civil' || n.kind === 'treasury' || n.kind === 'shinobi',
  );
}

/** The short reason a build is off, in words naming the resource that is short; null when it can be built. */
export function whyOff(
  info: BuildingInfo,
): { reason: string; text: string; shinobi: string | null } | null {
  if (info.build.ok) return null;
  const reason = info.build.reason;
  const unmet = (kind: string) => info.needs.find((n) => n.kind === kind && !n.met);
  if (reason === 'error.notEnoughResources') {
    const n = unmet('civil');
    if (n?.id) {
      return {
        reason,
        shinobi: null,
        text: t('village.why.resource', {
          name: resourceName(n.id),
          have: formatInt(n.current),
          need: formatInt(n.target),
        }),
      };
    }
  }
  if (reason === 'error.notEnoughTreasury') {
    const n = unmet('treasury');
    if (n) {
      return {
        reason,
        shinobi: null,
        text: t('village.why.treasury', { have: formatInt(n.current), need: formatInt(n.target) }),
      };
    }
  }
  if (reason === 'error.notEnoughShinobi') {
    const n = unmet('shinobi');
    if (n?.id) {
      return {
        reason,
        shinobi: n.id,
        text: t('village.why.shinobi', {
          name: resourceName(n.id),
          have: formatInt(n.current),
          need: formatInt(n.target),
        }),
      };
    }
  }
  return { reason, shinobi: null, text: t(reason) };
}
