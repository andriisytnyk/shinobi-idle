/** The one hint that is on screen; every other hint waits until it is dismissed or leaves the page. */
let current = $state<string | null>(null);

export const hintSlot = {
  get current(): string | null {
    return current;
  },
  /** Takes the slot when it is free; returns whether this hint now holds it. */
  claim(id: string): boolean {
    if (current === null || current === id) {
      current = id;
      return true;
    }
    return false;
  },
  release(id: string): void {
    if (current === id) current = null;
  },
};
