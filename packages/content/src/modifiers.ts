/**
 * The one registry of modifier keys. Content data may only use keys listed here; a key that is
 * not known fails validation. Values are fractions: `add` entries are summed inside a group and
 * the total is `1 + sum`, `mul` entries are multiplied in. A key marked `flat` counts units, not
 * a share: its bonus is `total - 1` (for example `bush.stock` +5 means five more herbs).
 *
 * Time keys follow the sign of the text: `-0.05` on `interval.skill.alch` is "-5% of the time".
 * Speed keys (`speed.skill.*`) hold "+X% speed": the cycle length is divided by `1 + X`.
 */
import { z } from 'zod';
import { NATURE_IDS, SKILL_IDS, TECH_SKILL_IDS } from './constants.ts';

export interface ModifierKeyInfo {
  /** One line saying what the key changes (English, for developers). */
  desc: string;
  /** The value counts whole units instead of a share. */
  flat: boolean;
  /** Whether the rules read the key: false means it is registered and provided but nothing consumes it yet. */
  wired: boolean;
}

const registry: Record<string, ModifierKeyInfo> = {};

function add(key: string, desc: string, options: { flat?: boolean; wired?: boolean } = {}): void {
  if (registry[key]) throw new Error(`Duplicate modifier key ${key}`);
  registry[key] = { desc, flat: options.flat ?? false, wired: options.wired ?? false };
}

// Skill families: every skill, every key of the family.
add('xp.all', 'Skill XP of every skill', { wired: true });
add('mastery.xp.all', 'Mastery XP of every mastery', { wired: true });
for (const skill of SKILL_IDS) {
  add(`xp.skill.${skill}`, `XP of the skill ${skill}`, { wired: true });
  add(`mastery.xp.skill.${skill}`, `Mastery XP earned in the skill ${skill}`, { wired: true });
  add(`interval.skill.${skill}`, `Action cycle time of the skill ${skill} (-0.05 is 5% shorter)`, {
    wired: true,
  });
  add(`speed.skill.${skill}`, `Action speed of the skill ${skill} (+0.05 is 5% faster)`, {
    wired: true,
  });
}
add('speed.practice', 'Speed of technique practice in every skill (+0.02 is 2% faster)', {
  wired: true,
});

// Combat costs, casts and cooldowns by skill.
add('cost.chakra', 'Chakra cost of every technique in a fight', { wired: true });
add('cost.stamina', 'Stamina cost of every technique in a fight', { wired: true });
add('cost.chakra.nonelemental', 'Chakra cost of non-elemental techniques');
add('cost.technique', 'Combat cost of every technique');
add('cost.skill.doton.defense', 'Cost of the defensive techniques of Doton');
for (const skill of TECH_SKILL_IDS) {
  add(`cost.skill.${skill}`, `Cost of the techniques of the skill ${skill}`);
  add(`cast.skill.${skill}`, `Cast time of the techniques of the skill ${skill}`);
  add(`cooldown.skill.${skill}`, `Cooldown of the techniques of the skill ${skill}`);
}
add('cooldown.body_replacement', 'Cooldown of the Body Replacement technique');

// Combat effects.
add('burn.duration', 'Duration of the Burn state');
add('burn.damage', 'Damage of the Burn state');
add('wet.duration', 'Duration of the Wet state');
add('wet.slow', 'Strength of the slowdown from the Wet state');
add('stun.duration', 'Duration of the Stun state');
add('bind.duration', 'Duration of the Bind state');
add('shield.strength', 'Strength of shields');
add('interrupt.chance', 'Chance to interrupt enemy seals');
add('armor.pierce', 'Armor piercing');
add('damage.vs.armor', 'Damage against enemies with the Armor trait');
add('damage.vs.melee', 'Damage against melee enemies');
add('chakra.regen', 'Chakra recovery in a fight');
add('evasion', 'Evasion rating');
add('evasion.chance', 'Chance to dodge a hit');
add('accuracy', 'Accuracy rating');
add('defense', 'Defense rating against enemy hits');
add('heal.food', 'HP restored by salves and food');
add('wound.heal', 'Time to heal Wounds');
add('wound.heal.gates', 'Time to heal Wounds taken from the Gates');
add('pool.hp', 'Size of the HP pool');
add('pool.chakra', 'Size of the chakra pool');
add('pool.stamina', 'Size of the stamina pool');
add('clone.pool', 'The shared pool of shadow clones');

