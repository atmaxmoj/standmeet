// AdminSectionHead —— the heading for "one section" in the backend. **`.sm-section-h` may only
// come from here.**
//
// Why this component exists: this convention (12px + vermillion vertical bar + rule below) had
// to be patched in three times — UX-76 for `api·mcp`'s six major sections, 2026-08-16 for
// `system`'s sandbox panel, while `connectors` and the other five sections of `system` still
// don't have it. Every time it was "remember to add it", and every time some page got missed
// (UX-79).
//
// **Why a lint gate can't fix this**: a section heading and a field label are the same shape in
// the DOM (both mono + small + uppercase); the old signature `tracking-[0.18em]` appears 127
// times in app/src and is also used by visitor-side labels — scanning by signature only turns
// up noise. A gate can detect **shape**; the distinction here is **semantic**.
//
// With this component, the signature becomes a **class name**: `check-one-section-heading`
// only allows `.sm-section-h` to appear in this file and sm-atoms.css. **The convention finally
// has one home, and the gate finally holds**
// ([[reframes-tasks-into-enforced-invariants]]: make the mistake physically impossible, rather
// than write it into a doc).

// The shape covers two real usages: a bare heading, and "heading + a subtitle at the right end
// of the same rule". The latter (three call sites: MCP client / download / servers) used to
// each stuff a `<h3 class="mr-auto">` + a hand-copied span into `.sm-section-h` — by the third
// copy it had already drifted (the servers one used `tracking-normal`, the other two used
// `tracking-[0.06em]`). The subtitle's styling is folded in here too; callers only supply
// content.
//
// The heading is always `h3` (a section's heading **is** the heading; checked that no spec
// selects them via `getByRole('heading')`, so this is a uniform change that moves no assertion).
// `className` only accepts layout tweaks (`mb-3` / `grow`); the visuals are defined in exactly
// one place, `.sm-section-h`.

import type { ReactNode } from 'react';

const ASIDE_CLASS =
  'mono text-[10.5px] tracking-[0.06em] normal-case text-(--color-faint)';

export function AdminSectionHead(
  { children, aside, className = '' }:
  { children: ReactNode; aside?: ReactNode; className?: string },
) {
  return (
    <div className={`sm-section-h ${className}`}>
      <h3 className="mr-auto">{children}</h3>
      {aside === undefined ? null : <span className={ASIDE_CLASS}>{aside}</span>}
    </div>
  );
}
