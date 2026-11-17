/** Parts whose `data-entity` names an entity that is only mentioned there, not the one the element stands for. */
const MENTIONS = new Set([
  'pin-goal',
  'req-row',
  'ingredient-row',
  'mission-reward',
  'entity-page',
  'sheet',
]);

/** The element of the page that stands for an entity (its tile, row or card), or null. */
export function findTile(root: ParentNode, entity: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-entity]')) {
    if (el.getAttribute('data-entity') !== entity) continue;
    if (MENTIONS.has(el.getAttribute('data-ui') ?? '')) continue;
    // A tile inside the sheet or inside another entity's page is not the one that opened it.
    if (el.closest('[data-ui="sheet"]')) continue;
    return el;
  }
  return null;
}

/**
 * Marks the tile of an entity on the parent page (`data-highlighted`) and brings it into view. A page
 * that draws its tiles late (a widget, a panel) is watched until the tile appears. Returns the cleanup.
 */
export function highlightTile(root: HTMLElement, entity: string): () => void {
  let marked: HTMLElement | null = null;
  const apply = (): boolean => {
    const tile = findTile(root, entity);
    if (!tile) return false;
    if (tile !== marked) {
      marked?.removeAttribute('data-highlighted');
      marked = tile;
      tile.setAttribute('data-highlighted', '');
      tile.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    return true;
  };
  const watcher = new MutationObserver(() => {
    if (apply()) watcher.disconnect();
  });
  if (!apply()) watcher.observe(root, { childList: true, subtree: true });
  return () => {
    watcher.disconnect();
    marked?.removeAttribute('data-highlighted');
  };
}
