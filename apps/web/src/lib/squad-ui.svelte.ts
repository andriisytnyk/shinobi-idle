/**
 * What the player has picked in the squad: the performer the start buttons name, the clone whose
 * dispel awaits a confirmation, and the fight the fight screen shows. Display state only; the game
 * state is changed by commands.
 */
export function createSquadUi() {
  let picked = $state<number | null>(null);
  let dispelling = $state<number | null>(null);
  let sheet = $state(false);
  let fight = $state<number | null>(null);

  return {
    /** The performer picked on the map or in the panel, null for the default. */
    get picked(): number | null {
      return picked;
    },
    pick(id: number | null): void {
      picked = id;
    },
    /** The performer whose dispel awaits the player's answer. */
    get dispelling(): number | null {
      return dispelling;
    },
    askDispel(id: number): void {
      dispelling = id;
    },
    closeDispel(): void {
      dispelling = null;
    },
    /** Whether the phone's squad sheet is open. */
    get sheet(): boolean {
      return sheet;
    },
    setSheet(open: boolean): void {
      sheet = open;
    },
    /** The performer whose fight the fight screen shows; null for the first. */
    get fight(): number | null {
      return fight;
    },
    focusFight(id: number | null): void {
      fight = id;
    },
    reset(): void {
      picked = null;
      dispelling = null;
      sheet = false;
      fight = null;
    },
  };
}

export const squadUi = createSquadUi();
