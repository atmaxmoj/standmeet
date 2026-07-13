# SOP — Fully-real verification

## Core principle

**A real-environment failure is a test-quality defect.**

Manual verification is only the *detector*. Every "breaks against the real service, yet its e2e is green" case has its root cause in that e2e being either:
- **Inaccurate** — the assertion validates behavior the *mock* promised, or is too loose ("didn't crash = pass"); or
- **Incomplete** — it never drives this real path / real branch (a real provider's 409, real STARTTLS+AUTH, real pagination, real SSRF block, …).

So the fix does **not** land as "just change the code." It lands as: **make the test catch it first → fix the code TDD-style → re-verify by hand.** This is the same "a bug is a missing-test signal" the repo runs on.

---

## Flow

### 0 · Set scope
Decide which `items/` to run this round. Pick only what's **credential- / self-serve-reachable** (see each item's `Scope`). Credentials live in `~/.config/standmeet/verify-creds.env`.

### 1 · Run the real verification by hand
Follow each item's **Steps** with Playwright MCP / a real client, against the **real services** (`make prod-up` → `docker-compose.prod.yml` + real creds, **zero mocks**). Compare against **Expected**.

### 2 · On a mismatch → RECORD ONLY, do not fix in place ⚠️
- Record `{symptom, Expected vs Actual, surface, repro}` in the item's **Findings** section, and log one row in `findings.md` with ID `F-<item>-<n>` (e.g. `F-B-1`).
- **Don't stop, don't fix on the spot.** The first hole must not derail the round. Finish this item / the round's remaining items.

### 3 · After all manual verification → attribute each finding to a test (TDD fix)
For every row in `findings.md`:
1. **Find its backing e2e test** — the item's `Backing e2e` header points to it.
2. **Read the test + attribute** — real-red + e2e-green ⇒ necessarily *inaccurate* or *incomplete*; decide which, and pin the exact bad assertion / missing case.
3. **TDD** — first change/add the test so the problem **surfaces as RED** (reproduce that real branch at the mock layer where possible; if it genuinely can't be reproduced, mark it `manual-only` and say why in the doc). Then fix the code to **GREEN**.
4. **Regress** — return to **manual** verification of this item; real-green too ⇒ closed loop.

### 4 · State machine (kept in each item's `Status` header)
```
⬜ not-run → 🔴 manual-red (Finding) → 🧪 test reproduces red (RED) → 🟩 code green → ✅ manual re-verify green
```
Terminal: `⛔ blocked` (missing cred/hardware), `🚫 de-scoped` (decided not to do it).

---

## Iron rules
1. **No code changes during the manual phase** — record only. Fixes are batched into step 3, TDD-style.
2. Every Finding must land as a **test change** (RED→GREEN). No "fix the code without touching a test" — otherwise the real env breaks again next time.
3. **Non-reproducible real branches** (real-phone optics, real-provider rate limits, real ACME…) → mark `manual-only`: document why it can't be tested and how to verify it by hand; do not fabricate a fake test.
4. An item isn't done until `✅ manual re-verify green`.
