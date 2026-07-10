# Facade directions + the API-key facade

> Companion to `facade-parity.md`. That doc built the parity gate for the **owner** side
> (owner-MCP ↔ admin HTTP, paid down 56→0). This doc extends the model with **direction**
> (trust planes) and specifies the fourth facade: the **API-key surface** — outward,
> non-agentic, role-scoped. Written as a self-sufficient implementation handoff; a session
> with zero prior context should be able to build from this doc alone.

## 1. Why

Two forces meet here:

1. **Product**: StandMeet needs a programmatic outward surface. Today an outsider reaches the
   instance only through the visitor chat (access code, LLM in the loop, gas-metered) or the
   anonymous public pages. There is no way for a *program* to call the owner's capabilities
   directly. The API-key facade fills that seat: **like a code, minus the brain and the gas**
   — same role-scoped grant, but endpoint-in / structured-data-out, throttled by rate limits
   instead of turn/session quotas.

2. **Mechanism gap (verified in code)**: the parity mechanism (`internal/facadeparity`) has
   **no direction axis**. Its only base reaches are `OwnerAction()` / `OwnerRead()`
   (`parity.go`), and the manifest wires exactly two facades — `mcp` and `admin` — both
   owner-facing (`paritymanifest/manifest.go`: "the two owner-facing facades wired today").
   `mustExpose` is just `servesSide && carriesAll`. Consequence: naively registering an
   outward facade as `ServesRead: true` would make **every `OwnerRead()` op "missing" on
   it** — the ratchet would *demand* exposing admin reads outward. The mechanism must learn
   direction before any outward facade touches it. The only direction guard that exists
   today is `capreg.Shape` (`shape.go`: `visitor_only` / `owner_only` / `both`) +
   `VisitorBinding() → ErrHidden`, a runtime gate the parity model never consults. This
   design fuses the two.

## 2. The model: two planes, one dial

A facade's identity = **the actor it serves**. Parity groups facades one level up, by
**trust plane** — actors holding the same grant level.

There are exactly **two planes**:

| Plane | Actors | Grant | Parity semantics |
|---|---|---|---|
| **owner** | admin console (admin HTTP), owner's AI (owner-MCP); future: Electron, IM ingest | login session / Sigv1 keypair | **completeness** — every owner op on every owner facade (built; `KnownMCPGaps()` empty) |
| **outward** | visitor humans (chat via code / BYOAI), visitor **programs** (API key — new), anonymous public (web pages, crawlers) | role, resolved from the grant | **role-consistency** — a role-grantable cap renders on every outward facade unless class-excepted; anonymous = the implicit **public role** |

**"Public" is not a plane.** The anonymous visitor is just the degenerate grant: their role
is the owner's public role (`domain.PublicRoleName`), which is exactly what BYOAI already
scopes to (`buildRoleSnapshotForOwnerPublic`, `usecases/visitor_role_snapshot.go:80`) and
what `published` gates on the reader pages. Within the outward plane, everything is one
line, controlled by ACL:

```
reachable(caller, cap) =
    facade-renderable(cap)          # can this facade physically carry it (Agentic class etc.)
  ∧ opened(cap)                     # owner made it an API candidate (API facade only)
  ∧ role(grant).grants(cap)         # code role / key role / public role
  − denials(grant, cap)             # per-code / per-key deny rows
```

The dial goes anonymous → keyed → coded on one axis. In principle the owner can someday
grant a capability to the public role itself (anonymous read-only search) with **zero new
machinery** — that is the payoff of collapsing public into ACL.

**The leak invariant** (the reason direction must be structural): *an owner-plane op may
never render on any outward facade.* Enforced twice:

- **Manifest level**: a new `leak` violation kind in `Conform` — any exposure containing an
  op whose plane ≠ the facade's plane is a hard red (boot panic + test failure), checked
  both ways. Not "not required" — **forbidden**.
