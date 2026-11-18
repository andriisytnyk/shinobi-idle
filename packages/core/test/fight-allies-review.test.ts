/**
 * Allies in a fight, review fixes of PR #127: what a blow does to the body it hits, the guard on hooks
 * of other packs over the allies, the style of the combat XP, the saved allies, the clone technique's data.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  alliesOf,
  createFight,
  encounterFor,
  fightAdvance,
  fightNextEventIn,
  parseFight,
  tagOrigin,
  defaultRules,
  type Combatant,
  type FightHook,
  type FightState,
  type Rules,
} from '../src/index.ts';
import { answersTrait, planLoadout } from '../src/combat/loadout.ts';
import { castSeq, enemyAt, scripted, sec, withAi } from './fight-helpers.ts';

const CLONE = 'core:shadow_clone';
const FIREBALL = 'core:great_fireball';
const DYNAMIC = 'core:dynamic_entry';

/** Runs the fight to the next event, `steps` times at most, calling `each` after every one while it goes on. */
function drive(fight: FightState, r: Rules, steps: number, each: () => void): void {
  for (let i = 0; i < steps && fight.result === 'ongoing'; i++) {
    fightAdvance(fight, fightNextEventIn(fight, content, r) ?? 1, content, r);
    if (fight.result === 'ongoing') each();
  }
}

const stunned = (c: Combatant): boolean =>
  c.effects.some((e) => JSON.stringify(e).includes('heavyCast'));

describe('a heavy blow stuns the body it hits', () => {
  it('never stuns the character for a blow that landed on a clone (core:boss_hunter)', () => {
    const boss = content.bosses.find((b) => b.id === 'core:boss_hunter');
    if (!boss) throw new Error('no boss_hunter');
    const r = withAi(castSeq(CLONE, DYNAMIC));
    // The character summons the clones first; then they are the only bodies the boss aims at.
    const fresh = createFight(
      scripted([CLONE, DYNAMIC]),
      encounterFor(boss, content),
      5,
      content,
      r,
    );
    while ((fresh.tally.uses[CLONE] ?? 0) < 1 && fresh.result === 'ongoing') {
      fightAdvance(fresh, fightNextEventIn(fresh, content, r) ?? 1, content, r);
    }
    for (const a of alliesOf(fresh)) {
      a.data.threat = 1e9;
      a.hp = a.maxHp = 1e9;
    }
    fresh.player.hp = fresh.player.maxHp = 1e9;
    // What the boss did before the clones stood is not what is looked at.
    fresh.player.effects = [];
    let onClone = 0;
    let onCharacter = 0;
    drive(fresh, r, 4000, () => {
      // The character's health is untouched while no blow has landed on it: a stun then is a stun for a blow it never took.
      if (stunned(fresh.player) && fresh.player.hp === fresh.player.maxHp) onCharacter++;
      if (alliesOf(fresh).some(stunned)) onClone++;
    });
    expect(onClone).toBeGreaterThan(0);
    expect(onCharacter).toBe(0);
  });
});

describe('the guard on hooks of other packs covers the allies', () => {
  const evil: FightHook = tagOrigin(
    {
      id: 'evil:allybreak',
      onAttackHit: (_ctx, _enemy, target) => {
        // Leaves a timer of no size on the body it was handed, when that is a clone.
        if (target.ally !== undefined) target.timers.evil = { progress: 0, need: 0 };
      },
    },
    'evil',
  );
  const evilRules: Rules = withAi(castSeq(CLONE, DYNAMIC), {
    ...defaultRules,
    fightHooks: [...defaultRules.fightHooks, evil],
  });

  it('voids the fight, names the hook, and leaves a fight that can be saved and read back', () => {
    const fight = createFight(
      scripted([CLONE, DYNAMIC]),
      { ...enemyAt(10), specials: ['evil:allybreak'] },
      2,
      content,
      evilRules,
    );
    while ((fight.tally.uses[CLONE] ?? 0) < 1 && fight.result === 'ongoing') {
      fightAdvance(fight, fightNextEventIn(fight, content, evilRules) ?? 1, content, evilRules);
    }
    for (const a of alliesOf(fight)) a.data.threat = 1e9;
    fight.player.hp = fight.player.maxHp = 1e9;
    for (const e of fight.enemies) e.hp = e.maxHp = 1e9;
    fightAdvance(fight, sec(60), content, evilRules);
    expect(fight.result).toBe('void');
    expect(fight.fault).toMatchObject({ pack: 'evil', hook: 'evil:allybreak' });
    for (const a of alliesOf(fight)) {
      for (const t of Object.values(a.timers)) expect(t.need).toBeGreaterThanOrEqual(1);
    }
    expect(parseFight(JSON.parse(JSON.stringify(fight)), content)).not.toBeNull();
  });
});

