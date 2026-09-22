# Public corpus search (corpus.retrieval `public_search` config)

**Goal (owner, 2026-09-21):** let an anonymous visitor (no access code, no session) search the
owner's **published** corpus via the `corpus_search` BlockWidget on a public microsite — an owner
opt-in, **rate-limited**.

## Why this is small + safe (the key finding)

- **Published-only scope already exists.** A codeless "public" session freezes the owner's builtin
  `public` role, whose `CorpusScope` has `PublishedOnly:true` (`access/entity/role_snapshot.go:237`,
  `path_acl.go:154`). So `corpus_search` over a public session already returns only published notes —
  **no new ACL/filter needed**.
- **The only gap:** an anonymous `BlockWidget` has *no* session → it refuses client-side
  (`sdk/packages/react/src/widgets/BlockWidget.tsx:39-43`, `adoptStoredSession()===null`).
- **Published search leaks nothing** (published = already anonymous-readable via `/wiki`,
  `/api/v1/corpus-cards`). So `public_search` is an **owner UX opt-in**, not a security boundary.

## Design (client-forward + config-gated + rate-limited)

1. **Manifest:** `backend/blocks/corpus.retrieval/manifest.yaml` — add `config: public_search`
   (bool, default `"false"`). Surfaces automatically in `BlockConfigForm` (generic, no UI code:
   `app/.../suppliers/BlockConfigForm.tsx`, bool→checkbox in `use-block-config.ts`). No allowlist
   gates "configurable" (`BlocksPanel.tsx:151-173`). No `blockconfig.get` host_op needed — the
   plugin does NOT read it; the server does.
2. **Public flag:** expose `public_search` on a public (anonymous) surface the microsite SDK reads
   (fold into the public microsite/instance context the widget already fetches). Read server-side
   from `blockconfig.Store.Values(owner, corpus.retrieval decl)`.
3. **Client (`BlockWidget`):** when `adoptStoredSession()===null` **and** `public_search` on **and**
   tool is a public-safe read (`corpus_search`/`corpus_read`/…): issue a **codeless public session**
   (`client.ts issueSession` → `POST /sessions` mode:`public`, already exists) → run the tool. Off →
   today's "open with a code". Session issuance is already per-IP limited (120/min,
   `middleware/ratelimit.go` `POST /api/v1/sessions`).
4. **Rate limit (the new server guard):** the tool endpoint `POST /api/v1/sessions/{id}/tools/{name}`
   is NOT in the exact-match `publicRatePolicy` table (path param). Add a **targeted per-IP
   fixed-window cap** in the tool-dispatch handler when the caller is a **public-tier** session
   (mode:`public`), reusing `incrWithinLimit` (key `ratelimit:pubsearch:ip:<ip>`, ~60/min). Bounds
   unbounded anonymous search; fail-open on redis error like the rest of the public surface.

## Code map (from trace)

- Block-run endpoint: `sdk/.../client.ts:193-208 callTool` → `POST /api/v1/sessions/{id}/tools/{name}`
  → backend `routes/public/tools.go:55-77 toolDispatch` (wrapped in `chat.go:111 withVisitorSession`,
  the hard session-token gate at `chat.go:233-263`).
- Public session issue: `routes/public/sessions.go:221-240 dispatchIssueSession` → `IssuePublicSession`
  (`conversation/usecase/visitor_public.go:33`) — codeless.
- Corpus_search host op: `corpus/usecase/corpus_index_socket.go:67-120` (`runCorpusSearch`, scope off
  the wire `_meta`).
- Block config read (server): `plugin/blockconfig/blockconfig.go:113 ValuesScoped`.
- Rate limiter: `infra/middleware/ratelimit.go` (`incrWithinLimit`, `PublicRateGuard`).

## Test-first (blackbox e2e; mirror `microsite-block-widget.spec.ts`)

Seed: owner + a **published** wiki note (needle `PUBSEEN`) + a **private/unpublished** note
(needle `PRIVSEEN`, both share a common query term) + a public microsite whose body is
`<BlockWidget tool="corpus_search" args={{query:'<term>'}}/>`.

1. **off (default):** anonymous (no gate) → widget `data-state='no-session'` + "access code" text,
   0 run buttons. (Guard: off stays off.)
2. **on** (`block_config.set` public_search=true): anonymous → widget runs → result **contains
   `PUBSEEN`** (positive) **and does NOT contain `PRIVSEEN`** (take result text, assert non-empty +
   lacks private — not a vacuous absence test, `[[negated-assertion-passes-while-absent]]`).
3. **rate limit:** hammer the public search past the cap from one IP → `429`/refused; a fresh IP
   still allowed.

## Ship

Touches the **SDK** → `make dev-rebuild-builder` (bakes SDK into the builder image,
`[[builder-image-bakes-the-sdk]]`) + backend rebuild; local test green → CircleCI release → deploy →
verify anonymous search on a prod public microsite.
