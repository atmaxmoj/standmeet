// card-theme.ts —— the host page's design tokens, handed to a sandboxed ui:// card so it matches
// the page. A card lives in an iframe: it can't see the page's CSS or its light/dark state, so a
// card with its own hardcoded light palette rendered dark-on-dark on a dark page (prod 2026-09-25).
// Both hosts (the app's main chat and the SDK's AgentWidget) send this in `mcp-ui:data` as `theme`;
// a card maps it onto its own CSS variables and keeps its built-in colors as the fallback.

const TOKENS = ['ink', 'paper', 'surface', 'accent', 'muted', 'rule', 'faint'] as const;

export type CardTheme = Partial<Record<(typeof TOKENS)[number], string>>;

// pageCardTheme —— the page's current --color-* values (computed, so a dark-mode override is what
// comes back). Tokens the page doesn't define are left out. {} outside a browser.
export function pageCardTheme(): CardTheme {
  if (typeof document === 'undefined') return {};
  const css = getComputedStyle(document.documentElement);
  const out: CardTheme = {};
  for (const t of TOKENS) {
    const v = css.getPropertyValue(`--color-${t}`).trim();
    if (v !== '') out[t] = v;
  }
  return out;
}
