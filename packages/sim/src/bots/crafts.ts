import type { Recipe, SkillId } from '@shinobi/content';
import {
  buyPrice,
  evalReq,
  isSkillUnlocked,
  listSkillActions,
  sellPrice,
  skillLevel,
  type ActionInfo,
  type Command,
} from '@shinobi/core';
import type { Bot, BotContext } from '../bot.ts';
import { KIND_CRAFT as CRAFT, KIND_GATHER as GATHER } from '../constants.ts';

/** Knobs of the strategy, in one place. The bot names no content ids. */
const CRAFTS = {
  /** Crafts planned per round: the herbs for this many are gathered before the first is made. */
  batch: 20,
  /** Ryo the bot will not spend on goods while a better recipe is on offer. */
  cashFloor: 20,
  reviewMs: 2000,
} as const;

/**
 * Crafts bot: a peaceful player. It trains the lowest of its trade skills (the skills that have
 * gather or craft actions) with the action that pays the most XP, gathers the herbs a recipe
 * needs, buys the goods it lacks, crafts a batch, and sells every craft product. It never
 * fights. When the goods of a recipe cost more than it has, it takes the best recipe it can pay
 * for, and gathers while nothing can be crafted.
 */
export function createCraftsBot(): Bot {
  return {
    name: 'crafts',
    description: 'Ремісник: збирає, варить, продає вироби; без боїв.',
    goal: { label: 'без цілі', reached: () => false },
    reviewMs: CRAFTS.reviewMs,

    decide({ state, content, rules }: BotContext): Command[] | null {
      const commands: Command[] = [];
      const running = state.slots[0]?.action ?? null;

      // Sell every craft product the bank holds.
      const products = new Set(content.recipes.map((r) => r.output.item));
      let ryo = state.currencies.ryo;
      for (const [item, n] of Object.entries(state.bank)) {
        if (n < 1 || !products.has(item)) continue;
        const price = sellPrice(item, content);
        if (price === null) continue;
        commands.push({ type: 'shop.sell', item, n });
        ryo += price * n;
      }

      // A craft in progress is let to run: it stops by itself when an ingredient runs out.
      if (running?.kind === CRAFT) return commands.length > 0 ? commands : null;

      // The trade skills and the lowest of them.
      const actionsOf = new Map<SkillId, ActionInfo[]>();
      for (const skill of content.skills) {
        if (!isSkillUnlocked(state, skill.id, content)) continue;
        const list = listSkillActions(state, skill.id, content, rules).filter(
          (a) => a.kind === GATHER || a.kind === CRAFT,
        );
        if (list.length > 0) actionsOf.set(skill.id, list);
      }
      let lowest: SkillId | null = null;
      for (const id of actionsOf.keys()) {
        if (
          lowest === null ||
          skillLevel(state, id, content) < skillLevel(state, lowest, content)
        ) {
          lowest = id;
        }
      }
      if (lowest === null) return commands.length > 0 ? commands : null;

      const herbs = new Map<string, ActionInfo>();
      for (const list of actionsOf.values()) {
        for (const a of list) if (a.kind === GATHER && a.available) herbs.set(a.id, a);
      }
      const bestHerb = [...herbs.values()].reduce<ActionInfo | null>(
        (best, a) => (!best || a.xpPerHour > best.xpPerHour ? a : best),
        null,
      );
      const goodPrice = (item: string): number | null => {
        const entry = content.shop.find((s) => s.item === item);
        if (!entry || !evalReq(state, entry.req, content).met) return null;
        return buyPrice(item, content);
      };

      // The recipes the bot can make now, the lowest skill first and the best XP first within a skill.
      interface Plan {
        info: ActionInfo;
        recipe: Recipe;
        goods: number;
        net: number;
      }
      const plans: Plan[] = [];
      for (const [skill, list] of actionsOf) {
        const level = skillLevel(state, skill, content);
        for (const info of list) {
          if (info.kind !== CRAFT || info.level > level) continue;
          const recipe = content.recipes.find((x) => x.id === info.id);
          if (!recipe) continue;
          let goods = 0;
          let supplied = true;
          for (const i of recipe.ingredients) {
            if (herbs.has(i.item)) continue;
            const price = goodPrice(i.item);
            if (price === null) supplied = false;
            else goods += price * i.n;
          }
          if (!supplied) continue;
          const made = sellPrice(recipe.output.item, content) ?? 0;
          plans.push({ info, recipe, goods, net: made * recipe.output.n - goods });
        }
      }
      const rank = (p: Plan) => skillLevel(state, p.recipe.skill, content);
      plans.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          b.info.xpPerHour - a.info.xpPerHour ||
          (a.info.id < b.info.id ? -1 : 1),
      );
      // Spend down to a cash floor on the best XP; when that leaves nothing, take recipes that do not lose ryo.
      let target: ActionInfo | null = null;
      let recipe: Recipe | null = null;
      let crafts = 0;
      const afford = (p: Plan, cash: number) =>
        p.goods === 0 ? CRAFTS.batch : Math.min(CRAFTS.batch, Math.floor(cash / p.goods));
      for (const p of plans) {
        const n = afford(p, ryo - CRAFTS.cashFloor);
        if (n < 1) continue;
        [target, recipe, crafts] = [p.info, p.recipe, n];
        break;
      }
      if (!recipe) {
        for (const p of plans) {
          const n = afford(p, ryo);
          if (n < 1 || p.net < 0) continue;
          [target, recipe, crafts] = [p.info, p.recipe, n];
          break;
        }
      }

      let next: { kind: string; id: string } | null = null;
      if (recipe && target) {
        // Goods first, then herbs, then the craft itself.
        let missingHerb: string | null = null;
        for (const i of recipe.ingredients) {
          const have = state.bank[i.item] ?? 0;
          const need = i.n * crafts - have;
          if (need <= 0) continue;
          if (herbs.has(i.item)) missingHerb ??= i.item;
          else {
            const price = goodPrice(i.item) ?? 0;
            commands.push({ type: 'shop.buy', item: i.item, n: need });
            ryo -= price * need;
          }
        }
        next = missingHerb ? { kind: GATHER, id: missingHerb } : { kind: CRAFT, id: recipe.id };
      } else if (bestHerb) {
        next = { kind: GATHER, id: bestHerb.id };
      }
      if (!next) return commands.length > 0 ? commands : null;
      const same = running?.kind === next.kind && running.id === next.id;
      if (!same) commands.push({ type: 'action.start', slot: 0, kind: next.kind, id: next.id });
      return commands.length > 0 ? commands : null;
    },
  };
}
