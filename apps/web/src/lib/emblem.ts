import type { ContentDb } from '@shinobi/content';

/** The colour of a medallion that has none of its own: the neutral steel of the palette. */
export const NEUTRAL_TINT = 'var(--steel)';

/** A CSS token name (`--nature-katon`) as a colour that falls back to the neutral tint. */
function token(name: string): string {
  return `var(${name}, ${NEUTRAL_TINT})`;
}

/**
 * The tint of an action's medallion; `kind` is the entity kind (`technique`, `exercise`, `item`…). A technique of an elemental skill takes the colour of its
 * nature (the token the nature names in the content); a non-elemental technique and a nature
 * without a token are neutral. Every other action takes the colour of its skill's group, by the
 * token `--group-<id>`; a group without a token is neutral too.
 */
export function emblemTint(
  content: ContentDb,
  action: { kind: string; skill?: string; id?: string },
): string {
  if (action.kind === 'technique') {
    const skill =
      action.skill ?? content.techniques.find((t) => t.id === action.id)?.skill ?? undefined;
    const nature = content.natures.find((n) => n.id === skill);
    return nature?.color ? token(nature.color) : NEUTRAL_TINT;
  }
  const skill = content.skills.find((s) => s.id === action.skill);
  return skill ? token(`--group-${skill.group}`) : NEUTRAL_TINT;
}
