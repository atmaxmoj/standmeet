# What the block shape unlocks

Status: **seed / 2026-09-09.** Written function-first: what becomes possible, for whom, and only
then what code that implies. Assumes the vocabulary of `mechanism.md`.

## The central claim

We have **two plugin axes** today (`docs/design/backend-domain-modules.md` — outbound converging at
the dispatcher, inbound at hostdesk). Under the block shape they stop being two things:

| | today | as blocks |
|---|---|---|
| connector | outbound capability, dispatcher converges it | a tree; the leaf is a vendor adapter |
| agent capability | inbound capability, hostdesk converges it | a tree; the leaf is an MCP server |
| retry · quota · egress · approval · redaction | **each one grown into the core of whichever axis needed it first, and unavailable to the other** | **the same blocks, usable on either tree** |

That last row is the payoff, but state it precisely, because the obvious version of the claim is
false. **Checked 2026-09-09: retry exists on the connector axis only** (`retrypolicy.go`,
`mail_retry.go`, `invoke_background.go`, and the protocol adapters — six files); `internal/capabilities/`
has none. Quota is the mirror image: `capquota` lives on the capability axis, and connectors have no
rate limiting.

So the cost today is not duplication. It is that **each cross-cutting behaviour is trapped on the
side where it was born.** `retrypolicy.go` knows which failures deserve a retry — an `invalid_grant`
must not be retried — and that judgement is unavailable to the capability axis, which walks an
entirely different path (`capabilities/mcpclient`). Wanting a retry there means writing a second
one. Wanting a rate limit on a connector means writing a second `capquota`.

The duplication has not happened yet. It is *scheduled*.

### The two axes are already stacked, not parallel