// Missions and exploration.
add('mission.duration', 'Duration of every mission (-0.05 is 5% shorter)', { wired: true });
add(
  'mission.duration.nin',
  'Duration of the mission stages Ninjutsu performs (-0.05 is 5% shorter)',
  {
    wired: true,
  },
);
add('mission.ryo', 'Ryo paid by a finished mission (0.05 is 5% more)', { wired: true });
add('power.sparring', 'Shinobi power units a finished sparring mission brings (1 is 100% more)', {
  wired: true,
});
add('mission.rep', 'Reputation paid by a finished team mission (0.05 is 5% more)', { wired: true });
add('interval.explore', 'Time to explore a cell (-0.05 is 5% shorter)', { wired: true });
add('interval.walk', 'Time of a walk to another cell (-0.05 is 5% shorter)', { wired: true });

// Field and crafts.
add('bush.stock', 'Herbs a bush holds before it must regrow (whole units)', {
  flat: true,
  wired: true,
});
add('bush.regrow', 'Regrow time of an empty bush (-0.1 is 10% shorter)', { wired: true });
add('gather.double', 'Chance of a second herb from one gather', { wired: true });
add('craft.keep', 'Chance that a craft keeps its ingredients, any skill', { wired: true });
add('craft.keep.alch', 'Chance that an Alchemy craft keeps its ingredients', { wired: true });
add('craft.keep.prov', 'Chance that a Provisions craft keeps its ingredients', { wired: true });
add('craft.double', 'Chance of one extra product from a craft', { wired: true });
add('craft.perfect', 'Chance of a perfect dish');
add('tonic.charges', 'Charges of a tonic (0.25 is 25% more)', { wired: true });

// Athletics course and Meditation.
add('obstacle.cost', 'Ryo cost of building an obstacle (-0.05 is 5% cheaper)', { wired: true });
add('obstacle.bonus', 'Size of the bonuses of built obstacles (0.02 is 2% larger)', {
  wired: true,
});
add('obstacle.penalty', 'Size of the penalties of built obstacles (-0.25 is 25% smaller)', {
  wired: true,
});
add('meditation.insightChance', 'Added chance of an Insight per meditation cycle', {
  flat: true,
  wired: true,
});
add('meditation.enlightChance', 'Added chance of an Enlightenment per meditation cycle', {
  flat: true,
  wired: true,
});

/** Every modifier key with its description. */
export const MODIFIER_KEYS: Readonly<Record<string, ModifierKeyInfo>> = registry;

/** Whether `key` is a registered modifier key. */
export const isModifierKey = (key: string): boolean => Object.hasOwn(registry, key);

/** One structured modifier of a content entity. */
export const modSchema = z.strictObject({
  key: z.string().refine(isModifierKey, { message: 'unknown modifier key' }),
  op: z.enum(['add', 'mul']),
  value: z.number().refine(Number.isFinite),
  /** The chakra nature the modifier belongs to; it is inactive until the player owns it. */
  nature: z.enum(NATURE_IDS).optional(),
});
export type Mod = z.infer<typeof modSchema>;

/** An obstacle modifier says which side of the obstacle it is on, so the scaling keys know what to resize. */
export const obstacleModSchema = modSchema.extend({ side: z.enum(['bonus', 'penalty']) });
export type ObstacleMod = z.infer<typeof obstacleModSchema>;
