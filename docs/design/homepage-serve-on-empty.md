# Q1 — Homepage: serve the default on-empty, not a stored build

Status: **design 2026-09-06.** Owner: "我 homepage 从没编辑过,就该永远是空的,default 时判空然后
default 的啊;你不会把 default 当数据填进数据库了吧?"

## Root cause (confirmed, evidence)
`backend/internal/owner/usecase/default_homepage.go` `InstallDefaultHomepage` runs at claim: it
**writes the default `App.tsx` into the owner's storage** as the reserved `home` microsite draft;
`microsite_autopublish.go` then builds + promotes it. So the owner's `home` is a **materialized copy
frozen at claim-time's code** — a second source of truth (violates 十条 #1/#2). sijie was claimed at
an old version → its `home` is the old horizontal, pre-`@source`-fix build. Widget code + its test
(`default-homepage-cards-expand-inline` → `flexDirection:column`) are correct; the artifact is stale.

Serve path: `/` → `serveHomepage` → `serveSlugAt(HomepageSlug,"/")` → `ResolveLiveBuild(home)`; no
live home → 404 → app shows the minimal `HomeFallback`. The rich default only exists as the frozen
build.

## Target architecture
Owner's `home` storage is **empty until they actually edit**. The rich default homepage is a
**prebuilt artifact that ships in the instance image** (built at release from `defaulthomepage/App.tsx`
against the current SDK), served when `home` is empty. So the default always tracks the code, never
enters the owner's DB, and every instance upgrade refreshes it for free.

## Implementation plan (staged; each stage green before the next)
1. **Build the default at release into the image.** A make target builds `defaulthomepage/App.tsx`
   (same builder path microsites use, current SDK) → a static bundle; `go:embed` it into the backend
   (or ship under the app image's assets). Output: an embedded `defaultHomeBuild` (html+assets).
2. **Serve-on-empty.** `serveSlugAt` for the reserved `home`: if `ResolveLiveBuild(home)` is
   not-found/empty → serve the embedded `defaultHomeBuild` (200), instead of 404→fallback. Owner's own
   live home (when present) still wins.
3. **Stop materializing at claim.** Remove `InstallDefaultHomepage` + the autopublish-of-default;
   claim leaves `home` empty. (Keep the reserved-slug reservation.)
4. **sijie remediation.** Its `home` is a stale materialized row → clear it (via the product MCP:
   delete/empty the `home` page) so it falls to the served-from-image default. Verify live: `/`
   renders the current default (vertical, limited).
5. Rework the home e2e that asserted the old materialization (see Test plan).

## Test plan (test-first, RED-reachable)
### Unit / integration (Go)
- **T1 serve-on-empty:** a claimed instance with an **empty** `home` → `GET /api/v1/homepage` returns
  200 with the embedded default's HTML (assert a default-template marker). RED today (404).
- **T2 owner override:** a live owner `home` build → `/homepage` serves the owner's, not the default.
- **T3 claim leaves home empty:** after claim, `home` has no draft/build (assert storage empty). RED
  today (InstallDefaultHomepage wrote a draft).
- **T4 default tracks code (the anti-stale guard):** build the image default from a template with a
  changed marker → the served default contains the NEW marker. Proves it is not frozen. This is the
  guard the whole change exists for — must go RED on a materialized/frozen default.
### E2E (Playwright, artifact/geometry)
- **T5 vertical + limited on a fresh instance:** the default homepage (unedited) renders the corpus
  cards `flex-direction:column` and ≤ limit — **reusing/replacing** `default-homepage-cards-expand-inline`,
  but now on the served-from-image default (no build-install step). Catches the horizontal regression
  at the served layer, not just a fresh build.
- **T6 inline expand still works** on the served default (carry over).
### Rework / retire
- `default-homepage-installed-on-claim` + `homepage-auto-goes-live-at-claim`: rewrite to assert the
  NEW contract (claim leaves home empty; `/` serves the image default), or retire.
## Open decision
Embed in the **backend** image (go:embed the built bundle) vs the **app** image (Next public asset,
served when backend reports empty). Recommend **backend embed** — one authority for "what `/` serves",
matches the existing `serveHomepage` seam.
