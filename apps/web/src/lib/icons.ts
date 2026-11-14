import { content, iconFor, NATURE_IDS, type IconRef } from '@shinobi/content';
import { GAME_ICON_SIZE, GAME_ICONS, LUCIDE_ICON_SIZE, LUCIDE_ICONS } from './icons.generated.ts';

export interface ResolvedIcon {
  body: string;
  /** Side of the square grid the body is drawn on. */
  size: number;
}

/** Prefix that selects the Lucide (general UI) namespace; bare names are game-icons. */
export const UI_PREFIX = 'lucide:';

const FALLBACK = 'circle-help';

const natureSet: readonly string[] = NATURE_IDS;

/** The icon of an entity or a raw icon name; unknown input yields the fallback glyph, never a hole. */
export function resolveIcon(input: IconRef | string): ResolvedIcon {
  if (typeof input === 'string') {
    if (input.startsWith(UI_PREFIX)) {
      const body = LUCIDE_ICONS[input.slice(UI_PREFIX.length)];
      if (body !== undefined) return { body, size: LUCIDE_ICON_SIZE };
    } else {
      const body = GAME_ICONS[input];
      if (body !== undefined) return { body, size: GAME_ICON_SIZE };
    }
    return { body: LUCIDE_ICONS[FALLBACK] ?? '', size: LUCIDE_ICON_SIZE };
  }
  const name = iconFor(input.kind, input.id);
  return name === undefined ? resolveIcon(FALLBACK) : resolveIcon(name);
}

/** Status ids mapped to the nature whose colour they take; bind and poison have no nature. */
const STATUS_NATURE: Record<string, string> = { burn: 'katon', wet: 'suiton', stun: 'raiton' };

/**
 * CSS colour for an entity icon, or `undefined` to inherit the surrounding text colour.
 * Elemental techniques, statuses and natures take their nature token; Taijutsu and
 * non-elemental Ninjutsu techniques use the neutral text colour.
 */
export function iconTint(ref: IconRef): string | undefined {
  let nature: string | undefined;
  if (ref.kind === 'technique') {
    const skill = content.techniques.find((t) => t.id === ref.id)?.skill;
    if (skill === undefined) return undefined;
    return natureSet.includes(skill) ? `var(--nature-${skill})` : 'var(--fg)';
  }
  if (ref.kind === 'nature') nature = ref.id;
  else if (ref.kind === 'status') nature = STATUS_NATURE[ref.id];
  return nature !== undefined && natureSet.includes(nature) ? `var(--nature-${nature})` : undefined;
}
