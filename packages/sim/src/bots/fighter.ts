import type { Boss, Enemy, SkillId, Zone } from '@shinobi/content';
import { moneyOf } from '@shinobi/core';
import {
  COURSE_KIND,
  defeatsKey,
  entryOf,
  evalReq,
  isSkillUnlocked,
  listSkillActions,
  planPouch,
  pouchUse,
  skillLevel,
  targetOf,
  zoneBlocked,
  zoneRequirement,
  type ActionInfo,
  type Command,
} from '@shinobi/core';
import type { Bot, BotContext } from '../bot.ts';
import { combatSkills, KIND_FIGHT, styleSkills } from '../constants.ts';
import { fightSnapshot, encounterOf, runFights } from '../fights.ts';

const MINUTE = 60_000;

/** Knobs of the strategy, in one place. The bot names no content ids. */
const FIGHTER = {
  /** Estimated win rate a zone needs before the bot fights in it. */
  minWinRate: 0.9,
  /** Fights per estimate, and the seed they are drawn from. */
  estimateRuns: 16,
  estimateSeed: 7,
  /** Game time spent fighting, then training, before the bot looks at the zones again. */
  fightBlockMs: 30 * MINUTE,
  trainBlockMs: 10 * MINUTE,
  /** Wound stacks from which the bot rests (trains) until they heal. */
  restFromWounds: 3,
  /** A zone the bot lost in is left alone this long. */
  banMs: 30 * MINUTE,
  /** Zones whose enemy is above this multiple of the player's combat level (plus a margin) are not even estimated. */
  reachFactor: 1.6,
  reachMargin: 5,
  reviewMs: MINUTE,
} as const;

type Mode = 'fight' | 'train';

/**
 * Fighter bot: from a Genin state it fights the highest open zone whose estimated win rate is at
 * least 0.9, trains the weakest combat skill between fighting blocks (and when no zone is safe,
 * or Wounds are high), keeps the pouch stocked from the shop and lets the automatic loadout pick
 * the techniques. It returns commands only; the win rate it estimates comes from the engine's own
 * fight loop on the state as it is now.
 */
