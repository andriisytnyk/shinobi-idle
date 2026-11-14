/** Hand-written content: the «Випуск» chain, the Genin exam and the graduate scroll. */
import { describe, expect, it } from 'vitest';
import idRegistry from '../src/data/id-registry.json' with { type: 'json' };
import { content, ukLocale, type Req } from '../src/index.ts';

const techIds = new Set(content.techniques.map((t) => t.id));
const itemIds = new Set(content.items.map((i) => i.id));
const registered = (kind: string): string[] =>
  Object.values((idRegistry as Record<string, Record<string, string>>)[kind] ?? {});

/** Every id a requirement tree points at must exist. */
function check(req: Req, where: string): void {
  switch (req.t) {
    case 'technique':
      expect(techIds.has(req.id), `${where}: technique ${req.id}`).toBe(true);
      break;
    case 'item':
      expect(itemIds.has(req.id), `${where}: item ${req.id}`).toBe(true);
      break;
    case 'quest':
      expect(
        content.quests.some((q) => q.id === req.id),
        `${where}: quest ${req.id}`,
      ).toBe(true);
      break;
    case 'skill':
      expect(req.level, where).toBeLessThanOrEqual(content.balance.K.cap);
      break;
    case 'all':
    case 'any':
      for (const r of req.of) check(r, where);
      break;
    default:
  }
}

describe('hand-written content: quests, exams and the graduate scroll', () => {
  it('registers every id in the id registry', () => {
    for (const q of content.quests) {
      expect(registered('quest')).toContain(q.id.replace('core:', ''));
    }
    for (const e of content.exams) {
      expect(registered('exam')).toContain(e.id.replace('core:', ''));
    }
    expect(registered('item')).toContain('graduate_scroll');
  });

  it('gives every quest, step, exam and the scroll a Ukrainian text', () => {
    for (const q of content.quests) {
      expect(ukLocale[`quest.${q.id}.name`], q.id).toBeTruthy();
      expect(ukLocale[`quest.${q.id}.desc`], q.id).toBeTruthy();
      for (const s of q.steps) expect(ukLocale[s.textKey], s.textKey).toBeTruthy();
    }
    for (const e of content.exams) {
      expect(ukLocale[`exam.${e.id}.name`], e.id).toBeTruthy();
      expect(ukLocale[`exam.${e.id}.desc`], e.id).toBeTruthy();
    }
    expect(ukLocale['item.core:graduate_scroll.name']).toBe('Сувій випускника');
    expect(ukLocale['item.core:graduate_scroll.desc']).toBeTruthy();
  });

  it('only refers to ids that exist', () => {
    for (const q of content.quests) {
      if (q.unlock) check(q.unlock, q.id);
      for (const s of q.steps) if (s.objective.t === 'req') check(s.objective.req, q.id);
      for (const r of q.rewards.items) {
        expect(itemIds.has(r.item), `${q.id}: ${r.item}`).toBe(true);
      }
    }
    for (const e of content.exams) {
      check(e.checklist, e.id);
      for (const r of e.rewards.items) {
        expect(itemIds.has(r.item), `${e.id}: ${r.item}`).toBe(true);
      }
      if (e.rewards.goal?.kind === 'technique') {
        expect(techIds.has(e.rewards.goal.id), `${e.id}: goal`).toBe(true);
      }
    }
  });

  it('has the «Випуск» chain: five steps, ten dummies in step four', () => {
    const chain = content.quests.find((q) => q.id === 'core:graduation');
    expect(chain?.steps).toHaveLength(5);
    expect(chain?.steps[3]?.objective).toEqual({
      t: 'counter',
      counter: 'kills.core:dummy',
      n: 10,
    });
    expect(ukLocale['quest.core:graduation.name']).toBe('Випуск');
  });

  it('describes the Genin exam checklist and the sensei test durations', () => {
    const exam = content.exams.find((e) => e.rank === 'genin');
    const text = JSON.stringify(exam?.checklist);
    for (const needle of [
      '"tai"',
      '"nin"',
      '"cc"',
      'core:clone',
      'core:transformation',
      'core:body_replacement',
    ]) {
      expect(text).toContain(needle);
    }
    expect(exam?.rewards.goal).toEqual({ kind: 'technique', id: 'core:shadow_clone' });
    expect(content.balance.K.senseiTest).toEqual({ base: 300, perLevel: 0.01, floor: 120 });
  });

  it('keeps the scroll a consumable that grants an academy mastery hour', () => {
    const scroll = content.items.find((i) => i.id === 'core:graduate_scroll');
    expect(scroll?.kind).toBe('consumable');
    expect(scroll?.use).toEqual({ t: 'masteryHour', mentor: 'academy' });
  });
});
