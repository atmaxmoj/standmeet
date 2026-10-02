# Three-layer ACL — test design

> **Status:** Design finalized (2026-06-20; aligned to the pure AND·deny model on 2026-06-23). Companion to [`block-acl-hierarchy.md`](block-acl-hierarchy.md) (business + code architecture). This file covers only **what to test, how to test it, and how it fits with existing tests**.
> **Model (A.4 settled):** pure AND, code can only deny. `exposed = global_on ∧ (roleGranted \ codeDenied) ∧ connector ∧ quota`. No tri-state allow — every row and corner about "code reverse allow / resurrection" is deleted, so the test surface is smaller than the first draft.
> **Rhythm:** red first — write every spec listed here as red first, then implement, and finally get all green (same as Phase A..H).
> **Iron rule:** e2e only (real services, real DB, no mocks of external dependencies); the only exception is §A's pure-resolution truth table, which uses domain unit tests (no IO; it is the "truth anchor" of the whole scheme).

---

## 0. How this fits with existing tests (set the boundary first)

New tests **do not start a separate system**; they land in the existing e2e system:

| Dimension | What to reuse | What to add |
|---|---|---|
| How to run | `make test` / `make test-only SPEC=acl` (existing Makefile, workers=1, resetInstance per spec) | No new recipe |
| Issue a session | `e2e/fixtures/visitor.ts` `issueSession({code})` | Unchanged |
| See tool exposure | `e2e/fixtures/capabilities.ts` `sessionToolNames(token)` | Unchanged (this is the only criterion for "is X in this code's session") |
| Connector corners | `e2e/fixtures/gcal-setup.ts` `seedCodeVisitorOnConnectedOwner` | Unchanged |
| code / role seeds | `e2e/fixtures/codes.ts` `roles.ts` | **Add** `setCodeCapabilityDenial(req,csrf,codeId,capId)` + `setCodeSkillDenial(...)` + `clearCodeCapabilityDenial(...)` (undo) + `listCodeDenials(...)` (read back) |
| File location | `e2e/test/` | **Add** `acl-*.spec.ts`, next to `capability-*.spec.ts` |
| Unit truth table | — | **Add** `internal/domain/role_snapshot_acl_test.go` (tests `AllowsCapability`) |

**Regression anchors (must stay green, proving the "role frozen baseline" was not broken):**
`chat-book-success` · `chat-book-not-connected` · `mcp-skill-grant-booking` · `external-mcp-tools` · `retrieval-block-state` · `session-block-bundle` · `block-disable-while-attached` (global live gate). Not one of these may go red.

---

## A. Truth table (domain unit tests)

Method under test `RoleSnapshot.AllowsCapability(capID, aclAlways) bool` = `baseGrant(aclAlways ∨
allowedTools∋capID) ∧ capID ∉ deniedCapabilities`. `mcpAppGranted` delegates to it; it is the truth anchor of the whole frozen
decision. Exhaust baseGrant × code deny (including the ACL=always dimension):

| # | baseGrant | code deny | exposed | Meaning |
|---|---|---|---|---|
| A1 | role-granted | — | **true** | Inherits the role grant |
| A2 | role-granted | Y | **false** | Code revokes what the role granted |
| A3 | none | — | **false** | Role does not grant |
| A4 | none | Y | **false** | Idempotent noop |
| A5 | ACL=always | — | **true** | always capabilities are always exposed |
| A6 | ACL=always | Y | **false** | **Code deny beats always** (subtraction cannot reach it; blocked at the gate) |

Plus wire round-trip: `deniedCapabilities` still takes effect after marshal→unmarshal (not lost when frozen into session_data).

---

## B. Happy-flow combination matrix (e2e)

Full exposure formula: `exposed = global_on ∧ frozenAllow ∧ connector_deps ∧ quota`. This section fixes the connector as connected and quota as sufficient, and varies only global × frozen, **running the key rows for both the capability and skill target kinds**.

### B.1 global=ON, sweep the 4 frozen rows × 2 targets

