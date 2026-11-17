import { describe, expect, it } from 'vitest';
import { content } from '../src/index.ts';

describe('slice size', () => {
  it('matches the numbers promised for stage 0', () => {
    const training = content.techniques.filter((t) => t.role === 'drill').length;
    expect(content.techniques.length).toBe(60);
    expect(content.techniques.length - training).toBe(47);
    expect(training).toBe(13);
    expect(content.seals.length).toBe(17);
    expect(content.exercises.length).toBe(8);
    expect(content.practices.length).toBe(6);
    expect(content.obstacles.length).toBe(12);
    expect(content.herbs.length).toBe(11);
    expect(content.recipes.length).toBe(22);
    expect(content.missions.length).toBe(22);
    expect(content.cells.length).toBe(36);
    expect(content.enemies.length).toBe(24);
    expect(content.bosses.length).toBe(8);
    expect(content.buildings.length).toBe(16);
    // Fifteen scrolls of techniques, and the one the quest hands over for the chakra drill.
    expect(content.items.filter((i) => i.scroll)).toHaveLength(16);
    // Five scrolls carried by enemies, and the one the dig of the missions pays in parts.
    expect(content.items.filter((i) => i.part)).toHaveLength(6);
    expect(content.zones).toHaveLength(31);
    expect(content.operations).toHaveLength(2);
    expect(content.statuses).toHaveLength(6);
    expect(content.traits).toHaveLength(8);
    expect(content.combos).toHaveLength(4);
  });
});
