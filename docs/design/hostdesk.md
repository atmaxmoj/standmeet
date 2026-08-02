# Host desk — the inbound convergence point (and how a plugin declares what it needs)

**Status: BUILT (2026-08-01/02).** Completes `constrained-reachback.md`, which fixed the
vocabulary but never built the place that owns it. Mirrors `facade-parity.md` /
`facade-directions.md` on the inbound side.

## What landed

Everything below, plus the two follow-ons it opened up. Where the text still says
"will" or "should", read it as the record of the decision, not of pending work.

| Piece | Where it lives | Gate |
|---|---|---|
| Inbound vocabulary (`Op`, `Invoke`, socket-path rule) | `internal/infra/hostop` | — |
| Inbound convergence point (`Collect`, `Serve`) | `internal/routes/hostdesk` | `check-hostops-via-desk` |
| Ops ordered BY NAME; path derived from the id | `Sandbox.HostOps []string` | `check-axes-declare-in-data` |
| Periodic jobs: one scheduler, derived schedule | `internal/infra/periodic` | `check-periodic-via-scheduler` |
| Per-code capability settings + quota as declarations | `capconfig` scope + `capquota` | — |
| Both axes declare in data | `backend/capabilities/`, `backend/connectors/` | `check-axes-declare-in-data` |

Deleted along the way: the four `*_gateway.go` files, `internal/routes/{owner,report,conversation,inference}`,
`capsocket.Handle`, `resume_draft_sweep.go`, and booker's three per-code files
(`booker_code_config.go` / `booker_code_store.go` / `booker_quota.go`).

One thing changed shape versus the design below: **the socket path is derived, not
declared at all.** The manifest names ops; `hostop.SocketPath(id)` turns the trusted
plugin id into the path, and the loader injects it as one env var
(`STANDMEET_HOST_SOCKET`) shared by every capability. Each plugin used to invent its own
name for that variable, so the same fact had four names.

## Where we were

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

## Not covered here — and how it turned out

The booker host-side leftovers that are **not** reach-back —
`booker_quota.go` (a per-code booking gate) and `booker_code_config.go` (booker's field
on an invite code) — were a different missing mechanism: **per-code capability config**.

**Built.** `capconfig`'s mount point became a *parameter* (`Scope`: owner or code) rather
than a second copy of the package, and two new manifest declarations replaced all 294
lines:

```yaml
code_config:                 # the fields this capability occupies on an invite code
  - key: max_bookings
    type: int
    default: "null"          # not set = no limit; the "empty" here means something
quota:                       # allowance, usage, and how a row names its code
  config_key: max_bookings
  collection: bookings
  code_field: code_id
```

`capquota` executes that, and `Allow`/`Remaining` share one count — they had been two
separately written hooks, and when booker was externalized only the gate came back, so
`quota_remaining` was nil for months while the frontend contract still promised it.

---

# Periodic jobs — the same meta-structure, one size smaller

## The problem

`resume_draft_sweep.go` (a jobs-plugin concern: resume drafts expire after a day) and
the workspace sweep inside `sandbox_workspaces.go` are **plugin business written in the
composition root**, for one reason: the ticker and the job registry live there.

There was a third loop nobody had counted: corpus's Meili reconcile ticked every 8s for
its entire life **without ever registering**, so the panel that answers "what runs here"
had never heard of it. A hand-written loop forgets the bookkeeping — that is the failure
mode, not the loop itself.

## The design — as built

`internal/infra/periodic` owns the loop, the interval and the bookkeeping. Each side owns
only *what to do*, and declares it where that knowledge lives:

```go
type Job struct {
    Run   Run           // what to do
    Name  string        // "resume-draft sweep" — shown on the Monitor panel
    Every time.Duration // how often; the panel's schedule string is DERIVED from this
}
```

Three declaration sites, one per kind of owner:

| Who | How it declares |
|---|---|
| a plugin | `capabilities.PeriodicWorker` — a new optional hook beside `CapabilityRegistrar` / `AdminRouter` |
| an axis's own subsystem | its own `periodic.go` (`sandboxws.Manager.PeriodicJobs`) |
| a domain | its own usecase (`corpus.IndexPeriodicJobs`) |

The composition root collects them, one line per source, and starts them.

Two things are structural rather than remembered. **Registration belongs to the
scheduler**, so a job cannot run unseen. And the schedule string shown on the panel is
computed from the interval that actually fires — it used to be hand-written *next to* the
interval, i.e. two sources for one fact, free to say "every 5m" while the ticker fired
hourly.

The original sketch routed the work through a host `Op` named in the manifest. That was
wrong for these three: none of them belong to a sandboxed capability, and running them
through the socket would have meant a round trip to reach code already in the process.
The declaration is the same shape; only the callee is direct.

---

# The two axes get the same address

Once a capability's declaration stopped being wiring, it stopped belonging in the wiring
directory. `backend/capabilities/<id>/manifest.yaml` now mirrors `backend/connectors/<id>/manifest.yaml`
exactly — two plugin axes, one address structure, both `go:embed`'d, both read by a small
loader that translates the on-disk shape into the host's shape.

What that removed, beyond the 250 lines of Go literals: the socket path is no longer
authored anywhere. `host_ops` names *what* a capability wants; `hostop.SocketPath(id)`
derives *where*, from an id the host trusts; the loader injects it as
`STANDMEET_HOST_SOCKET` — one variable name for every capability, where there used to be
four names for the same fact and four hand-written paths to keep in sync with them.

A capability that orders nothing gets no socket and no variable. Offline by construction,
not by remembering to leave a field empty.

`check-axes-declare-in-data` holds both halves: no `mcpplugin.Manifest` literal outside
the loader, and no socket path inside a declaration.

---

# The composition root

`cmd/server` had grown to 36 files with no filing rule — the filename could not answer
"what is this doing here?". Six prefixes now do, stated in `cmd/server/doc.go`:
`main.go`, `boot_*`, `wire_*`, `axis_cap_*`, `axis_conn_*`, `port_*`, `cmd_*`.

`port_*` is the one worth naming explicitly: the root **implementing a narrow port a
domain declared**. That is the shape that keeps a domain from having to know about
`owner` / `inference` / redis in return, and it had been scattered under five different
suffixes (`*_adapters.go`, `*_adapter.go`, `*_validators.go`, and two files named after
the thing they implement).

---

# What is still open

**`ownercore` is down to one tool: `writing_create`.** Everything else went home to its
domain. That last one is blocked on a product decision, not a mechanism: the admin face
posts multipart (inline images travel with the form) while MCP posts a list of URLs for
the server to fetch — a byte stream does not fit through a JSON op. Unifying them means
first splitting "upload an asset" into its own step, which is the same work as giving
every genre attachments / images / a hero image. When that lands, the package is deleted
outright.