- **Registry level**: `ShapeOwnerOnly` caps already return `ErrHidden` from
  `VisitorBinding`; the API facade assembles through the same path (see §5), so an
  owner-only cap is structurally incapable of appearing on it. A conformance test injects a
  fake owner op into an outward exposure and asserts red.

## 3. Wave A — direction vocabulary in `facadeparity`

Pure mechanism, no live behavior change. Unit tests in `parity_test.go` style.

- `Plane` type: `PlaneOwner`, `PlaneOutward`. Field on `Facade`; carried by `Reach`.
- Constructors: `OwnerAction()` / `OwnerRead()` unchanged in signature — they now set
  `PlaneOwner` internally, so **the existing ~90-op manifest needs zero edits**. Add
  `OutwardAction()` / `OutwardRead()` (Kind stays orthogonal: Read/Query/Action as today).
- New `FacadeClass`: **`Agentic`** — the op only makes sense with an LLM in the loop
  (ask_visitor, summarize, chat itself). Sits beside `Browser / SecretBearing / Multipart`.
  The API facade's profile does *not* carry `Agentic`; the chat facade does.
- `mustExpose`: plane must match, then `servesSide && carriesAll` as today. `Only(...)`
  additionally requires plane match (a cross-plane `Only` is a manifest authoring error).
- `Conform` gains the `leak` check: for each exposure, an exposed op present in the manifest
  whose plane ≠ facade plane → `Violation{Kind: "leak"}`. (Op absent from the manifest
  entirely remains `orphan`.)

## 4. Wave B — manifest grows the outward plane

- Tag nothing by hand: existing entries keep `OwnerRead/OwnerAction` → owner plane. Ratchet
  (`TestFacadeParity_MCPGapsRatchet`, baseline empty) stays green untouched.
- New outward op table (`paritymanifest/manifest_outward.go`), the role-grantable surface:

  | Op | Kind | Classes | Realized today by (chat facade) |
  |---|---|---|---|
  | `outward.corpus.search` | Query | — | `corpus_search` tool |
  | `outward.corpus.read` | Read | — | `corpus_read` |
  | `outward.corpus.list` | Read | — | `corpus_list` |
  | `outward.corpus.links` | Read | — | `corpus_links` |
  | `outward.booking.slots` | Read | — | booker plugin slots tool |
  | `outward.booking.book` | Action | — | `calendar_book` (booker plugin, CapHooks-gated) |
  | `outward.ask` | Action | `Agentic` | ask_visitor |
  | `outward.summarize` | Action | `Agentic` | summarize |
  | `outward.mail.send` | Action | `Agentic` | mail-sender (LLM-composed) |
  | (+ every externalized visitor cap — enumerate from `Registry.VisitorCapabilityIDs()` at authoring time and keep the ratchet honest) | | | |

  Exact tool names must be read from the live registry when implementing (`AssembleVisitor`
  output / `VisitorCapabilityIDs`, `capreg/registry.go:132,192`) — do not trust this table's
  right column blindly; it is indicative.

- Facade declarations: `chat` (outward; carries `Agentic`), `api` (outward; does **not**
  carry `Agentic`), `web` (outward; the public router — its exposure comes from `chi.Walk`
  like admin's does today, mapped to outward ops; session plumbing routes like
  `/sessions/{id}/ghosts/*` are chat-facade primitives, not separate ops).
- **`KnownAPIGaps()` baseline**: the API facade starts with an empty live set, so every
  non-Agentic outward op lands in a shrink-only baseline — the exact ratchet pattern that
  carried the MCP paydown (`paritymanifest/gaps.go`). Building Wave D pays it to zero.
- Red tests: (a) leak injection (owner op in an outward exposure → `leak`); (b) a
  non-Agentic outward op missing from `api` beyond the baseline → red; (c) an Agentic op is
  *not* demanded on `api` but *is* on `chat`.

## 5. The API-key facade

### 5.1 Grant infrastructure (Wave C)

Schema (in `db/schema.sql` + sqlc queries under `db/queries/`), deliberately **parallel to
codes, not a refactor of them** (codes are settled infra; "AccessCode === invitation"):