describe('the character is the one whose actions set the style of the combat XP', () => {
  const share = (withClone: boolean, seed: number): number => {
    const known = withClone ? [CLONE, FIREBALL] : [FIREBALL];
    const r = withAi(castSeq(...known));
    const fight = createFight(scripted(known), enemyAt(40), seed, content, r);
    fight.player.hp = fight.player.maxHp = 1e9;
    for (const e of fight.enemies) e.hp = e.maxHp = 1e9;
    let katon = 0;
    let n = 0;
    for (let s = 0; s < 120 && fight.result === 'ongoing'; s++) {
      fightAdvance(fight, sec(1), content, r);
      n++;
      if (fight.tally.style === 'katon') katon++;
    }
    return katon / Math.max(1, n);
  };

  it('keeps the Katon share of a Katon kit as without the clones', () => {
    const plain = [1, 2, 3].map((s) => share(false, s)).reduce((a, b) => a + b, 0) / 3;
    const cloned = [1, 2, 3].map((s) => share(true, s)).reduce((a, b) => a + b, 0) / 3;
    expect(plain).toBeGreaterThan(0.1);
    expect(cloned).toBeGreaterThan(plain * 0.8);
  });

  it('does not move the style when only a clone acts', () => {
    const r = withAi(castSeq(CLONE, FIREBALL));
    const fight = createFight(scripted([CLONE, FIREBALL]), enemyAt(40), 4, content, r);
    while ((fight.tally.uses[CLONE] ?? 0) < 1 && fight.result === 'ongoing') {
      fightAdvance(fight, fightNextEventIn(fight, content, r) ?? 1, content, r);
    }
    // The character is held for good: from here on only the clones act.
    fight.player.timer.need = 1e15;
    fight.player.hp = fight.player.maxHp = 1e9;
    for (const e of fight.enemies) e.hp = e.maxHp = 1e9;
    const style = fight.tally.style;
    const before = alliesOf(fight).map((a) => a.last?.at ?? -1);
    drive(fight, r, 300, () => {});
    expect(alliesOf(fight).some((a, i) => (a.last?.at ?? -1) !== before[i])).toBe(true);
    expect(fight.tally.style).toBe(style);
  });
});

describe('a saved fight with allies is checked', () => {
  const saved = (): { fight: FightState; raw: Record<string, unknown> } => {
    const r = withAi(castSeq(CLONE, DYNAMIC));
    const fight = createFight(scripted([CLONE, DYNAMIC]), enemyAt(20), 3, content, r);
    while ((fight.tally.uses[CLONE] ?? 0) < 1 && fight.result === 'ongoing') {
      fightAdvance(fight, fightNextEventIn(fight, content, r) ?? 1, content, r);
    }
    return { fight, raw: JSON.parse(JSON.stringify(fight)) as Record<string, unknown> };
  };
  const allies = (raw: Record<string, unknown>) => raw.allies as Record<string, unknown>[];

  it('reads a fight as it was written', () => {
    expect(parseFight(saved().raw, content)).not.toBeNull();
  });

  it('refuses two allies of one id or one number', () => {
    const { raw } = saved();
    const [a, b] = allies(raw);
    if (!a || !b) throw new Error('no allies');
    expect(parseFight({ ...raw, allies: [a, { ...b, id: a.id }] }, content)).toBeNull();
    expect(
      parseFight(
        {
          ...raw,
          allies: [a, { ...b, ally: { ...(b.ally as object), n: (a.ally as { n: number }).n } }],
        },
        content,
      ),
    ).toBeNull();
  });

  it('refuses an ally that takes the id of the character, or is of a kind the kit lacks', () => {
    const { raw } = saved();
    const [a] = allies(raw);
    if (!a) throw new Error('no ally');
    const player = raw.player as { id: string };
    expect(parseFight({ ...raw, allies: [{ ...a, id: player.id }] }, content)).toBeNull();
    expect(
      parseFight(
        { ...raw, allies: [{ ...a, ally: { ...(a.ally as object), kind: 'core:nothing' } }] },
        content,
      ),
    ).toBeNull();
  });

  it('raises the counter of allies to the largest number in use, so a new one never repeats it', () => {
    const { raw } = saved();
    const without = { ...raw };
    delete without.allied;
    const parsed = parseFight(without, content);
    expect(parsed?.allied).toBe(Math.max(...allies(raw).map((a) => (a.ally as { n: number }).n)));
  });
});

describe('the clone technique is data of a summon', () => {
  const tech = content.techniques.find((t) => t.id === CLONE);

  it('deals no damage and answers no trait', () => {
    expect(tech?.noDamage).toBe(true);
    expect(tech?.tags).toEqual([]);
    for (const trait of content.traits) {
      expect(tech && answersTrait(tech, trait.id, content)).toBe(false);
    }
  });

  it('is worth what its bodies add to the best attack: ahead of weaker attacks, behind none of the best', () => {
    const attacks = [DYNAMIC, FIREBALL, 'core:leaf_gale'];
    const limits = { slots: 2, natures: 2 };
    const without = planLoadout(scripted(attacks), limits, { nature: null }, content);
    const withClone = planLoadout(scripted([CLONE, ...attacks]), limits, { nature: null }, content);
    expect(withClone).toHaveLength(2);
    // The share of the bodies is count x dmg of the balance object: it takes the place of the weakest of the hand, not of both.
    expect(withClone).toContain(CLONE);
    expect(withClone.filter((id) => without.includes(id))).toHaveLength(1);
    // Alone among techniques that deal nothing it is worth nothing, and the plan is empty.
    expect(planLoadout(scripted([CLONE]), limits, { nature: null }, content)).toEqual([]);
  });
});
