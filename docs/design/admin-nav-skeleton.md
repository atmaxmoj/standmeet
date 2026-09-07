# Q2 — Admin nav / editor click latency → instant nav + skeleton

Status: **design 2026-09-06.** Owner: "nav 点了有时好久才变,该点了立即变;微站编辑有 skeleton 了但点了
好久才跳到 skeleton,仔细看怎么回事。" + "你可能需要 ut 才能细到真问题去。"

## Root cause — two distinct sub-problems (don't conflate)
The owner reports TWO things; an e2e "it's slow" can't tell them apart — so we pin each with a
**unit-level** test that names the exact defect.

**(a) Section nav has no loading boundary → server-blocking navigation.**
admin has ~30 section routes (`/admin/raw|wiki|codes|conversations|…`); **only
`src/app/admin/edit/[slug]/loading.tsx` exists.** Clicking `<Link href=/admin/${slug}>`
(`AdminSidebar.tsx:131`) to a route with **no `loading.tsx`** makes Next fetch the RSC + run the
server component's data load **before swapping UI** — the old page stays, then it jumps. No skeleton.

**(b) `edit/[slug]` HAS a loading.tsx yet is "slow to even reach the skeleton".**
So (b) is a *different* cause, not the missing boundary. Candidate causes, to be isolated by test/trace:
- `<Link prefetch>` off / not warmed → first nav pays full RSC latency before the transition commits;
- an `await` (fetch/permission check) in the click handler or the source page BEFORE `router.push`,
  so navigation doesn't even start on click;
- a heavy shared `admin/layout.tsx` re-render without its own Suspense boundary.

## The UT that gets to the real problem (owner's point)
- **U-cov (structural, deterministic):** a test that enumerates every admin section route dir under
  `src/app/admin/*` and asserts each has a `loading.tsx` (or is covered by a shared boundary). This
  names EXACTLY which routes are missing a skeleton — no browser, no timing flake. RED today for ~29
  routes; the fix (add boundaries) turns it green and it stays a ratchet. **This is "细到真问题".**
- **U-nav (isolate sub-problem b):** a unit/component test of the nav-click path for `edit/[slug]`
  asserting the click triggers navigation SYNCHRONOUSLY (no `await` before `router.push`) — e.g. the
  handler calls push before any promise resolves. Pins whether (b) is an await-before-nav.

## Implementation plan (staged)
1. **U-cov RED → add loading boundaries.** Prefer ONE shared skeleton via a route group
   `src/app/admin/(sections)/loading.tsx` wrapping the section routes (a single AdminSectionSkeleton),
   rather than 29 files. If the current flat layout can't group cleanly, add per-section `loading.tsx`
   re-exporting a shared `<AdminSectionSkeleton/>`. Turn U-cov green.
2. **Skeleton component:** `AdminSectionSkeleton` matching each section's chrome (heading + list/table
   placeholder) so the jump is to a real-looking frame, not a spinner.
3. **Sub-problem (b):** confirm via U-nav / a trace which cause; if prefetch — ensure `<Link>` prefetch
   on (default true in prod; verify not disabled) + warm on hover; if await-before-nav — move the await
   AFTER navigation (navigate first, fetch under the skeleton).
4. Verify no route regressed to server-blocking (U-cov ratchet holds).

## Test plan (test-first, RED-reachable)
### Unit (the "real problem" layer)
- **U-cov** (above): every admin section route has a loading boundary. RED on the current tree.
- **U-nav** (above): the editor nav-click starts navigation without awaiting.
### E2E (Playwright, timing/behaviour)
- **E-skel:** click a section in the sidebar → a `data-testid="admin-section-skeleton"` is visible
  **within ~200ms** (i.e. before the section's data can plausibly have loaded) → then the real content
  replaces it. RED today (no skeleton appears; the old page lingers).
- **E-edit:** click into the microsite editor → the editor skeleton appears promptly (≤ ~200ms),
  guarding sub-problem (b).
- **RED-reachability:** removing a route's loading boundary must fail U-cov + E-skel for that route.

## Notes
- The instant-nav + skeleton is exactly the App Router idiom (loading.tsx = Suspense fallback shown
  immediately on navigation). The bug is simply that it was only wired for one route.
- Keep the skeleton deterministic (fixed shape) so E-skel isn't flaky.
