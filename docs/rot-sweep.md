# Rot sweep — full inventory (2026-07-17)

**Prompted by:** the owner catching that "`/admin/skills` vs `/admin/agent-skills`" wasn't a nav
decision to punt back — it was rot to fix, and my first sweep was partial. This is the FULL sweep:
five parallel read-only agents, one per rot class, findings verified against code.

## The class

Every defect here is one shape: **something asserts a state it does not track.** A comment claims
"mocked", a chart shows a number nobody measured, a control looks like it persists, two doors lead to
one room, a test guards its only assertion behind `if visible` so it can never fail. Lint / tsc /
build are green through all of it — they check **shape**; the lie lives in **semantics**. A green
gate is not evidence.

Severity = **does the owner act on it?** A fabricated chart the owner makes a decision on is HIGH;
a stale line-number in a comment is LOW.

---

## Coverage ledger — every finding accounted for (re-checked 2026-07-17)

"별漏" pass: each finding maps to a **built test** (behavioral, gets RED→GREEN), a **no-test fix**
(comments/cleanup — a comment can't be e2e-tested), or **deferred** (needs a data source that doesn't
exist yet). Nothing is left un-tracked.

| # | finding | test built? | how it's handled |
|---|---|---|---|
| A1 | dashboard fake sparkline | ✅ `dashboard-corpus-pulse.spec.ts` | wire real `series` |
| A2 | résumé match/100 ignores JD | ✅ `resume-match-gauge.spec.ts` | JD-aware score or drop the claim |
| A3 | dashboard "shortlist" = hardcoded 0 | ⏸ deferred | tracked as check 2 in the dashboard item; needs a shortlist source |
| A4 | fake connector state → wrong hints | ✅ `marketplace-needs-connector.spec.ts` | read real connector state + carry `needs` |
| A5 | dead heat i18n copy | — cleanup | delete unused `skills.intro/heatEmpty` keys |
| B1–B5 | stale "mock/not-wired" comments | — no-test | correct the comments (a comment can't be tested) |
| B6 | "updates-available banner" false feature | — no-test | delete the claim (folds into D1 merge) |
| C1 | app status control doesn't persist | ✅ `application-status-persist.spec.ts` | make honest (read-only) or persist |
| C2 | "edit on domain" link 404s | ✅ `seo-domain-link.spec.ts` | point href at /admin/page |
| C3 | og:description hardcoded; "tagline" phantom field | ✅ `public-og-description.spec.ts` | generateMetadata from `hero_prose` |
| D1 | two doors to one skills registry | ✅ `skills-single-entrance.spec.ts` | merge into one tabbed /admin/skills |
| D2 | "public page" vs "pages" confusable | ✅ `nav-page-vs-pages.spec.ts` | rename (landing page / custom pages) |
| D3 | "api · mcp" one door, two MCP concepts | — no-test (LOW) | label split; manual note |
| D4 | app status vocab front↔back divergent | (covered by C1 test) | one vocabulary; folds into C1 fix |
| E1 | `skill-role-label` dead test | (the test IS the fix) | make real or remove |
| E2 | `skill-heat-bar` dead test | (the test IS the fix) | make real or remove |
| E3 | `citation-body` dead assertions | (the test IS the fix) | remove dead lines |
| E4 | `raw-filter-all` dead test (agent missed) | (the test IS the fix) | make real or remove |
| F1 | ~30 stale design line-refs | — cleanup | cite component name, drop line span |
| F2 | surplus exports | — cleanup | drop `export` |
| G1 | dead "rebuild" button (no onClick) | — cleanup | remove it; folds into D1 merge |

Behavioral findings with a built RED test: **8** (A1, A2, A4, C1, C2, C3, D1, D2). Everything else is
a comment/cleanup fix (no test possible) or deferred — all listed above so none is forgotten.

---

## A · Fabricated data rendered as real (owner decides on it)

### A1 · HIGH — dashboard "corpus pulse · 14d" sparkline is hardcoded, AND the real series exists
`DashboardSection.tsx:121-124` draws `<Sparkline data={MOCK_14D} label="corpus pulse · 14d">` from
`const MOCK_14D = [4,7,2,6,11,3,8,5,9,12,6,14,9,17]`, beside the real total and a green "active"
badge — reads as a genuine 14-day activity trend. Worse than the heat graph: the **real** series is
already fetched — `useAdminDashboard` → `/api/admin/stats/growth` returns `series:[{day,count}]`
(`use-corpus-growth.ts:22`) — and the dashboard reads only `by_tier`, throwing the real curve away to
draw the fake one. **Fix:** wire the sparkline to the real series; delete MOCK_14D.

### A2 · HIGH — résumé "match / 100" gauge never reads the job description
`draft-model.ts:143` `confidenceScore(model, DEFAULT_KEYWORDS) = min(0.98, 0.5 + hits*0.03)`, hits =
occurrences of a FIXED buzzword list (`retrieval, eval, llm, rag, brain, lucerna, launch`) in the
draft, floored at 50. Rendered by `ResumeComposer.tsx:148` as "match 74 / 100" next to Send, tooltip
"match against the job description" — but it never reads the JD. The owner reads this before pressing
Send on a real application. **Fix:** either compute a real JD-overlap score or remove the gauge +
its "against the job description" claim. Do not ship a 50%-floored buzzword count labelled "match".

### A3 · MEDIUM — dashboard "shortlist" KPI is a hardcoded `0`
`DashboardSection.tsx:140` renders a `0` styled identically to the sibling "sent" (which is a real
3-state API count). Permanently 0 regardless of reality. **Fix:** wire to real data or drop the tile.

### A4 · LOW — `CONNECTED_DEFAULT = ['Email','Calendar']` is fake connector state
`SkillsSection.tsx` (mid-merge) passes it to `MarketplaceTab`; `MarketplaceCard` computes
"needs X connector" hints against it. A card needing Calendar never warns even if no Calendar
connector is connected. Cosmetic (doesn't gate install). **Fix:** feed real connector state or drop
the hint.

### A5 · LOW — dead heat-graph i18n copy still shipped
`admin-integrations.json:96-97` `skills.intro` / `skills.heatEmpty` describe the removed fake graph,
no longer referenced by any `t()`. **Fix:** delete the keys.

---

## B · Stale "mock / temporary / not-wired" comments on shipped code

Each verified: the described mock/TODO is no longer true. A stale "this is mocked" is worse than no
comment — it tells the next reader an area isn't built.

- **B1 HIGH** `backend/internal/usecases/marketplace.go:5` — "Install + SKILL.md fetch land in a later
  phase; this surface is search-only." `InstallSkill`/`InstallManualSkill` are **in the same file**.
- **B2 HIGH** `backend/internal/domain/marketplace.go:5` — "the frontend simulates install in client
  state." It POSTs to the real `/marketplace/install`; the backend fetches + parses SKILL.md.
- **B3 HIGH** `applications-model.ts:7` — "data 还是 mock fixture, 等后端补 GET /applications." Real
  fetch exists, endpoint mounted, no fixture in the file. `ApplicationsSection.tsx:3` says the opposite.
- **B4 HIGH** `DraftsSection.tsx:6` — "Composer 仍走 mockDraft 占位." It calls the real
  `useDraftDetail` → `GET /drafts/{id}`; backend comment even says "替代 mockDraft 占位".
- **B5 LOW** `DraftThumb.tsx:7` — "Until /drafts/<id> exposes resume_content, we use mockDraft()." The
  "until" premise is false (it does now), though the thumb genuinely still calls mockDraft().
- **B6** `AgentSkillsSection.tsx:5-9` — the "updates available banner when installed_version diverges
  from latest_version" feature is described but **never built** (`AgentSkillView` has no version
  fields). Folded away by the skills merge; delete the claim with it.

---

## C · Names that lie at the control level (looks like it does X, doesn't)

### C1 · MEDIUM — application status control looks like it persists; it's local `useState`
`ApplicationDetailModal.tsx` StatusSegmented `onChange → setStatus` is `useState` (lines 26,208,213).
Nothing is persisted; there is no status PATCH (backend `/applications` is GET-only, writes go through
MCP `applications.commit`). Comment claims "status PATCH 走后端." The owner changes the status, it
looks saved, a reload loses it. **Fix:** either wire a real PATCH or make it visibly read-only.

### C2 · HIGH — "edit on domain" link 404s
`SeoSection.tsx:137` links `<a href="/admin/domain">`. There is **no `/admin/domain` route**. Domain /
public-URL editing lives under `/admin/page` (`PageSection` SiteBlock). The owner clicks the link the
UI hands them and hits a dead page. **Fix:** point it at `/admin/page`.

### C3 · HIGH — "page tagline" is a field that exists in no layer
`SeoSection.tsx:112` tells the owner og:description "Uses your page tagline" and sends them to
`/admin/page` to edit it. There is **no top-level page `tagline`** — `Tagline` exists only on
`PageProject` (per-project). And the real public root description is a hardcoded constant
`layout.tsx:31` `'A personal page that argues back.'` — not tagline, not hero_prose, not the SEO
setting. So the instruction points at a nonexistent field editing a value that wouldn't take effect.
**Fix:** name the real field (likely `hero_prose`) and make og:description actually read it.

---

## D · Duplicate entrances / divergent vocabulary for one concept

- **D1** `/admin/skills` + `/admin/agent-skills` — two nav doors to ONE registry. Merge into one
  tabbed `/admin/skills` (my skills · marketplace); redirect the old door; drop the second nav entry.
  Test built (`skills-single-entrance.spec.ts`, RED on the two-doors state). *Fix-item #1.*
- **D4 MEDIUM — application status vocabulary is fully divergent front↔back (found while building the
  C1 test).** The modal's status words are `silent / reviewing / replied / rejected / offer`
  (`ApplicationDetailModal`), the backend's are `pending / submitted / failed / withdrawn`
  (`domain/application.go`) — no overlap, and `parseAppStatus` maps EVERY committed row to the `silent`
  fallback. So every real application renders as "silent" regardless of its true lifecycle state. This
  is the same class as C1 (the status surface lies) but at the vocabulary layer. **Fix:** one status
  vocabulary end to end, or an explicit map; folds into the C1 fix.
- **D2 HIGH — "public page" vs "pages"** `AdminSidebar.tsx:78` slug `page` label "public page"
  (settings group) vs `:42` slug `microsites` label "pages" (corpus group). Two confusable labels in
  two groups for two genuinely distinct things (the landing-page editor vs MCP-built microsites).
  **Fix:** rename to disambiguate ("landing page" vs "custom pages").
- **D3 LOW — "api · mcp" is one door over two opposite MCP concepts** (`use-tokens` = inbound keypairs
  so clients call US; `use-mcp-servers` = outbound servers WE call). One word "mcp" invites conflation.
  **Fix:** split the labels within the section.
- Cleared as NOT rot: conversations vs ghost-telemetry (sub-panel, not a door), preview vs page
  (distinct), estate→genre (fully migrated).

---

## E · Tests asserting on removed testids/behavior (silently green forever)

- **E1 HIGHEST** `admin-skills-extended.spec.ts:42` "role labels render" — waits on `skill-role-label`
  (gone), only assertion guarded by `if count>0`; **fully vacuous, can never fail.**
- **E2 HIGH** `admin-skills-extended.spec.ts:29` "heat bars render" — `skill-heat-bar` gone, guarded
  assert never runs; only a trivial "row renders" survives. Misnamed. Header doc still describes the
  removed heat feature.
- **E3 LOW/MED** `visitor-chat-citation-expand.spec.ts:79` + `visitor-chat-citation-multi.spec.ts:89` —
  `[data-testid=citation-body].toHaveCount(0)` on a testid that no longer exists = tautology. The specs
  carry other real assertions; only these lines are dead. Header docs describe removed expand-body UI.
- **E4 HIGH — the parallel E-sweep MISSED this one; found on the "别漏" re-check.**
  `admin-raw-crud.spec.ts:42` test `"filter toggle → unprocessed vs all"` — its **entire body** is
  guarded by `if (rawFilterAll.isVisible().catch(()=>false))` on `raw-filter-all`, a testid that no
  longer exists in `app/src` (raw has no unprocessed/all filter control anymore — only the view
  toggle). The guard is always false, so the whole test is a no-op that can never fail, while its name
  promises a filter that isn't there. **Lesson:** a single parallel sweep agent is not exhaustive —
  the re-check (extract every guarded testid, grep each against app/src) caught a 4th dead test.

---

## G · Dead controls — a button that looks actionable and does nothing (NEW class, re-check)

The five parallel sweep agents did not cover this shape. The "别漏" re-check found it.

- **G1 MEDIUM** `SkillsSection.tsx:42` — `<Btn kind="outline">{t('rebuild')}</Btn>` has **no `onClick`**.
  A "rebuild" button the owner can click that does nothing (there is no rebuild action/endpoint). Same
  family as C (a control that lies about what it does). **Fix:** remove it — folds into the D1 skills
  merge, which rewrites this section. (Confirmed the only bare `<Btn>` in admin;
  `RequestsSection.tsx:235` was a false positive — its `onClick` is on the next line.)
- **Follow-up dimension NOT yet fully swept:** a complete dead-button audit (every `<button>` /
  `<Btn>` / clickable across the app whose handler is absent or `() => {}`) — the archetype is
  F-N-1 (the earlier "+ NEW PAGE does nothing"). Worth a dedicated pass; only the `<Btn>`-in-admin
  slice was checked here.

---

## F · Dead code / stale refs / dead config

- **F1 LOW-but-numerous — stale design-source line refs.** ~30 `admin.js (NNNN-NNNN)` / `app.js
  (NNNN-NNNN)` header comments pin a component to a line range that has drifted (verified 5, off by
  100-310 lines: ResumeComposer cited 1467, actually 1777; AgentSkillsSection cited 2583, actually
  2889; etc.). Line numbers rot the instant the design file is edited and nothing checks them.
  **Fix:** cite the component name, drop the line span.
- **F2 LOW — surplus exports** consumed only in their own file (`toast.tsx:80 useToastList` — its own
  comment says "其他人不该用" yet it's exported; `use-ghost-telemetry.ts:46`). Live code, unnecessary
  `export`.
- **Cleared:** i18n `ignoreAttribute` dead-config does NOT exist here (the config documents why it'd be
  inert and omits it). Backend `Config` fields all consumed. `HeatBar`/`HeatBarFill` fully removed.
- **Caveat:** the dead-code agent reported this session's Bash grep dropping lines; negative
  "no importers" claims weren't trustworthy. A real dead-code audit wants `ts-prune`/`knip` in a clean
  shell — flagged as a follow-up, not concluded here.

---

## The lasting rule

A green gate is not evidence. What catches this class: **look at the page**, and **do the owner's
action by hand**. Every HIGH finding here would be obvious to someone USING the product (a chart that
never moves, a Send-gauge that ignores the JD, a link that 404s, a status that doesn't save) and
invisible to every automated check.
