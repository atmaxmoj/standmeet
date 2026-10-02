# Manual audit guide (the layer of quality lint cannot guard)

> lint / type checks / tests passing ≠ clean architecture. They guard **mechanical correctness** (formatting, unused variables, cyclomatic complexity caps, empty containers, the //nolint ban).
> This document guards **judgement quality**: is the intent clear, are failures loud, is the logic in one place only, are abstractions used where they count.
> Only a person (or a review that applies judgement) can check these one by one. Each item gives: **the smell signals** + **the questions to ask yourself** + **real examples from this repo**.
>
> Usage: after changing a block of code, or when reviewing a PR, **first understand the intent, then pick one real path and walk it end to end**, then go through the checklist below.
> Not every item needs full marks — every item needs **a conscious judgement**, not a default pass.

---

## 0. How to run an audit (process)

1. **Read the intent first, not the implementation**: look at package comments, type names, function signatures. Can you guess correctly from the names alone "what it does / whether it can fail / whether it changes state"? If not → the naming or the boundary has a problem; note it first.
2. **Walk one real path**: pick an end-to-end scenario (e.g. "set up a CalDAV supplier → booker really books"), and follow the data and control flow through the code. **Do not look only at units; look at paths** — most architectural debt hides in the seams between modules.
3. **Walk the error path backwards**: on the same path, assume every step fails. How does the error propagate? Does it get swallowed? Can the caller tell "no data" from "it blew up"?
4. **Go through checklist items 1–10 below**, recording each finding as `file:line + severity (blocker / debt / style) + one sentence`.
5. **Output an audit table**, do not fix directly — let people see the whole picture first and then decide what to touch.

---

## 1. Control flow: the density and intent of `if`

**Signals**
- A long `if/else` or `switch` on one variable branches by "kind/type", and **every new kind means coming back to change this spot** → missing polymorphism / table-driven / registry.
- `if` nested more than 2 levels → use guard clauses with early returns and flatten the normal path.
- An `if` crams in **a check + business computation + IO/rendering** at once → concerns are not separated.
- The `if` checks **the shape of data** ("is it an object / does it have this field") rather than **controlling the path** → shape checks usually belong in the contract/type, not scattered across call sites.

**Ask yourself**
- Will this branch structure grow as the business grows? If yes → it should be **data** (registry / map / config), not a `switch`.
- Is this `if` an "essential branch" or "a patch for a missing abstraction"?
- Would deleting this `else` and returning early read better?

**This repo**
- ❌ Leak: if `if provider == "gcal"` appears in booker, a concrete supplier has leaked into the consuming side — it should be normalized behind the seam (the consumer only says `requires: [calendar]`, never names a vendor).
- ⚠️ An old example overturned by the current design: `adaptByCategory`'s `switch(category){case calendar/mail}` + the `CalendarProxy` contract was once counted as "✅ a reasonable contract boundary". **That no longer holds.** Seam resolution is **by name**, and the value is `CallVerb(verb, json.RawMessage)` — there is no typed category surface. block-model.md:161, verbatim: a typed category surface "is exactly what the existing design kills". That typed layer (`blockCalendarProxy`/`blockMailProxy` in `cmd/server/blockwire/block_calendar.go`·`block_mail.go`, `internal/infra/openapi`) **still physically exists today as a leftover awaiting deletion** (step ⑤, deferred 2026-09-17, see `docs/full-suite-failures.md:17` + `docs/design/plugin/openapi-runtime-block.md`); an audit should record it as "to be eliminated", not "reasonably kept".
- Criterion: **a `switch` that grows with "business kinds" = bad; one closed over a "fixed protocol" that introduces no per-seam typed interface = acceptable. Once it is "one typed contract/Proxy per seam" = star topology, which the current design kills.**

---

## 2. Fail loud vs fail silent (the item most likely to produce real bugs)

**Default to fail loud**: an error is either handled or reported, **never silently swallowed**.

A legitimate silent degrade must satisfy **all** of these:
1. It is **an expected business state**, not a fault (e.g. §8-C: a provider returns a shape that does not match the contract = "no data", not "down");
2. The degrade path has **clear semantics + a comment + a test**;
3. **It does not mask real faults** — it can tell an "expected not-found" from "the DB blew up / the network is down".

**Signals**
- `if err != nil { return nil }` lumps **all** errors together (expected and real alike).
- A catch-all returns a zero/default value, and the caller cannot tell "no data" from "failed".
- It degraded but left **no trace at all** (no log, no counter, no alert).

**Ask yourself**
- Could a real fault that "should alert / should be a 5xx" be mixed into the errors swallowed here?
- If ops are woken up at midnight, can they tell from the logs alone that a degrade happened here, and why?
- Does the caller **need** to distinguish these failures? If yes → give a sentinel / typed error; do not blanket-return nil.

**This repo**
- ❌ Real bug (fixed): `ensureActive` used to swallow **all** manifest errors with `if merr != nil { return nil }` — even a DB failure silently skipped activation. Changed to skip only on `errors.Is(ErrNotFound)`; real errors are reported with `return fmt.Errorf(...)`.
- ✅ Legitimate degrade: `decodeInto`'s shape-mismatch → keeps the zero value without reporting an error, but it is **extracted into a separate `decodeOrEmpty` + a comment + a §8-C test**; the semantics are clear, testable, and do not mask real errors.

---

## 3. Redundant logic / single source of truth (DRY is about "knowledge", not "lines of code")

DRY does not mean "no two pieces of code that look alike"; it means "**the same knowledge is not expressed in two places**" — otherwise you change one and forget the other.

**Signals**
- The same knowledge is enumerated in several places (two places both list `calendar/mail` by category; two independent validation rules must be changed in sync).
- **Derived data is stored** (`message_count` is stored, yet can be derived from dialog) → there is always an inconsistency window.
- **The same logic gives different results on two paths** (candidate derivation vs post-creation derivation).
- Copy-pasted "parallel structures" — when A changes B must follow, but nothing enforces it.

**Ask yourself**
- Is this value the **source of truth** or **derived**? If derived, do not store it; compute it.
- Adding one category / auth type / status means changing **how many places**? > 1 means duplicated knowledge; find a way to bring it down to 1.

**This repo**
- ❌ Real bug (fixed): the apiKey field name was `'key'` in candidate derivation and `'apiKey'` in post-creation derivation — **the same derivation ran on two paths**. Unified into one (`apiKeyField` returns `'key'` for the generic `apiKey` everywhere).
- ✅ Done: `count` is always derived from dialog; the stored `message_count` field was deleted.

---

## 4. SOLID (the pragmatic version, not dogma)

Ask one **concrete** question per letter instead of reciting definitions:

- **S (single responsibility)**: does this struct hold a pile of **unrelated** fields (god-struct)? Does this function parse and do IO and render?
- **O (open/closed)**: does extending it require changing the core? **Does adding a new supplier touch the base code?** (It should only add data/plugins.)
- **L (Liskov substitution)**: are the different implementations of a contract **really interchangeable**? When CalDAV and Google feed the same booker, are **error shapes / empty results / idempotency semantics** consistent? (Compiles ≠ substitutable.)
- **I (interface segregation)**: is the interface too fat, forcing consumers to depend on methods they do not use? (Narrow deps vs god-deps; see the refactor that split `VisitorDeps` into narrow pieces.)
- **D (dependency inversion)**: does the high level depend on **abstractions** or **concretions**? Across layers — does the supplier layer depend on the `ConnectionStore` interface, or import `postgres` directly?

**Ask yourself**
- Is this cross-layer dependency an interface or a concrete type? Across layers it must be an interface.
- Do all users of this "god-struct / parameter bag" use every field in it? Split out the ones they do not.

---

## 5. Design patterns: use them where they count, no cargo-culting

Patterns exist to **reduce complexity**, not to "look professional". Misused / half-used / premature patterns are all debt.

**Signals**
- **A single-method, stateless interface** → should be a **func type** (the `http.HandlerFunc` trade-off); do not build an empty struct + interface + factory.
- A `switch` that picks an implementation by type **and will grow with the business** → should be a **registry (data-driven registration)**, not a hard-coded factory `switch`.
- A pattern **used halfway**: there is a Strategy interface, yet the factory still does `if instanceof` / special cases.
- **YAGNI violations**: abstracting early for "possible future flexibility"; an interface with one implementation and no visible reason for a second.
- An in-memory cache + DB both writing the same state → creates "two-phase inconsistency" (prefer a single source of truth read from the DB each time).

**Ask yourself**
- Does this abstraction have a second implementation **now / in the foreseeable future**? If not → do not abstract; wait for it to arrive.
- Will this `switch` grow with the business? If yes → registry. If not (fixed protocol) → a `switch` is fine; do not over-design.
- Is this pattern **complete**? Or is an `if` special case left behind breaking it?

**This repo**
- ✅ Done: `authStrategy` went from "single-method interface + 4 empty structs + factory" → **a func type**, with the factory returning func values. Less code, and `ireturn` went away naturally.
- ❌ To be eliminated (old docs once said "✅ reasonably kept"; now overturned): **one typed multi-method contract per seam** like `CalendarProxy/MailProxy` is the star topology the current design kills, not an abstraction to keep. Normalization relies on the seam name + the generic `CallVerb(verb, json.RawMessage)`, not per-seam interfaces. They still live today in `cmd/server/blockwire/block_{calendar,mail}.go`, as step ⑤ leftovers awaiting deletion (see above). See block-model.md §"'block' and 'supplier' are not two kinds of thing".

---

## 6. Naming and intent

Names are **the first layer of documentation**, and the one that rots most easily. A name must == its behavior.

**Signals**
- The function name says `get` but it has side effects; says `list` but returns one item; returns `ok bool` that really carries error semantics.
- Misnomer: the module name does not match what it actually does (e.g. `seo` is really landing/reader).
- Abbreviations / jargon only the author understands.

**Ask yourself**
- Without looking at the implementation, from just the **signature + name**, can you guess correctly: what it does, whether it can fail, whether it changes state? Guessed wrong → rename it or change the signature.

---

## 7. State, invariants, concurrency (the source of flakes)

**An invariant must have exactly one guard point**, ideally enforced by **a data structure/constraint**, not by "callers remembering to do things in order".

**Signals**
- An invariant is maintained by **call order** ("deactivate the others first, then activate this one") rather than an exclusive write/constraint.
- Shared mutable state + **order dependence** (`rows.find` depends on the order `GET` returns).
- Deriving "currently selected/active" from "the first match in the list", when the list has no deterministic order.

**Ask yourself**
- Does this invariant still hold if two requests run **concurrently** / **the order changes**?
- Is this test **truly deterministic**, or did the order just happen to be right? **A flake is a design smell, not "rerun it and it's green".**

**This repo**
- ✅ Cohesive invariant: one active per category is guaranteed **exclusively** by SQL `SET active = (block_id = $1)`, not by callers clearing the others first.
- ❌ Real flake (fixed): the test used `rows.find(category && connected)` to get "the connector just installed" = **the first** connected one in that category — when several combos share an owner it got the old combo's connector, relying on luck with the `GET` order. Changed to locate it precisely **by id set difference** (order-independent).

---

## 8. Boundaries and leaks

The base should hold only **base logic**; specific things are externalized as **data / plugins** and pulled in at assembly time.

**Signals**
- **Concrete provider names** (`GCal`, `SendGrid`, `google`) appear in base config / code.
- The adapter / usecase layer imports concrete types it **should not know about**.
- A "generic" layer hides special cases that serve only one implementation.

**Ask yourself (the one-sentence criterion)**
- **Delete this concrete supplier / plugin — does the base still compile?** Yes = clean; no = leak.

**This repo**
- ✅ Done: deleted the dead `GoogleAuthURL/...` from the base config — the built-in gcal's endpoint is resolved from `${GOOGLE_*:-prod}` in **its own** `spec.yaml` via `builtins/env.go`; the base knows nothing about "google".
- Guard: `check-supplier-boundary` (credentials may only go through the supplier layer) — this one **can** be guarded by a script, and is already in lint.

---

## 9. The shape and semantics of errors

Errors must be **graded**: expected business states (not-found, shape-mismatch, not connected) vs real faults (DB, network, broken config).

**Signals**
- **The same** error expresses both "not found" and "blew up", so the caller can only treat them all alike.
- No sentinel / typed error; the caller decides by **string-matching** the error message.
- Error messages **leak technical details** to end users (stacks, exit codes, jargon) — see CLAUDE.md "Errors must be user-friendly at the UI".

**Ask yourself**
- Does the caller **need** to distinguish these failures? If yes → an `errors.New` sentinel / typed error, so `errors.Is/As` can tell them apart.
- What does this error become when it bubbles up to the UI? Plain language, or a stack?

---

## 10. Test honesty

Tests must assert **correct results**, not "didn't crash".

**Signals**
- Asserting only `status == 200` / `len > 0`, not **whether the content is right**.
- The test is **green, but actually went through a fallback / the wrong connector / a default value** (false green).
- A mock replaces the very logic under test.

**Ask yourself**
- If the implementation **quietly took the wrong branch** (used the wrong provider, returned a cache, swallowed an error), **would this test go red**? Would not go red = not guarded.
- Does the assertion check "the behavior happened" or "the behavior is correct"?

**This repo**
- ❌ False green (fixed): the happy-matrix CalDAV combo was once "green", but booker was actually hitting gcal (the wrong connector); this was only found through the mock request log. Lesson: **pin the assertion to "the event landed in the correct provider's collection"**, not merely "there is an event".

---

## Quick reference

| # | Dimension | One-sentence criterion | Can lint guard it |
|---|------|-----------|:----------:|
| 1 | Control flow / if | A `switch` that grows with "business kinds" = bad; closed over a "fixed contract" = good | Partly (cyclomatic complexity) |
| 2 | Fail loud | Before swallowing an error, ask "could a real fault be mixed in here" | ✗ |
| 3 | Single source of truth | Do not store derived values; adding one kind should change only one place | ✗ |
| 4 | SOLID | Cross-layer deps must be interfaces; split god-structs narrow; extending does not change the core | Partly (god-struct line count) |
| 5 | Design patterns | Single-method stateless → func; a growing switch → registry; no second implementation → do not abstract | ✗ |
| 6 | Naming | Signature + name alone let you guess behavior/failure/side effects | ✗ |
| 7 | State/concurrency | Invariants guaranteed by data/constraints, not call order; flake = design smell | ✗ |
| 8 | Boundaries | Delete the concrete plugin and the base still compiles = clean | Partly (arch-lint) |
| 9 | Error semantics | Failures the caller must distinguish get a sentinel/typed error | ✗ |
| 10 | Test honesty | If the implementation quietly takes the wrong branch, does this test go red | ✗ |

---

*This guide itself must evolve: every time we find a real bug that "lint did not catch and a person nearly let through", come back and add its smell to the matching item.*
