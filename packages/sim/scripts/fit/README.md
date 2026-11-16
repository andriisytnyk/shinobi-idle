# Fit harness for the fight loop

Finds the pacing and rating numbers of the balance so that the fights meet the design bands. It mutates the
numbers of the loaded content in place (nothing is written until `apply.mjs`), so a pass is cheap.

## Objective (`fit.ts`, `evaluate`)

A penalty, the sum of:

1. Yardsticks A (one nature), B (all natures), C (chunin, shop pouch, food), D (genin at any level), every entry
   of `pnpm sim fight --all`, against the baseline of 3f559af in `docs/balance-evidence/baseline-dev-3f559af-*.json`:
   regular enemies win >= 97% (C: 95%), mean duration within +-20% of the baseline (C: 25%), the basic strike
   at most 40% of the damage with a full hand.
2. Hit-chance bands (`../hit-curves.ts`): for a typical character against a regular enemy of its level, the enemy
   hits 52-68%, the player hits 77-89%, a character that neglects the defensive techniques is hit clearly more
   often, one that maxes them clearly less. "Typical" means the mastery derived from the hours of play
   (`typicalDefenceMastery` in `src/character.ts`: 15% of the practice time to the defensive techniques known).
3. Bosses (`boss.ts`, the relationships of `packages/core/test/bosses.test.ts`): a prepared character at the boss's
   level wins 55-90%; four levels below at most 0.6 of that rate; knowledge, empty pouch and nature margins.
4. The hunter tipping curve (`tipping`): the win rate by level against the baseline curve, shifted by up to two
   levels, and `stable` (>= 0.95) reached by level 50.

Not in the objective (run them after a pass): sustained two-hour zones, the analysis tests, the speed budgets,
`pnpm sim academy --seed 1 --runs 3` (45-75 minutes), zone XP per skill (`docs/balance-evidence/tools/measure-zone-xp.ts.txt`).

## Run a pass

```
pnpm --filter @shinobi/sim exec tsx scripts/fit/fit.ts '{}' 40        # score the current numbers, 40 runs per row
pnpm --filter @shinobi/sim exec tsx scripts/fit/opt.ts 30 4            # coordinate descent: 30 runs, 4 rounds
node packages/sim/scripts/fit/apply.mjs                                # write opt-best.json into balance.mjs, patch.mjs, ai.json
pnpm content:import                                                    # regenerate content from the docs
pnpm --filter @shinobi/sim exec tsx scripts/hit-curves.ts              # the hit-chance table
```

Knobs are multipliers on the numbers the content has when the harness starts (see `DEFAULTS` and `BOUNDS`).
One evaluation takes about 3-5 s; a round over ~30 knobs x 6 steps is about 10-15 minutes; a pass of 4 rounds
about an hour. Run it from a terminal, stop it with Ctrl+C; `opt-best.json` is rewritten after every round.
The AI tier thresholds (`ai.enemyTier`) and the rating formulas' structure are design, not knobs.
