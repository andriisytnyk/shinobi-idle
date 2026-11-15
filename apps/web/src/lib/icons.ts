import { iconFor, type IconRef } from '@shinobi/content';
import { GAME_ICON_SIZE, GAME_ICONS, LUCIDE_ICON_SIZE, LUCIDE_ICONS } from './icons.generated.ts';
import { game } from './store.ts';
import { isNature, natureColor } from './vocab.ts';

export interface ResolvedIcon {
  body: string;
  /** Side of the square grid the body is drawn on. */
  size: number;
}

/** Prefix that selects the Lucide (general UI) namespace; bare names are game-icons. */
export const UI_PREFIX = 'lucide:';

const FALLBACK = 'circle-help';

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
  const name = iconFor(input.kind, input.id, game.content.icons);
  return name === undefined ? resolveIcon(FALLBACK) : resolveIcon(name);
}

/**
 * CSS colour for an entity icon, or `undefined` to inherit the surrounding text colour.
 * Natures, the statuses and techniques that name a nature take its colour; techniques of a skill
 * that is not a nature use the neutral text colour.
 */
export function iconTint(ref: IconRef): string | undefined {
  const { content } = game;
  let nature: string | undefined;
  if (ref.kind === 'technique') {
    const skill = content.techniques.find((t) => t.id === ref.id)?.skill;
    if (skill === undefined) return undefined;
    return isNature(content, skill) ? natureColor(content, skill) : 'var(--fg)';
  }
  if (ref.kind === 'nature') nature = ref.id;
  else if (ref.kind === 'status') nature = content.statuses.find((s) => s.id === ref.id)?.nature;
  return nature !== undefined && isNature(content, nature)
    ? natureColor(content, nature)
    : undefined;
}