export function createFighterBot(): Bot {
  const estimates = new Map<string, number>();
  const bans = new Map<string, number>();
  const lastDefeats = new Map<string, number>();
  let mode: Mode = 'fight';
  let since = 0;
  let lastNow = 0;

  return {
    name: 'fighter',
    description: 'Боєць: від Геніна б’ється в найвищій безпечній зоні, між боями тренується.',
    goal: { label: 'без цілі', reached: () => false },
    reviewMs: FIGHTER.reviewMs,

    decide({ state, content, rules }: BotContext): Command[] | null {
      // A new run starts at an earlier game time than the last one ended: forget the old run.
      if (state.now < lastNow) {
        estimates.clear();
        bans.clear();
        lastDefeats.clear();
        mode = 'fight';
        since = 0;
      }
      lastNow = state.now;
      const commands: Command[] = [];
      const running = state.slots[0]?.action ?? null;

      // Remember where the player lost: that zone rests for a while.
      for (const zone of content.zones) {
        const lost = state.counters[defeatsKey(zone.enemy)] ?? 0;
        if (lost > (lastDefeats.get(zone.id) ?? 0)) bans.set(zone.id, state.now + FIGHTER.banMs);
        lastDefeats.set(zone.id, lost);
      }

      const levelOf = (id: SkillId) => skillLevel(state, id, content);
      const style = Math.max(...styleSkills(content).map(levelOf));
      const defence = combatSkills(content).map(levelOf);
      const power = defence.reduce((a, b) => a + b, style) / (defence.length + 1);
      const reach = power * FIGHTER.reachFactor + FIGHTER.reachMargin;

      const fingerprint = [
        ...content.skills.map((s) => levelOf(s.id)),
        Object.keys(state.known).length,
        state.loadouts.active.join(','),
        state.pouch.slots.map((s) => s.id).join(','),
        state.wounds.stacks,
      ].join('.');
      const estimate = (zone: Zone, entry: Enemy | Boss): number => {
        const key = `${zone.id}|${fingerprint}`;
        let rate = estimates.get(key);
        if (rate === undefined) {
          rate = runFights(
            fightSnapshot(state, entry.id, content, rules),
            encounterOf(state, entry, content),
            FIGHTER.estimateRuns,
            FIGHTER.estimateSeed,
            content,
            rules,
          ).winRate;
          if (estimates.size > 5000) estimates.clear();
          estimates.set(key, rate);
        }
        return rate;
      };

      // The highest open zone that looks safe.
      let best: { zone: Zone; entry: Enemy | Boss } | null = null;
      const candidates = content.zones
        .flatMap((zone) => {
          const entry = entryOf(content, zone.enemy);
          return entry ? [{ zone, entry }] : [];
        })
        .sort((a, b) => b.entry.cl - a.entry.cl);
      for (const c of candidates) {
        if (c.entry.cl > reach || (bans.get(c.zone.id) ?? 0) > state.now) continue;
        if (zoneBlocked(state, c.zone, content)) continue;
        const req = zoneRequirement(c.zone);
        if (req && !evalReq(state, req, content).met) continue;
        if (estimate(c.zone, c.entry) >= FIGHTER.minWinRate) {
          best = c;
          break;
        }
      }

      // Fight and train in blocks; rest while Wounds are high; train when nothing is safe.
      const resting = state.wounds.stacks >= FIGHTER.restFromWounds;
      let want: Mode = mode;
      if (!best || resting) want = 'train';
      else if (mode === 'train' && state.now - since >= FIGHTER.trainBlockMs) want = 'fight';
      else if (mode === 'fight' && state.now - since >= FIGHTER.fightBlockMs) want = 'train';
      if (want !== mode) {
        mode = want;
        since = state.now;
      }

      let action: { kind: string; id: string } | null = null;
      if (mode === 'fight' && best) action = { kind: KIND_FIGHT, id: best.zone.id };
      else {
        let pick: ActionInfo | null = null;
        let pickLevel = Infinity;
        for (const skill of content.skills) {
          if (!isSkillUnlocked(state, skill.id, content)) continue;
          const lv = levelOf(skill.id);
          if (lv >= pickLevel) continue;
          let top: ActionInfo | null = null;
          for (const info of listSkillActions(state, skill.id, content, rules)) {
            if (info.kind === COURSE_KIND || !info.available) continue;
            if (!top || info.xpPerHour > top.xpPerHour) top = info;
          }
          if (top) {
            pick = top;
            pickLevel = lv;
          }
        }
        if (pick) action = { kind: pick.kind, id: pick.id };
      }

      // Shop and pouch: stock what the plan for the zone's enemy would carry.
      const stack = content.balance.K.pouchStack;
      const target = best ? targetOf(state, best.entry.id, content) : null;
      const offered = content.shop.flatMap((s) => {
        const item = content.items.find((i) => i.id === s.item);
        if (!item || pouchUse(item) === null) return [];
        return evalReq(state, s.req, content).met ? [item.id] : [];
      });
      const hypothetical = { ...state.bank };
      for (const id of offered) hypothetical[id] = Math.max(hypothetical[id] ?? 0, stack);
      const plan = planPouch(
        {
          bank: hypothetical,
          slots: state.pouch.slots.length,
          traits: target?.traits ?? [],
          loadout: state.loadouts.active,
        },
        content,
      );
      let ryo = state.currencies[moneyOf(content)] ?? 0;
      const buys: Command[] = [];
      const bought = new Set<string>();
      for (const { id } of plan) {
        if (!offered.includes(id)) continue;
        const held = state.pouch.slots.find((s) => s.id === id)?.n ?? 0;
        const need = stack - held - (state.bank[id] ?? 0);
        const price =
          content.balance.K.goods[content.items.find((i) => i.id === id)?.buy ?? ''] ?? 0;
        const n = price > 0 ? Math.min(need, Math.floor(ryo / price)) : 0;
        if (n < 1) continue;
        ryo -= n * price;
        buys.push({ type: 'shop.buy', item: id, n });
        bought.add(id);
      }
      const empty = state.pouch.slots.flatMap((s, i) => (s.id === '' ? [i] : []));
      const sets: Command[] = [];
      for (const { id } of plan) {
        if (state.pouch.slots.some((s) => s.id === id)) continue;
        if ((state.bank[id] ?? 0) < 1 && !bought.has(id)) continue;
        const slot = empty.shift();
        if (slot !== undefined) sets.push({ type: 'pouch.set', slot, item: id });
      }

      const same = action && running?.kind === action.kind && running.id === action.id;
      if (same && sets.length === 0) return buys.length > 0 ? buys : null;
      // The pouch is packed between fights: a running fight stops first when slots are to be filled.
      if (sets.length > 0 && state.combat) commands.push({ type: 'action.stop', slot: 0 });
      commands.push(...buys, ...sets);
      if (action && (!same || sets.length > 0)) {
        commands.push({ type: 'action.start', slot: 0, kind: action.kind, id: action.id });
      }
      return commands.length > 0 ? commands : null;
    },
  };
}

/** The instance the CLI registry holds; it forgets a finished run when a new one starts at an earlier game time. */
export const fighterBot: Bot = createFighterBot();
