import { content } from '@shinobi/content';
import { fightData, type AiVocab, type KitTechnique, type ViewTechnique } from '../src/index.ts';

/** What the player AI knows of the traits of the shipped content, as `buildView` gives it. */
export const aiVocab: AiVocab = fightData(content).ai;

/** The technique row of a hand-made view: ready, with the answers and the interrupt flag its data gives. */
export function viewTechnique(tech: KitTechnique, over: Partial<ViewTechnique> = {}): ViewTechnique {
  const data = fightData(content);
  return {
    tech,
    cooldownLeft: 0,
    affordable: true,
    ready: true,
    uses: 0,
    expected: tech.damage,
    power: tech.damage,
    stanceOk: true,
    answers: content.traits
      .filter(
        (t) =>
          tech.tags.includes(t.answer) ||
          (tech.state !== null && data.byState.get(tech.state)?.suppresses === t.id),
      )
      .map((t) => t.id),
    interrupts: tech.tags.some((tag) => data.tags.get(tag)?.interrupts === true),
    ...over,
  };
}