| spec | target | role | code deny | Expected |
|---|---|---|---|---|
| `acl-cap-inherit` | calendar.book | Grants | None | Exposed (A1, regression baseline) |
| `acl-cap-code-revokes` | calendar.book | Grants | deny | **Not exposed** (A2) |
| `acl-cap-none` | calendar.book | Does not grant | None | Not exposed (A3, regression) |
| `acl-cap-code-deny-noop` | calendar.book | Does not grant | deny | Not exposed (A4 idempotent) |
| `acl-skill-code-revokes` | skill X | Grants | deny | **skill X's skill_use not exposed** (A2·skill) |
| `acl-skill-inherit` | skill Y | Grants | None | skill Y exposed (A1·skill, regression) |
| `acl-skill-none` | skill Z | Does not grant | None | Not exposed (A3·skill baseline, symmetric completion) |

Criterion: `sessionToolNames(the code's session)` contains / does not contain the target tool (`calendar_book` / the exposed form of that skill).

### B.3 ACL acts on the whole frozen product, not only tool names

The code deny subtracts the cap from the grant set before freezing, so **all of it must disappear**: tool spec, capability_state, system-prompt fragment / part_id / hash. This locks "subtract one cap = it does not exist at all in this session".

| spec | Scenario | Expected | What it locks |
|---|---|---|---|
| `acl-code-deny-drops-prompt-fragment` | Code denies retrieval (a cap that contributes a fragment) | The fragment is **not** in `system_prompt_part_ids`; the hash changes accordingly | feature-floor: a cap contributes fragment+part_ids+hash (aligned with `session-block-bundle`) |
| `acl-code-deny-cap-absent-from-states` | Code denies a cap the role grants | The cap is **completely absent** from the `capabilities` states (**not** `enabled=false`) | Two cross-cuts: ACL = "not discovered" (ErrHidden / not in spec), distinct from connector/quota's "visible but `enabled=false`, degraded" |

> Criterion extension: besides `sessionToolNames`, these two also read the session bundle's `system_prompt_part_ids` / `capabilities` (`e2e/fixtures/capabilities.ts` already fetches them). **Don't assert only tool names** — that cannot catch fragment leaks / leftover state.

### B.2 global is the top-level master

| spec | Scenario | Expected |
|---|---|---|
| `acl-global-beats-role-grant` | global off for calendar.book + role grants + no code deny | **Not exposed** (global pure deny master beats the frozen allow, A.3) |
| `acl-global-on-frozen-decides` | global on + role grants + code deny | Not exposed (with global on, frozen decides; verifies the master only subtracts, never adds) |

---

## C. Frozen vs live (asymmetric semantics; lock both sides)

| spec | Layer | Order of operations | Expected | Invariant locked |
|---|---|---|---|---|
| `acl-code-frozen-at-issue` | code | issue → change code deny → next turn of the same session | **Unchanged** (still as at issue) | role/code frozen |
| `acl-code-reissue-reflects` | code | change code deny → **new** issue | Takes effect in the new session | Changing a code affects only later sessions |
| `acl-global-live-mid-session` | global | issue → switch global off → same session | **Disappears immediately** | global live (same family as the existing `block-disable-while-attached`; a reference is enough) |

> These three are where this design is easiest to get wrong: a code change **does not touch running sessions**; a global change **touches running sessions immediately**.

---

## D. Isolation (per-code, not per-role)

| spec | Scenario | Expected |
|---|---|---|
| `acl-code-isolation` | Two codes with the same role: code-1 denies X, code-2 has no deny | code-1's session has no X; **code-2's session has X** |
| `acl-code-multi-deny` | One code denies two caps (X + Y) | **Neither** X nor Y is exposed | A deny is a set, not a single value |
| `acl-code-denial-scoped-to-owner` | Write a deny with another owner's codeId | 404/403, no crossover |

---

## E. Error stream

