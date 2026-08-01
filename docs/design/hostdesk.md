# Host desk — the inbound convergence point (and how a plugin declares what it needs)

**Status:** design (2026-08-01). Completes `constrained-reachback.md`, which fixed the
vocabulary but never built the place that owns it. Mirrors `facade-parity.md` /
`facade-directions.md` on the inbound side.

## Where we actually are

`constrained-reachback.md` states the target: *"The host OWNS one closed reach-back
vocabulary. A sandboxed capability may only CALL those ops; it may never ADD an op …
Writing a capability-specific host op stops compiling, because `Handle(anyOp)` is gone."*

Half of that landed. The host ops were pulled into per-domain registrars
(`RegisterConversationReadOp`, `RegisterInvokeOp`, `capstoreroutes.RegisterOps`, …), so
the *implementations* are no longer kernel-side capability logic. But:

1. **`Handle(op string, h Handler)` is still open.** Any string, any handler
   (`internal/capabilities/capsocket/server.go:87`). Nothing stops a new
   capability-specific op; the compiler has no opinion.
2. **There is no place that enumerates the vocabulary.** To answer "what may a sandbox
   call?" you read four hand-written wiring functions in the composition root.
3. **The plugin's declaration is at the wrong grain.** `Manifest.Transport.Sandbox`
   declares `HostSockets []string` — a list of *file paths*
   (`/run/standmeet/booker.sock`). A file path says nothing about which ops belong on
   it, so the composition root must decide, by hand, per capability.

(3) is what makes (2) inevitable, and (2) is why the composition root grew four
`*_gateway.go` files (~520 lines): `retrieval_socket.go`, `summarize_gateway.go`,
`mail_sender_gateway.go`, `booker_gateway.go`.

The outbound side already solved the same problem. This design is its mirror.

## The invariant

> The host publishes **one** vocabulary of reach-back ops. A capability **declares
> which of them it needs**; it can neither add an op nor reach one it did not declare.
> A declaration naming an op the host does not publish is a **boot failure**, never a
> runtime surprise.

## Model — five layers, mirroring the dispatcher

```
outbound:  domain declares Op   → facade re-exports → dispatcher.Collect → faces project
inbound:   domain declares HostOp → facade re-exports → hostdesk.Collect → sockets project
```

### 1. Vocabulary (neutral package)

```go
// HostOp —— one thing the host lets a sandboxed capability ask for.
type HostOp struct {
    Name        string            // "conversation.read" — an entry in the fixed vocabulary
    Description string
    Invoke      capsocket.Handler // func(ctx, req json.RawMessage) (json.RawMessage, error)
}
```

Deliberately **not** `facadeparity.Op`. Outbound identity is an owner id; inbound
identity is a **session** (owner + conversation), host-planted on the tool-call `_meta`
and forwarded inside the request. Sharing one type would blur two different identities.

### 2. The domain declares its host ops

Each domain that owns sandbox-reachable data declares them next to its outbound ops:

```
internal/conversation/ops/host.go   → conversation.read
internal/corpus/ops/host.go         → corpus.search / read / list / links / map / …
internal/connector/…                → connector.invoke
internal/capabilities/capstore…     → capstore.insert / query / count
internal/capabilities/capconfig…    → capconfig.get
internal/owner/ops/host.go          → owner.meta
```

Today these live in `internal/routes/*routes` — the routes layer, i.e. a face-ish
place. Same move as outbound: **the domain says what it can do**, the convergence point
only collects.

### 3. The convergence point

`internal/routes/hostdesk`, symmetric with `internal/routes/dispatcher`:

```go
type Deps struct { /* filled by the composition root */ }

// Collect —— the complete inbound vocabulary. One line per domain.
func Collect(d *Deps) []HostOp
```

This file **is** the answer to "what may a sandbox call?". It imports domain facades and
nothing else.

### 4. The capability declares what it needs (grain fixed)

```go
// mcpplugin.Manifest.Transport.Sandbox
HostOps []string   // ["connector.invoke", "capstore.query", "capconfig.get", "owner.meta"]
```

`HostSockets` disappears: the socket path is **derived** by the host
(`/run/standmeet/<plugin-id>.sock`), not written into the manifest. A manifest can no
longer name a file, only a capability set.

### 5. The composition root is one line

```go
wireHostDesk(ctx, d)  // for each manifest with HostOps: listen → take those ops from
                      // Collect → serve
```

An op named in a manifest that `Collect` does not publish **panics at boot** — the same
rule as `connector.Manifest.OwnerOps`. A declaration that lies must not start.

`Handle(op, h)` becomes unexported / desk-internal. Registering an op outside the desk
stops compiling, which is what `constrained-reachback.md` asked for.

## Gates

- `check-hostops-via-desk` — a socket may only take ops from `hostdesk` (mirror of
  `check-routes-via-dispatcher`).
- `hostdesk` may import only `internal/<domain>/facade` plus the neutral vocabulary
  (mirror of `check-boundary-thin`).
- Boot: every declared op exists (panic), and — optional, later — every published op is
  declared by at least one capability, so dead vocabulary is visible.

## What disappears

| file | lines | becomes |
|---|---|---|
| `cmd/server/retrieval_socket.go` | 84 | 6 names in the retrieval manifest |
| `cmd/server/summarize_gateway.go` | 39 | 3 names in the summarize manifest |
| `cmd/server/mail_sender_gateway.go` | 120 | 1–2 names in the mail-sender manifest |
| `cmd/server/booker_gateway.go` | 274 | 4 names in the booker manifest |

## Not covered here

The booker host-side leftovers that are **not** reach-back —
`booker_quota.go` (a per-code booking gate) and `booker_code_config.go` (booker's field
on an invite code) — are a different missing mechanism: **per-code capability config**.
Today `capconfig` is per-owner only. Until that exists, those two files are the debt
made visible, not the debt paid.

---

# Periodic jobs — the same meta-structure, one size smaller

## The problem

`resume_draft_sweep.go` (a jobs-plugin concern: resume drafts expire after a day) and
the workspace sweep inside `sandbox_workspaces.go` are **plugin business written in the
composition root**, for one reason: the ticker and the job registry live there.

## The design

```go
// mcpplugin.Manifest
Jobs []PeriodicJob

type PeriodicJob struct {
    Name  string        // "resume-draft sweep" — shown on the Monitor panel
    Every time.Duration
    Op    string        // the host op to call — same vocabulary as HostOps
}
```

The host owns one scheduler: register with `jobRegistry` → run once at boot (so
`last_run` has a definite value) → ticker → `Report(ok|error)`.

The split is fixed: **what to do** is whatever `Op` names (it lives in a domain or a
plugin); **when to do it, and the bookkeeping** belong to the host. Declaration is data,
exactly like `OwnerTools`, `Config`, `connector.OwnerOps` and `HostOps`.

Both sweep loops collapse into one line each in their manifest.
