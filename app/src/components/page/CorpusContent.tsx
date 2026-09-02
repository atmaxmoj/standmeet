// CorpusContent —— the corpus body container + owner custom CSS mount point.
//
// Owner CSS is dynamic (per-owner, sourced from the DB); the backend has
// already sanitized it (strips @import / external url / expression / js)
// and scoped it (prefixes every selector with `.corpus-content`), and serves
// it as a **real stylesheet resource** at `/api/v1/appearance.css`
// (text/css). This component references it with a <link> (rather than an
// inline <style>), then wraps the body in `.corpus-content` (plus a
// per-note `cssclasses` presentation hook). The owner's Obsidian snippet
// renders exactly as defined, so the vault and the StandMeet page "look
// identical on both sides." Next hoists + dedupes <link> tags sharing the
// same href.

import type { ReactNode } from 'react';

// APPEARANCE_CSS —— relative path (same-origin in the browser; Next rewrites `/api/*` to the backend).
const APPEARANCE_CSS = '/api/v1/appearance.css';

export function CorpusContent({ classes, children }: {
  classes?: readonly string[];
  children: ReactNode;
}) {
  // Two layers: .corpus-content is the scope anchor (every owner CSS
  // selector is prefixed with it), and per-note cssclasses go on the
  // **inner** div — that way an owner-written `.theorem{…}`, scoped to
  // `.corpus-content .theorem`, can still hit the inner element (a class on
  // the same layer as .corpus-content would be missed by the descendant
  // prefix).
  const inner = (classes ?? []).join(' ');
  return (
    <>
      <link rel="stylesheet" href={APPEARANCE_CSS} />
      <div className="corpus-content">
        {inner ? <div className={inner}>{children}</div> : children}
      </div>
    </>
  );
}
