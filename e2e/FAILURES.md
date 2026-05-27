# E2E Test Failures — Run 200d

**Date**: 2026-05-27
**Total Tests**: 200
**Passed**: 138
**Failed**: 61
**Did not run**: 1

---

## Root Cause Categories

### RC1: Missing data-testid on components (31 failures)

Specs reference testids that don't exist in the UI. Fix: add testid to the component.

| Spec | Expected testid | Component to fix |
|---|---|---|
| admin-dashboard | `dashboard` | DashboardSection — no wrapper testid |
| admin-dashboard | `kpi-entries` | Kpi card — no testid |
| admin-dashboard | `needs-hand` | NeedsYourHand — no testid |
| admin-dashboard (sparkline) | `svg` count | Sparkline — no testid |
| admin-obsidian | `vault-stat-mode` etc | ObsidianSection StatCell — no testid |
| admin-seo | `seo-site-title` etc | SeoSection FieldBlock — no testid |
| admin-seo (sitemap) | `seo-regenerate` | SeoSection button — no testid |
| admin-seo (indexing) | `seo-indexing` | SeoSection IndexingCard — no testid |
| admin-system (terminal) | `system-terminal` | SystemSection DeploymentBlock — no testid |
| admin-system (jobs) | `system-jobs` | SystemSection JobsTable — no testid |
| admin-system (health) | `system-health` | SystemSection HealthChecks — no testid |
| admin-sidebar (active) | `aria-current` attr | SidebarItem — no aria-current |
| admin-preview | `code-picker` | PreviewSection CodePicker — no testid |
| admin-conversations | `transcript-panel` | ConvTableRow expand — no testid |
| admin-codes-extended | `code-qr` | CodeCard QR — no testid on QR element |
| admin-codes-extended | `code-edit-label` | CodeCard edit — no edit-label testid |
| admin-raw-crud | `dump-input` | RawDumpBox textarea — no testid |
| chatroom-layout | `chatroom` | ChatRoom wrapper — no testid |
| chat-composer | `starter-chips` | StarterChips — no testid |
| chat-welcome | `chat-welcome` | ChatWelcome — no testid |
| turn-rendering | `citations` | Citations — no testid in ChatRoom |
| floating-chat-dock | `floating-dock-pill` | FloatingChatDock trigger — no testid |
| wiki-landing-extended | `wiki-ask-about` | AskAboutThis — no testid |
| output-landing-extended | `404-page` | Next.js not-found — no testid |
| blog-tag-filter (empty) | `blog-empty` | BlogIndex empty — no testid |
| gate-code-ux | `gate-error` | CodePanel error — no testid |
| code-session-paste | `gate-error` | CodePanel error — no testid |
| visitor-name-welcome | `chat-welcome-text` | ChatWelcome — no testid |
| quota-warn-lockdown | `is-warn` class | SessionStrip — check class name |
| admin-requests (approve) | `request-approve` | OpenActions — no testid |

### RC2: Wrong selector / navigation flow (15 failures)

Specs use locators that don't match actual UI structure.

| Spec | Issue |
|---|---|
| admin-raw-crud | `locator.fill` on dump textarea — wrong selector |
| admin-requests | `locator.click` to navigate to gate — wrong flow |
| admin-preview (suggested) | `locator.click` on code picker — wrong selector |
| admin-codes-extended (edit) | `locator.click` on edit button — button text mismatch |
| admin-codes-extended (revoke) | `locator.click` on revoke — testid mismatch |
| admin-codes-extended (conversations) | link text mismatch |
| admin-skills-extended (delete) | `locator.click` on delete — wrong selector |
| session-persistence (exit) | `locator.click` on exit — wrong selector |
| cross-tab-sync (exit) | `locator.click` — same as session-persistence |
| gate-request-access (all 3) | `locator.fill` on request form fields — wrong testid |
| integration-code-chat-transcript | navigation flow doesn't match |
| setup-wizard-extended (provider) | `selectOption` — not a select, is Segmented |
| setup-wizard-extended (back) | `locator.click` — wrong button selector |

### RC3: Backend API call wrong (3 failures)

Specs call MCP with wrong parameters.

| Spec | Issue |
|---|---|
| admin-applications (after commit) | `jobs.register_source` greenhouse config missing `company` |
| admin-drafts (after draft) | same |
| integration-job-loop | same |

### RC4: Logic assertion wrong (5 failures)

Specs assert behavior the UI doesn't actually have.

| Spec | Issue |
|---|---|
| login-extended (empty email) | submit button isn't disabled — it shows error on click |
| login-extended (empty password) | same |
| setup-wizard-extended (handle) | next isn't disabled for illegal chars — validates on click |
| gate-byoai-ux (provider switch) | placeholder doesn't change per provider |
| visitor-name-welcome (greeting) | ChatWelcome text format differs from expected |

### RC5: 404 page handling (2 failures)

Specs expect a visible "404" element but Next.js notFound() renders differently.

| Spec | Issue |
|---|---|
| wiki-landing-extended (404) | Next.js notFound — no testid, just default 404 |
| output-landing-extended (404) | same |

---

## Fix Plan — 5 batches

### Batch 1: Add testids to components (RC1)
Add data-testid to ~25 components. No spec changes needed — once testids exist, specs find them.

### Batch 2: Fix spec selectors (RC2)
Fix 15 specs to use correct locators matching actual UI.

### Batch 3: Fix MCP call params (RC3)
Fix 3 specs to include `company` in greenhouse config.

### Batch 4: Fix logic assertions (RC4)
Fix 5 specs to match actual UI behavior (e.g., error-on-click vs disabled).

### Batch 5: Fix 404 handling (RC5)
Fix 2 specs to assert Next.js default 404 page.

---

## Runs

### Run 200d — baseline
- Stats: `{ passed: 138, failed: 61, skipped: 1 }`
- Root cause breakdown: RC1(31) + RC2(15) + RC3(3) + RC4(5) + RC5(2) + uncategorized(5)