| spec | Input | Expected |
|---|---|---|
| `acl-deny-unknown-capid` | Deny a capability id that does not exist | The write does not error; no match at resolution → zero effect, no crash (the id never hits a registered cap) |
| `acl-deny-on-revoked-code` | Code already revoked + has a deny | Session 401 (existing); the deny is moot |
| `acl-deny-missing-csrf` | Write a deny without the CSRF header | 403 (reuses admin auth; no separate logic) |
| `acl-deny-malformed-body` | Write a deny missing `capability_id` (bad body) | 400, nothing written |
| `acl-deny-duplicate-idempotent` | Deny the same (code,cap) twice | Idempotent (PK (code_id,capability_id); the second time does not error and does not double-write) |
| `acl-deny-undo-reissue` | Write deny → delete deny → **re**-issue | The capability **comes back** (a deny can be undone; reissue reflects it, same family as §C `acl-code-reissue-reflects`) |
| `acl-deny-readback` | After writing a deny, GET the code's deny list | Returns what was just written (admin UI read path, sparse list) |

(The original `acl-override-bad-state` is deleted — a deny has no state column; `acl-deny-malformed-body` guards bad bodies instead.)

---

## F. Corner cases (crossings of orthogonal gates — the focus)

Each one is "when a code deny meets another gate, who decides". **A code deny only narrows grants; it does not touch existence / connection / quota.** Under pure AND·deny, the "code reverse allow" corners (original F1/F2/F3/F7) no longer exist — no allow means no "resurrection / privilege escalation / double send".

| # | spec | Scenario | Expected | Why |
|---|---|---|---|---|
| F4 | `acl-code-deny-noop-when-role-ungranted` | Role does not grant + code deny | Not exposed (no change) | Idempotent; the e2e version of A4. |
| F5 | `acl-code-deny-owner-only-noop` | Code denies an owner-only capability (e.g. seo) | No change in the visitor session, no crash | owner-only is not on the visitor plane (Phase H shape filter); the deny is meaningless for it but must not blow up. |
| F8 | `acl-public-session-no-deny-layer` | public/byoai (no code) | Behavior = owner vanilla role; the deny layer does not take part | No code → no deny source (regression protection). |

> The crossings of the three orthogonal gates connector / quota / `skill.Enabled` with ACL are covered by existing regression anchors (`chat-book-not-connected` / the quota series / skill enable) — they already are "the role grants but the gate is not satisfied → not exposed"; pure AND·deny does not change this semantics, so no new corners are needed (the original F2/F6 scenarios built on code-allow no longer exist).

---

## G. Red-first implementation order

1. **§A domain unit tests** (truth table + wire round-trip) → red → implement `RoleSnapshot.AllowsCapability` + `mcpAppGranted` delegating to it → green. Anchors the truth.
2. **§B happy matrix (including B.3 frozen product)** → red → implement schema + repo + `CodeDenialReader` wired into `buildRoleSnapshotForCode` (skills removed at source / caps into `DeniedCapabilities`) + admin deny write/read endpoints → green. B.3 also verifies fragment/part_ids/hash and the absence from states.
3. **§C frozen/live + §D isolation + multi-deny** → red → (mostly green once step 2 is implemented; add the two-code seeds for isolation).
4. **§F corners** (F4/F5/F8) → red→green one by one.
5. **§E error stream** (unknown id / revoked / no CSRF / bad body / duplicate / undo / read back) → red→green.
6. **Regression anchors (§0)** stay green throughout; rerun after every implementation step.

**Definition of done:** §A–§F all green + not one §0 regression anchor red + `make lint` green (including docker golangci).

---

## H. Coverage self-check (against omissions)

- [ ] All 4 truth table rows tested (A1–A4), including the deny-noop idempotent row.
- [ ] Both capability and skill target kinds ran "inherit / code revoke / not-granted baseline" (including `acl-skill-none`).
- [ ] **ACL acts on the whole frozen product**: tool name + capability_state absence + prompt fragment/part_ids/hash (§B.3), not only tool names.
- [ ] **"Not discovered" vs "visible but disabled" difference locked** (denied → not in states; connector/quota → `enabled=false`).
- [ ] Both frozen (code) and live (global) timings locked.
- [ ] The three orthogonal gates (connector / quota / skill.Enabled) are covered by existing regression anchors (no scenarios built on code-allow).
- [ ] Master (global) only subtracts, never adds — locked.
- [ ] Per-code isolation locked (two codes with the same role diverge) + multi-deny sets.
- [ ] public/byoai no-code path regression-tested.
- [ ] Error stream: unknown id / revoked / no CSRF / bad body / duplicate idempotent / undo-reissue / read back.
