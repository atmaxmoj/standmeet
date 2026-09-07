// admin-loading-coverage.test.ts —— Q2, the UT that pins the REAL problem (owner: "需要 ut 才能细到
// 真问题去"): WHICH admin section routes have no loading boundary. Without one, clicking a sidebar
// <Link> to a section makes Next hold the old screen until the RSC + data arrive (no skeleton, "点了
// 好久才变"). A shared `admin/loading.tsx` is the Suspense fallback for every section rendered in
// admin/layout's {children}. This test enumerates the section routes and asserts each is covered —
// deterministic, no browser, no timing flake. RED before admin/loading.tsx exists.

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ADMIN_DIR = fileURLToPath(new URL('.', import.meta.url)); // .../src/app/admin

function hasLoading(dir: string): boolean {
  return existsSync(`${dir}/loading.tsx`) || existsSync(`${dir}/loading.jsx`);
}

// sectionRoutes —— every admin child dir that is a real route (has a page.tsx). Dynamic segments
// (edit/[slug]) included; they may carry their own loading.tsx.
function sectionRoutes(): string[] {
  return readdirSync(ADMIN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(`${ADMIN_DIR}/${name}/page.tsx`));
}

describe('admin section navigation has a loading boundary (Q2)', () => {
  it('a shared admin/loading.tsx exists — the skeleton for every section swap', () => {
    expect(hasLoading(ADMIN_DIR), 'admin/loading.tsx must exist as the shared Suspense fallback')
      .toBe(true);
  });

  it('every section route is covered (shared admin/loading.tsx, or its own loading.tsx)', () => {
    const sharedCovers = hasLoading(ADMIN_DIR);
    const uncovered = sectionRoutes()
      .filter((name) => !sharedCovers && !hasLoading(`${ADMIN_DIR}/${name}`));
    expect(uncovered, `admin section routes with NO loading boundary: ${uncovered.join(', ') || 'none'}`)
      .toEqual([]);
  });
});