Worth stating because it decides whether the distinction survives at all: `booker` — an agent
capability, an MCP server — already consumes the connector contracts (`contract.MailMessage`, the
owner's calendar). A real call chain is one stack:

```
visitor's model
  └── calendar_book          agent capability (booker)
        └── ctx.calendar     category contract
              └── retry / quota / egress
                    └── google-calendar    vendor adapter
```

"Two axes" names **two convergence points** (outbound at the dispatcher, inbound at hostdesk), not
two disjoint populations. Splitting one stack down the middle is exactly what forces the
cross-cutting logic to be written twice.

**So as an architectural split it should dissolve.** What must survive is two *per-block
attributes*, which the axes have been carrying implicitly:

| attribute | values | who cares |
|---|---|---|
| trust level | in-process trusted / out-of-process sandboxed | third-party code a visitor can trigger must stay under bwrap |
| who decides visibility | the owner (SlotStore, per owner+category) / an access code (ACL) | two different authorisation questions |

Today "it is a visitor capability" *implies* "it is sandboxed". Making that an attribute is better —
one block can serve both the owner and a visitor without being written twice — but it converts an
implication into something a person can forget to write.

**Therefore the omission must be unmountable**, in the manner of `dsh-agent-presets` refusing a
service row with no realm: a block reachable by a visitor that has not declared its confinement is
**refused at mount**, never defaulted to something permissive. We already own this move —
`connectorDeclaredOps` panics at boot for a manifest op with no implementation, precisely so it is
"never discovered only after the owner clicks it".

## Axis 1 — connectors

### Why the shape felt wrong

`internal/connector/` contains `egress.go`, `retrypolicy.go`, `mail_retry.go`,
`invoke_background.go`, `credform.go` beside `slots.go` and `hub.go`. The first group is
**cross-cutting behaviour welded into the core**. It does not belong to "calendar" or "mail"; it
belongs to *every* connector. So:

- adding a connector means meeting a pile of behaviour already grown into the core;
- adding a *behaviour* means editing the core, and therefore editing us.

The Hub/Slots layer is not the problem. The problem is that **the cross-cutting things have nowhere
to stand**.

### What blocks change

> **The stacking diagram that stood here is withdrawn — 2026-09-10.** It showed
> `retry(3) → quota → egress-guard → google-calendar`, each block wrapping the next. The owner
> overruled the premise: **each block does its own retry.** What shipped is flatter and is the part
> that carried the weight anyway.

```
calendar.book                    (consumer — names a SEAM, never a supplier)
  requires: [calendar]
        │
        └── whichever block declares `provides: calendar`
              google-calendar · a CalDAV block · anything else the owner installs
```

- **A new supplier is a new manifest.** It touches no consumer and no core: `calendar.book` says
  `requires: [calendar]` and has never contained the word "Google".
- **Which supplier applies is the owner's choice**, held on their connection row and read at every
  call — not a branch in our code, and not frozen into a session.
- **The vendor adapter gets thin**: how to talk to Google, nothing else.
- **A third party can open a new seam**, because a seam is a name two manifests agree on rather than
  a row in our composition root. That row is what welded `mail.send` to `requires: [smtp]` — "smtp"
  was not any manifest's name, it was a string hand-written in the assembly code.

### What stays

The category contract still has to exist and still has to be written. Per-owner resolution already
works (`SlotStore.ActiveConnectorID(ownerID, category)`) and is, in realm terms, the same idea we
would keep.

## Axis 2 — agent capabilities (MCP)

### From subtraction to composition

Today "what can this code do" is answered by evaluating **`global ∧ role ∧ ¬code-deny`** against one
process-global registry. It is a **subtractive** model: everything exists, then three layers remove.

The realm makes it **additive**: a session mounts a composition, and it has exactly what it mounted.
`dsh` states the same idea for its agent presets:

> "what this preset owns is the PRESENTATION of that registry for this agent alone. Native sessions
> run beside this one in the same process, each seeing its own catalog."

The difference is not implementation, it is **reasonability**:

- additive — "what can this code do?" is *read the composition*.
- subtractive — it is *simulate three layers of intersection*, which is why
  `block-acl-hierarchy.md` needs a doc and a whole matrix of specs.

### What that changes in practice

- **The owner can see a code's toolset as a list**, not as the outcome of a rule evaluation.
- **A capability that fails to bind unmounts cleanly** instead of being silently hidden. (Today the
  backend logs `visitor capability failed to bind — hidden from this session` and the owner sees
  nothing; found live on 2026-09-08 when a plugin died at import.)
- **Cross-cutting wrappers become available here too**: `capquota` stops being a module the core
  calls and becomes a block wrapped around the tools it meters; the same for redaction and approval.

### The cost, stated plainly

This changes a **product rule**, not just an implementation. The ACL specs (`acl-block-matrix`,
`acl-skill-matrix`, and their siblings) assert the subtractive model. They would change — correctly,
because the definition of "what a code can do" changed. That is the one part of the test suite that
should break, and it must break deliberately, not as collateral.

## The microsite side

Smaller, and mostly downstream of one decision. Blocks make a page a **composition document** rather
than React source, which matters for us specifically because our product thesis is that the AI does
the curating: today `microsite.write_file` has the AI writing source, and a mistake surfaces as a
vite error after a build. A composition can be **validated at mount** — the same way
`connectorDeclaredOps` already panics at boot for an op with no implementation.

It also gives: per-code composition at **block** granularity (today `codes.set_microsite` is
whole-page), rollback/diff of the composition (today we version builds, not compositions), and a
block that crashes unmounting itself instead of blanking the page.

## What is NOT unlocked, and must not be conflated

**Isolation.** The block shape is about composition, not confinement. The two questions are separate
and stay separate — the shape says nothing about who may run what:

| | who wrote it | runs where | threat | confined by |
|---|---|---|---|---|
| a third-party MCP server | third party | a sandboxed process our block spawns | over-reach, exfiltration | bwrap + egress allowlist ✅ |
| wrapping an npm package | third party | one install, once, on our machine | `postinstall` | scripts off at wrap time (`microsite-build.md`) |
| a page block at runtime | third party | the visitor's browser | reading the visitor's credentials | iframe for widgets; **CSP** for everything (`isolation.md`) |
| an owner-installed connector spec | third party | our machine | SSRF, credential leak | the `net` block ✅ |

An earlier draft claimed that our blocks "cannot stack, because visitor capabilities run
out-of-process". That was wrong on its own terms: the block doing the wiring is in-process either
way, and the sandbox confines the process it spawns. Stacking is available everywhere
(`block-model.md`).

## Test-suite readiness

Checked 2026-09-09 across 614 e2e specs: 17 read the database directly, 25 call `/internal/`
endpoints, 129 name a specific vendor.

Reading durable state is **not** implementation coupling — `connector-refresh-keeps-scopes` asserts
that a refresh which omits `scope` must leave the granted scopes byte-identical, which is a product
truth under any architecture. The suite is largely architecture-independent and can therefore act as
the safety net for this restructuring.

The exception is the ACL matrix above: those specs encode the *rule*, so a move to composition
changes them by design.
