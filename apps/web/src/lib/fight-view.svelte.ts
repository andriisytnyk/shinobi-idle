/** Which performer's fight the page shows when several run: chosen on the fight screen, read by the battle log. */
let chosen = $state(0);

export const fightView = {
  get chosen(): number {
    return chosen;
  },
  set chosen(slot: number) {
    chosen = slot;
  },
  /** The slot whose fight is shown: the chosen one while it fights, else the first that does. */
  shown(fighters: readonly number[]): number {
    return fighters.includes(chosen) ? chosen : (fighters[0] ?? 0);
  },
};
