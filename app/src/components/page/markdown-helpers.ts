// markdown-helpers.ts —— pure helpers for chat markdown, so the .tsx stays branch-free.

import type { ReactNode } from 'react';

export function isMermaidCode(className: string): boolean {
  return className.replace(/^language-/, '') === 'mermaid';
}

// escapeCurrencyDollars —— escapes a "currency $" to \$ so remark-math doesn't
// eat the text between two dollar amounts as inline math (#36/#40:
// "$100 ... $200").
//
// **The test is pairing, not "is a digit next."** The previous rule was the
// latter (`\$(?=\d)`), so it escaped every inline formula that starts with a
// digit — e.g. the opening `$` in `$0<h_1<h_2$` got killed, and its closing
// `$` became the start of the next segment, throwing off every pairing after
// it: the visitor reads a run of `\varphi`, `\le`, and `$` in the middle of a
// proof, with surrounding words glued into `dividingby` (F-R-4, from a real
// vault note, adaptive-commitment-value). A rule written for one class
// quietly ate the neighboring class, and the damage wasn't limited to that
// one spot — it corrupted the rest of the paragraph.
//
// The current rule: a `$` followed by a digit only counts as currency when
// **no `$` later on the same line can close it**. "Can close" means that `$`
// is not preceded by whitespace (remark-math's own closing condition) and not
// followed by an alphanumeric (otherwise it's the next amount's `$`). So:
//   "$100 up front and $200"  → candidate closer is preceded by a space → no pair → both are currency ✓
//   "$0<h_1<h_2$, $t=…$"      → closer preceded by `2`, followed by `,` → pairs → it's math, leave it ✓
export function escapeCurrencyDollars(md: string): string {
  return md.replace(
    /(?<![\\$])\$(?=\d)/g,
    (m: string, offset: number, whole: string) =>
      hasInlineCloser(whole, offset) ? m : `\\${m}`,
  );
}

// hasInlineCloser —— does the `$` at openAt have a `$` later on the same line that can close it?
function hasInlineCloser(text: string, openAt: number): boolean {
  const lineEnd = lineEndFrom(text, openAt);
  for (let i = openAt + 1; i < lineEnd; i += 1) {
    if (text[i] === '$' && closesMath(text, i)) return true;
  }
  return false;
}

// closesMath —— not preceded by whitespace (remark-math's closing condition),
// not followed by an alphanumeric (a `$` right before an alphanumeric is the
// start of the next segment, not this segment's close).
function closesMath(text: string, at: number): boolean {
  const before = text[at - 1] ?? ' ';
  const after = text[at + 1] ?? ' ';
  return !/\s/.test(before) && !/[0-9A-Za-z]/.test(after);
}

function lineEndFrom(text: string, from: number): number {
  const at = text.indexOf('\n', from);
  return at === -1 ? text.length : at;
}

// promoteDisplayMath —— Obsidian treats a single-line `$$…$$` as **display**
// (block-level, centered) math; remark-math v6+ instead treats a single-line
// `$$x$$` as **inline** → no `.katex-display` → tall formulas (sums/fractions
// with sub/superscripts) overlap the adjacent text line (F-R-3, seen
// throughout the real vault at `wiki/math/analysis/lagrangian`). Before
// rendering, promote any line that is entirely one `$$…$$` (optionally with a
// blockquote `>` prefix) from start to end into fenced form (`$$` each on
// their own line), so remark-math takes the display branch. A multi-line
// `$$` block (`$$` already on its own line) and inline `$…$` both don't match.
export function promoteDisplayMath(md: string): string {
  return md.replace(
    /^([ \t]*(?:>[ \t]?)*)\$\$(?!\$)(.+?)\$\$[ \t]*$/gm,
    (_m, prefix: string, body: string) => `${prefix}$$\n${prefix}${body.trim()}\n${prefix}$$`,
  );
}

export function mermaidSource(children: ReactNode): string {
  return typeof children === 'string' ? children
    : Array.isArray(children) ? joinChildArray(children)
    : '';
}

function joinChildArray(children: readonly unknown[]): string {
  return children.map((c) => typeof c === 'string' ? c : '').join('');
}
