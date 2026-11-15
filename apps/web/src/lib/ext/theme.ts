/** What applying a theme needs: its token overrides and, optionally, extra CSS. */
export interface ThemeLike {
  tokens: Readonly<Record<string, string>>;
  css?: string;
}

/** Puts the stylesheets of packs into the page, one `<style>` each; applying again replaces them. */
export function createStyleInjector(doc: Document) {
  let nodes: HTMLStyleElement[] = [];
  return {
    apply(sheets: readonly { packId: string; css: string }[]): void {
      for (const node of nodes) node.remove();
      nodes = sheets.map((sheet) => {
        const style = doc.createElement('style');
        style.setAttribute('data-ui-pack', sheet.packId);
        style.textContent = sheet.css;
        doc.head.append(style);
        return style;
      });
    },
  };
}

/** Marks the `<style>` element that carries the CSS of the applied theme. */
export const THEME_STYLE_ATTR = 'data-ui-theme';

/**
 * Applies one theme at a time to a root element. The overrides are set on the element, so they win
 * over `tokens.css`; switching removes every one of them and the injected `<style>`, which
 * restores the base look exactly.
 */
export function createThemeApplier(root: HTMLElement) {
  let applied: string[] = [];
  let style: HTMLStyleElement | null = null;

  function clear(): void {
    for (const name of applied) root.style.removeProperty(name);
    applied = [];
    style?.remove();
    style = null;
  }

  return {
    /** Replaces the applied theme; `null` returns to the base look. */
    apply(theme: ThemeLike | null): void {
      clear();
      if (!theme) return;
      for (const [name, value] of Object.entries(theme.tokens)) {
        root.style.setProperty(name, value);
        applied.push(name);
      }
      if (theme.css) {
        style = root.ownerDocument.createElement('style');
        style.setAttribute(THEME_STYLE_ATTR, '');
        style.textContent = theme.css;
        root.ownerDocument.head.append(style);
      }
    },
    dispose: clear,
  };
}
