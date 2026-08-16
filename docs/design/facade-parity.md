# Facade parity — one capability registry, every facade conforms or the build breaks

**Status:** **half of this is now the wrong shape (owner, 2026-08-15).** The invariant below
still holds; the *mechanism* does not.

> "facadeparity 不是结构保障，dispatcher 是结构保障，不应该有明文写的任何 parity。所有的程序
> 向外的接口由 dispatcher 走，route 自己 wire，mcp 组装也从这边组装 —— 没有任何人要明着说
> '这是个 parity'。**结构 = 没有职责类。**"

The invariant offers two ways to satisfy it — *generated from* the registry, or *verified
against* it. **Only the first one is structural.** The second is a responsibility class: a
`Reach` someone must declare, a `Conform()` someone must run, a `Violation` someone must read,
and (worst) `internal/infra/paritymanifest`, a 123-op hand-kept ledger whose own comments already
sentence it to death ("台账在替结构记账 … 这正是这个包最后要消失的方式").

**What the code shows today (verified 2026-08-15):**

| Facade | How it is built | What `Conform()` can find there |
|---|---|---|
| owner MCP | **generated** — `mcphandle/from_dispatcher.go:36` walks the dispatcher's ops; taking them *is* registering them | nothing: "missing" is structurally impossible |
| admin HTTP | **hand-written** — ~40 lines of `r.Get("/corpus/{genre}", h.dispatchOp(face, "corpus.list", …))` | everything: this is the only face that can forget |

So the entire verification apparatus exists to cover **one** hand-wired facade. Adding one op
(`corpus.search`, 2026-08-15) took **three** hand edits — the domain's alias table, the
dispatcher's `Collect`, and an admin route — and each is a place to forget.

**Target shape:** the admin HTTP face is generated from the same op set, exactly as MCP is.
`Kind` already fixes the verb (Read→GET, Query→QUERY, Action→POST/PATCH/DELETE), so a route per
op is derivable; args stay JSON, which the dispatcher already speaks. Then:

- `Reach`, `Facade`, `Exposure`, `Violation`, `Conform`, `Report` — **delete**; nothing left to check.
- `internal/infra/paritymanifest` — **delete** (its shrink-only ratchet was the countdown).
- What survives in `facadeparity` is only the **declaration vocabulary** (`Op`, `Invoke`, `File`,
  the error helpers) — and that should move under a name that says what it is, since "parity"
  will no longer be a thing anyone can write.
- Adding an op becomes: declare it in the domain. One place. No ledger, no check, no reason to
  name the concept at all.

Everything below is the 2026-07-09 design as written, kept for the reasoning that produced the
one-registry invariant. Read the mechanism half as history.

---

**Status:** design (2026-07-09). Supersedes the `[[ui-mcp-parity]]` placeholder in todo.md.

## The problem

An owner drives their instance through **outgoing facades**: today the **MCP** tool
surface (Claude/Cursor) and the **HTTP admin API** (web /admin). Both are thin
adapters over the same `usecases.*` functions. Tomorrow there may be more — an **IM
gateway**, an **SDK**, a **CLI**.

The facades are hand-written independently, with **no structural link** between them.
Nothing — not the compiler, not a test, not startup — knows that a capability exposed
on one facade *should* exist on another. So the failure mode is silent:

> I add a feature to the /admin UI and forget to add the MCP tool. Nobody tells me.

An audit (a checked-in checklist) catches this *once*. It does not make the mistake
**impossible**. This design does.

## The invariant

> There is exactly **one** canonical registry of owner capabilities. Every facade is
> either **generated from** it or **verified against** it. A capability that a facade
> is supposed to serve but doesn't → **build / boot / test failure**, never a silent
> omission.

Omission stops being a thing you can do by accident. Leaving a capability off a facade
becomes an **explicit, reviewed declaration with a written reason**, or it doesn't ship.

## Model

Three pieces. All facade-agnostic — none of the machinery names "mcp" or "admin".

### 1. Capability — one owner operation

Operation grain (verb on a resource), grouped by resource so reads+writes of the same
thing sit together (matches how ownercore already bundles `roles.{create,list,delete}`):

```go
Resource{
  Name: "roles",
  Ops: []Op{
    {ID: "roles.list",   Kind: Read,   Invoke: usecases.ListRoles,  Reach: OwnerRead},
    {ID: "roles.create", Kind: Action, Invoke: usecases.CreateRole, Reach: OwnerAction},
    {ID: "roles.update", Kind: Action, Invoke: usecases.UpdateRole, Reach: OwnerAction},
    {ID: "roles.delete", Kind: Action, Invoke: usecases.DeleteRole, Reach: OwnerAction},
  },
}
```

