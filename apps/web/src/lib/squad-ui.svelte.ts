/**
 * What the player has picked in the squad: the performer the start buttons name, the clone whose
 * dispel awaits a confirmation. (The fight the fight screen shows is `fight-view.svelte.ts`.) Display state only; the game
 * state is changed by commands.
 */
export function createSquadUi() {
  let picked = $state<number | null>(null);
  let dispelling = $state<number | null>(null);
  let sheet = $state(false);
  let creating = $state<{ kind: string; id: string } | 'idle' | null>(null);

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
    /** The pouch picker for a new clone is open: with the action the clone is to take, or 'idle' for none. */
    get creating(): { kind: string; id: string } | 'idle' | null {
      return creating;
    },
    askClone(then?: { kind: string; id: string }): void {
      creating = then ?? 'idle';
    },
    closeClone(): void {
      creating = null;
    },
    /** Whether the phone's squad sheet is open. */
    get sheet(): boolean {
      return sheet;
    },
    setSheet(open: boolean): void {
      sheet = open;
    },
    reset(): void {
      picked = null;
      dispelling = null;
      sheet = false;
      creating = null;
    },
  };
}

export const squadUi = createSquadUi();
