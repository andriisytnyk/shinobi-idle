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
  });
});