```
api_keys:
  id uuid PK, owner_id (FK owners), assumed_role_id (FK roles, NOT NULL — same as codes),
  label text, prefix text ("smk_" + first 8 chars, for display), secret_hash bytea (SHA-256),
  rate_limit_rpm int NULL (NULL → instance default), max_bookings int NULL,
  status text (active|revoked), expires_at timestamptz NULL,
  last_used_at timestamptz NULL, created_at

api_key_capability_denials / api_key_skill_denials:
  mirror code_capability_denials / code_skill_denials shapes (key_id, target_id)

api_open_capabilities:                 -- the candidacy ("open") gate, runtime owner data
  owner_id, capability_id, opened_at
```

- Key format: `smk_<random>`; secret shown **once** at mint; only the hash stored;
  constant-time compare on auth.
- Auth: `Authorization: Bearer smk_…` middleware → key row → **the same role-snapshot path
  codes use**: `buildRoleSnapshotByID` with a key-denials overlay (mirror of `codeOverlay`,
  `visitor_role_snapshot.go:22-103`). No per-key prompt (no persona — there is no LLM).
- Rate limit: Redis fixed window per key id. **Canonical default 120 req/min** (matches
  `PublicRateGuard`'s convention), instance-configurable, per-key `rate_limit_rpm`
  override. 429 + reset header when tripped. **Fail-open** on Redis outage (keys are
  authenticated; availability wins — unlike `login_guard`, which correctly fails closed).
- No gas: turn/session quotas do not exist here — that is the defining property, not an
  omission. `max_bookings` **does** carry over (deterministic quota, same as code; feeds
  `AssembleInput.MaxBookings` so the booker CapHooks gate works unchanged).

### 5.2 The facade router (Wave D) — reuse `AssembleVisitor`, do not invent a binding kind

**Key decision**: the API facade is an **HTTP projection of the assembled outward binding
set for the key's grant** — the same `Registry.AssembleVisitor` + per-tool dispatch that the
chat facade's tool endpoint uses (`routes/public/tools.go`: assemble → find binding → gate →
`InvokableRun`). This buys, structurally and for free:

- identical ACL/denial/quota/CapHooks behavior as code sessions ("same as code" enforced by
  construction, not by test discipline);
- the leak wall (owner-only caps `ErrHidden` out of assembly);
- externalized plugins (retrieval, booker) work unchanged through their sockets.

Synthetic `AssembleInput` for a key: `RoleSnapshot` from §5.1, `OwnerID`, `Mode: "api"`,
`CodeID: ""` (or key id in a new field if a consumer needs it), `ConversationID: ""`,
`MaxBookings` from the key. Audit which bindings assume a live conversation (booker writes
`ConversationID` into bookings — column must tolerate empty/NULL for API-origin bookings;
verify at impl time).

Routes (mounted beside the public router, own auth middleware):

```
GET   /api/pub/v1/tools                  # discovery: opened ∧ granted tools + input schemas
QUERY /api/pub/v1/tools/{name}           # read-only tools (RFC 10008, reuse methodQuery)
POST  /api/pub/v1/tools/{name}           # actions; QUERY on a mutating tool → 405 (same rule as tools.go)
```

Uniform tool-call style is v1; REST-pretty aliases (e.g. `GET /corpus/{slug}`) are a later,
additive layer. Request gate order: auth → rate limit → assemble → **candidacy filter**
(`api_open_capabilities`) → find tool → verb check → run. Not-opened or not-granted are the
same 404 `capability_not_enabled` envelope (`writeToolErr` reuse) — do not leak which gate
failed. Errors: user-friendly envelopes, never raw executor internals (existing `toolErr`
discipline).

Candidacy ("open") is **runtime owner data** — cleanly distinct from the dev-time
`KnownAPIGaps` ratchet (which tracks *implementation* completeness of the facade renderer).
"The facade opens up APIs but exposes none until the owner opens them and mints a key whose
role grants them."

