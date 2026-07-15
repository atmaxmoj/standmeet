# SOP — Fully-real verification

## Core principle

**A real-environment failure is a test-quality defect.**

Manual verification is only the *detector*. Every "breaks against the real service, yet its e2e is green" case has its root cause in that e2e being either:
- **Inaccurate** — the assertion validates behavior the *mock* promised, or is too loose ("didn't crash = pass"); or
- **Incomplete** — it never drives this real path / real branch (a real provider's 409, real STARTTLS+AUTH, real pagination, real SSRF block, …).

So the fix does **not** land as "just change the code." It lands as: **make the test catch it first → fix the code TDD-style → re-verify by hand.** This is the same "a bug is a missing-test signal" the repo runs on.

---

## The journey (read this as one line, then the sections)

```
手测 ──► 没问题 ──► 停。收工。
      └─► 有问题 ──► 看测试:改测试(inaccurate) 还是 新增测试(incomplete)
                  ──► e2e 见红 (RED — 先证明它在坏代码上真的红)
                  ──► 再改代码
                  ──► 测试见绿 (GREEN)
                  ──► 回去手测,确认真的一点问题都没有了 ──► 收工
```
> manual → green? **STOP.** · red? → attribute the test (**fix** the lying one / **add** the missing one) → **e2e RED** → *then* change code → **GREEN** → **back to manual** and confirm clean.
>
> **Exception:** a finding a test *shouldn't* carry (UI redundancy, cosmetics, copy, taste) → **write no test; tell the owner explicitly why** (iron rule 4b). Never fabricate a test just to satisfy the loop.

The order is the point: the manual test opens the loop and the manual test closes it. A green e2e in the middle proves nothing on its own.

---

## Flow

### 0 · Set scope
Decide which `items/` to run this round. Pick only what's **credential- / self-serve-reachable** (see each item's `Scope`). Credentials live in `~/.config/standmeet/verify-creds.env`.

### 1 · Run the real verification by hand
Follow each item's **Steps** with Playwright MCP / a real client, against the **real services** (`make prod-up` → `docker-compose.prod.yml` + real creds, **zero mocks**). Compare against **Expected**.

> **Manual green ⇒ STOP. ⚠️** If the surface behaves, that module is **done for this round** — no finding, no test, no code change, no "while I'm here" refactor. The manual result is the *only* trigger for everything downstream. Don't invent work where reality says it works.

### 1b · COLD SANITY SWEEP — the look, not the checklist ⚠️ (why basic bugs slip past)
The old §A–§R axis was a MECHANISM checklist ("does capability X work"). A mechanism checklist structurally cannot catch **basic UI defects** — a dead button, an empty list, garbled text, a badge that disagrees with its list — because those aren't mechanisms, they're presence/sanity. Those are exactly what the owner catches by *using* the product, and what a task-focused agent misses (on a screen for one mission, blind to everything off-mission; F-D-1, F-N-1, F-R-1 were all found only from owner screenshots after several rounds).

The fix is baked into the module re-cut: **every module now owns its surface and carries a `⚠️ LOOK` block** — so the sanity sweep is on-mission, not a separate pass an agent forgets. Once per round, run each module's LOOK **task-free**, and give the cross-view lens its home in [[admin-shell]] (every count/badge vs its list). The three lenses each LOOK applies:

- **Cold sweep** — open EVERY admin + visitor surface with NO mission and ask only *"would a real user go 'huh?'"*: click every button/affordance (does it do anything?), eyeball every panel (empty? broken? raw markup leaking? placeholder never replaced?). Log anything that fails fresh-eyes.
- **Cross-view consistency** — for every count / badge / KPI, find the list or table it summarizes and confirm they **AGREE**. (F-L-4 = dashboard count wrong; F-D-1 = list empty while the count says 3 — same family: two views of one dataset disagreeing, which no single-screen check catches.)
- **Sweep-the-class on every fix** — when you fix a bug, enumerate every other instance of its *shape* before moving on (a count-vs-list fix → check ALL count/list pairs), not just the one reported.

### 2 · On a mismatch → RECORD ONLY, do not fix in place ⚠️
- Record `{symptom, Expected vs Actual, surface, repro}` in the **module's Findings** section, and log one row in `findings.md` — ID stays `F-<letter>-<n>` (the historical anchor for the module's area, e.g. a booking finding → `F-B-n`), and name the module in the Item column.
- **Don't stop, don't fix on the spot.** The first hole must not derail the round. Finish this module / the round's remaining modules.

### 3 · After all manual verification → attribute each finding to a test (TDD fix)
For every row in `findings.md`:
1. **Find its backing e2e test** — the module's `Backing e2e` header points to it.
2. **Read the test + attribute — "fix the test" or "add a test"?** real-red + e2e-green ⇒ necessarily *inaccurate* or *incomplete*. Decide which, because it decides the move:
   - **inaccurate ⇒ CHANGE the existing test** — its assertion validates the mock's promise, or is too loose ("didn't crash = pass"). The test exists and lies.
   - **incomplete ⇒ ADD a new test / case** — no test ever drives this real branch. The test doesn't exist.
   Pin the exact bad assertion / missing case before writing anything.
3. **TDD** — first change/add the test so the problem **surfaces as RED** (reproduce that real branch at the mock layer where possible; if it genuinely can't be reproduced, mark it `manual-only` and say why in the doc). **A guard is only real if it goes RED on the buggy code — prove RED before trusting GREEN.** Then, and only then, fix the code to **GREEN**.
4. **Regress — go back to the MANUAL test.** Re-drive the same real surface by hand and confirm the symptom is gone *and* nothing else broke. Green e2e ≠ done; the loop closes only at real-green.

### 4 · State machine (kept in each module's `Status` header)
```
⬜ not-run → 🔴 manual-red (Finding) → 🧪 test reproduces red (RED) → 🟩 code green → ✅ manual re-verify green
```
Terminal: `⛔ blocked` (missing cred/hardware), `🚫 de-scoped` (decided not to do it).

---

## Iron rules
1. **The manual test is the only trigger.** Manual green ⇒ stop (§1). No finding, no test, no code change without a real symptom first.
2. **No code changes during the manual phase** — record only. Fixes are batched into step 3, TDD-style.
3. Every Finding must land as a **test change** (RED→GREEN). No "fix the code without touching a test" — otherwise the real env breaks again next time. **Exactly two exceptions, both named below (4a/4b). Everything else gets a test.**
4. **The two "no test" exceptions — never silently, always told to the owner:**
   - **4a · CAN'T test** (non-reproducible real branches: real-phone optics, real-provider rate limits, real ACME…) → mark `manual-only`: document why it can't be tested and how to verify it by hand. **Do not fabricate a fake test.**
   - **4b · SHOULDN'T test** (a test here would be *bad*: UI redundancy, cosmetics, copy/wording, layout, subjective judgment calls — a test would be brittle, meaningless, or would freeze a taste decision as if it were a contract) → **do not write one.** Fix it (or propose the fix) and **flag it to the owner as an explicit special note saying this one carries no test and why** — the owner decides. These live in `ux.md`, **not** as a fake RED→GREEN row in `findings.md`.
5. An item isn't done until `✅ manual re-verify green` — back on the real surface, by hand (§3.4).