Each Op carries its input schema, the usecase it invokes, and its **Reach** — a
*policy*, not a list of today's facades:

- `OwnerAction` — every owner-action facade must expose it.
- `OwnerRead` — every owner-read facade must expose it.
- `OwnerAction.Except(BrowserBound)` — all action facades that can do browser flows.
- `Only(MCP)` **+ Reason** — genuinely single-surface; the reason is mandatory.

Reach is declared by **intent/class**, never by enumerating `{MCP, Admin}`. That is
what makes it survive a new facade (see Extensibility).

### 2. Facade — a projection with a capability profile

Each facade declares **what classes of capability it can carry**, and **how it
conforms** (generated vs verified):

```go
Facade{Name: "mcp",   Profile: CanServe(AllActions, AllReads),               Conformance: Generated}
Facade{Name: "admin", Profile: CanServe(AllActions, AllReads, Browser, Multipart), Conformance: Verified}
// future — register a descriptor, nothing else changes:
Facade{Name: "im",    Profile: CanServe(AllActions.Except(Browser, Multipart), AllReads), Conformance: Verified}
```

- **Generated** — the facade is *built by walking the registry*. It literally cannot
  miss a matched capability; there is no hand-written step to forget. (MCP is already
  almost this — ownercore is a list.)
- **Verified** — the facade is hand-written (REST shapes: GET lists, path params,
  multipart), but a **boot assertion + test** cross-checks it against the registry.

### 3. The conformance rule — one cartesian check

For **every** facade F and **every** operation C:

> if `C.Reach` targets F's class **and** `F.Profile` can carry C
> → F **must** actually expose C. Missing → red. Orphan (F exposes something with no
> registry entry) → red.

The rule never mentions a concrete facade name. It runs `registry × facades`.

## Extensibility — the whole point

**Add a facade** = write one `Facade{}` descriptor (profile + conformance mode). The
conformance test *immediately* enumerates every capability that facade now owes — you
cannot ship it half-built.

**Add a capability** (marked `OwnerAction`) = every facade whose profile can carry it —
**including a facade added later** — is required to expose it. Same rule, same red.

So "forgetting" is impossible **uniformly across N facades**, not just for the MCP↔admin
pair. A facade added a year from now retroactively makes today's `OwnerAction` caps its
obligations, and the test won't go green until they're met.

## Scope

- **Reads are in.** A read is just an `Op{Kind: Read}` on a resource already in the
  table; grouped by resource it adds no conceptual bloat.
- **Grain = operation, grouped by resource.** ~20 resources, ~100 ops total. That count
  *is* "everything an owner can do" — the enumeration is the deliverable, not overhead.
- **Intentionally single-surface (declared, with reason):**
  - auth/bootstrap: claim, login, recover, account (email/password/full-name/recovery),
    keypairs → `Only(Admin)` "credential bootstrap, not a driveable capability".
  - `oauth_connect` / callback → `OwnerAction.Except(BrowserBound)` — browser flow.
  - custom-page authoring → `Only(MCP)` — existing product decision.
  - raw-secret setters (provider API key) → decide at backfill; likely `Only(Admin)`.

## Plan (test-first; the audit falls out for free)

1. **Registry + conformance harness + proof.** Build the `Resource/Op/Facade` types and
   the cartesian conformance check as a boot assertion + go test. Prove it bites:
   register one capability as `OwnerAction`, wire it to admin only → **RED**; add the MCP
   binding → **GREEN**. This is the "omission is now impossible" proof.
2. **Backfill the manifest = the audit, mechanically.** Enter every current owner
   operation with its *true intended* Reach. Every real gap (MCP missing `approve_request`,
   `booking.set_policy`, per-code ACL, ip-bans, observability reads, `writing_unpublish`,
   …) now surfaces as a **RED** — the gap list is produced by the machine, not by hand.
3. **Turn reds green.** Add the missing MCP tools (thin wrappers over usecases that
   already exist) until conformance is green. Each intentional asymmetry gets its
   `Only(...)+Reason` instead.
4. **Lock it in.** The conformance test runs in `make lint`/CI. From here, any new
   facade or capability that drifts is red before merge.

## Why this over a checklist

A checklist is vigilance; this is structure. The registry is the single thing you edit
to add a capability, and it's the single thing every facade is measured against. The
mistake you named — "UI shipped, MCP forgotten" — requires editing the registry (or the
boot check fails on an orphan route), and a registry entry marked `OwnerAction` *is* the
MCP tool (generated). The path where the mistake happens no longer exists.