### 5.3 Management surfaces (Wave E) — both owner facades, same commit

The owner-plane ratchet forces twins by construction (a new admin route without an MCP twin
is red — this is the machinery finished at commits `1c712fc`/`cc298e8`/`42bf72f`):

- Admin HTTP: `/api/admin/api-keys` CRUD (mint returns the secret once) + revoke + rate
  override + per-key denials (reuse the `/codes/{id}/denials/{kind}` route shape) +
  `/api/admin/api-open/{capability_id}` open/close toggles. Admin UI: an "api" section
  (keys list + mint + revoke; candidates toggle list) following the codes section's
  patterns.
- Owner-MCP twins in `ownercore`: `api_keys.create/list/revoke/update`,
  `api_keys.{list,add,remove}_denial`, `api.open/close/list_candidates` — with their
  `paritymanifest` entries added **in the same commit** so the owner baseline never grows.
- New cap files follow the ownercore pattern + the hard lint rules learned in the paydown
  (no postgres import — adapters in `cmd/server/owner_mcp_adapters.go`; wrapcheck; cyclo ≤5
  via `parseXArgs`; ≤5 exported types/file; fields largest-first; ≤350 lines; ≤100 cols).
  Update the 115-tool golden (`norm-outward-toolset.spec.ts`) in the same commit.
- **Boot-order trap (already bitten once)**: owner caps capture deps at
  `buildPluginRegistry` time; anything they need must be wired before it — see
  `ensureConnectorSlots` (commit `7063526`) and memory `owner-mcp-deps-capture-ordering`.

### 5.4 Tests (Wave F) — RED-first e2e, feature-floor checklist (ACL/quota/mode/state)

- Auth: missing/garbage/revoked/expired key → 401; valid → 200. Constant envelope.
- **Role-scoping parity with code**: the *same role* reaches the *same tool set* via a code
  session and via a key, modulo `Agentic` (assert set equality after subtracting the
  Agentic ops). This is the "same as code" contract as a test.
- Candidacy: role grants but capability not opened → 404; opened → reachable; closed again
  → 404.
- Denials: per-key denial subtracts exactly that tool; removal restores.
- Rate limit: burst past the default → 429 with reset; second key unaffected; per-key
  override honored.
- Booking quota: `max_bookings` exhausts and blocks (mirrors code behavior).
- **No-leak probes**: a valid key against `/api/admin/*` → 401/403; against `/mcp` → rejected;
  no owner tool name ever present in `/api/pub/v1/tools` discovery for any grant.
- Golden: discovery-endpoint tool list for a full-grant role (the API twin of the 115-tool
  golden).
- QUERY-on-mutating → 405.
- Conformance red-tests from Wave B live in Go tests beside the ratchet.

## 6. Decisions taken (defaults — object before implementing, else these ship)

1. Booking action **included** in v1 (deterministic, grantable, quota'd — "same as code"
   implies the full non-Agentic role surface).
2. Path `/api/pub/v1/…`; header `Authorization: Bearer smk_…`.
3. Rate limiter fails **open** on Redis outage; canonical default **120 rpm**, instance
   setting + per-key override.
4. Uniform tool-call endpoint style in v1; REST aliases later, additive.
5. Parallel `api_keys` tables mirroring codes; **no** unified "grants" refactor now (note
   for the future: codes and keys are both role-assuming grants and could unify).

## 7. Out of scope

REST-pretty aliases; per-IP/per-role rate knobs; federation ("to peers"); SDK changes (the
SDK is a *client* of this facade, not a facade); IM bridge (a transport of existing
facades); infra/health endpoints (not capability projections — deliberately outside the
manifest).

## 8. Wave order (each wave: impl + tests green + lint clean + commit; no partial stops)

A (mechanism) → B (manifest + baselines + red tests) → C (grant infra) → D (facade router,
pay `KnownAPIGaps` to zero) → E (management surfaces, both owner facades + golden) → F
(e2e suite; full `make test` at the end).
