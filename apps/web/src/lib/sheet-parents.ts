import type { ContentDb } from '@shinobi/content';
import { hrefFor } from './route.ts';
import { skillByActivity } from './vocab.ts';

/** The page of a skill, or null for a skill id that is not given. */
const skillPage = (id: string | undefined | null): string | null =>
  id ? hrefFor({ kind: 'skill', id }) : null;

/**
 * The page that holds the tile of each kind of entity whose details open as a sheet over a page that
 * depends on the entity: techniques, exercises, practices, obstacles and recipes live on the page of
 * their skill; a herb on the page of the skill that gathers it, any other item in the bank. Null when
 * the id names nothing.
 */
export const sheetParents = {
  technique: (id: string, content: ContentDb): string | null =>
    skillPage(content.techniques.find((x) => x.id === id)?.skill),
  exercise: (id: string, content: ContentDb): string | null => {
    const exercise = content.exercises.find((x) => x.id === id);
    return exercise ? skillPage(exercise.skill ?? skillByActivity(content, 'drill')) : null;
  },
  practice: (id: string, content: ContentDb): string | null => {
    const practice = content.practices.find((x) => x.id === id);
    return practice ? skillPage(practice.skill ?? skillByActivity(content, 'insight')) : null;
  },
  obstacle: (id: string, content: ContentDb): string | null =>
    content.obstacles.some((x) => x.id === id)
      ? skillPage(skillByActivity(content, 'course'))
      : null,
  recipe: (id: string, content: ContentDb): string | null =>
    skillPage(content.recipes.find((x) => x.id === id)?.skill),
  item: (id: string, content: ContentDb): string | null => {
    const herb = content.herbs.find((x) => x.id === id);
    return herb ? skillPage(herb.skill ?? skillByActivity(content, 'patch')) : '#/bank';
  },
} as const;
