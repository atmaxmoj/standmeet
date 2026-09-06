# Coded-landing + per-code slug — test design

Write the scenarios FIRST, then implement against them (owner: exhaustive; assert the CAPABILITY, not
an absence; a race → a unit test that reproduces it deterministically). Legend: **UT** = pure/unit,
**GO** = backend Go test, **E2E** = Playwright, **MIG** = migration/upgrade. Status: ✓ done · ○ todo.

## A. Landing decision (which surface `/` and `/<slug>` show)

| # | Scenario | State | Expect | Test | Status |
|---|---|---|---|---|---|
| A1 | fresh valid `?code=` | no session, code absorbed | picker → name → **can converse** | E2E | ✓ coded-visitor-can-converse |
| A2 | first paint before absorb | hasCode, no pending | picker (never HomeFallback flash) | UT | ✓ visitor-root.test |
| A3 | pending code while in a session | session + pending (a different code) | picker (SWITCH), not the old chat | UT | ✓ visitor-root.test |
| A4 | live session, nothing new | session, no pending | that chat | UT | ✓ visitor-root.test |
| A5 | codeless, no live home | no code, no session, no home | the default homepage (NOT "under construction") | E2E | ○ (home-fallback → default) |
| A6 | `?q=` codeless question | no code, `?q=` | handoff to /gate?q= | E2E | ○ |

## B. Invalid / expired code (don't forget)

| # | Scenario | Expect | Test | Status |
|---|---|---|---|---|
| B1 | invalid code, fresh visitor | picker degrades (no greeting), submit → **/gate** (a real page), never blank / "under construction" | E2E | ○ (redirect wired; needs the e2e) |
| B2 | invalid code while in a valid session | the valid session is NOT lost; the invalid code doesn't switch into a dead chat | E2E | ○ |
| B3 | expired code (was valid) | same as invalid → /gate | E2E | ○ |

## C. Per-code slug — backend (Spec 1b)

| # | Scenario | Expect | Test | Status |
|---|---|---|---|---|
| C1 | create a code, no slug given | slug is auto-generated, non-empty (snowflake→base62) | GO | ○ |
| C2 | create a code with a slug | that slug is used verbatim | GO | ○ |
| C3 | two codes, same owner, same slug | second create is REJECTED (unique per owner) | GO | ○ |
| C4 | slug charset / reserved | reserved slugs (home, gate, admin, api, setup, p, wiki, output) + bad chars rejected | GO | ○ |
| C5 | snowflake ids | unique, monotonic, short base62, node range | UT | ✓ snowflake_test |
| C6 | migration on an instance with existing codes | every existing code gets a non-empty, unique slug (upgrade path, not just empty-volume green) | MIG/GO | ○ |
| C7 | session/commit response carries the slug | applications.commit / code read returns the slug so the client can land on /<slug> | GO/E2E | ○ |

## D. Per-code slug — landing + isolation (Spec 1b, the e2e heavy part)

| # | Scenario | Expect | Test | Status |
|---|---|---|---|---|
| D1 | `?code=X` absorbed | URL rewrites to `/<X.slug>` — the raw code is gone from the URL, and it's a real path, not bare `/` | E2E | ○ |
| D2 | land on `/<slug>` with the code in cookie | resumes THAT conversation immediately (per-slug isolation) | E2E | ○ |
| D3 | land on `/<slug>` WITHOUT the code (no cookie) | **no access** — the slug is a locator, NOT the credential; visiting a slug you were never given the code for does not open a session (security) | E2E | ○ |
| D4 | two codes → two slugs, same browser | two isolated conversations, each located by its slug; opening one doesn't leak the other | E2E | ○ |
| D5 | reopen `/<slug>` after the session ended/expired | graceful (gate / re-request), not a crash or a stale chat | E2E | ○ |
| D6 | `/<slug>` collides with a microsite slug or a real route | the router resolves deterministically (documented precedence); no ambiguous match | E2E | ○ |

## Notes
- D3 is the load-bearing security scenario: the slug is public + guessable (or shared), so it must
  never itself grant access — the CODE (in cookie / re-entered) is the credential. Assert a visitor
  with only the slug and no code is gated.
- C6: the migration must be exercised on a NON-empty codes table (existing rows backfilled), not just
  a fresh schema — [[schema-lives-in-the-volume-not-the-image]].
- Every "can/does" row asserts the positive capability (a conversation starts, a slug resolves), not
  the absence of a bad string.
