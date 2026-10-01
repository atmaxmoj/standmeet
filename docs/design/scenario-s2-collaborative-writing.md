# Scenario S2: writing a novel together on a microsite

Status: PROPOSED 2026-10-01. Waits for the owner's answers under *Decisions for the owner*.

## What the owner asked

2026-09-30, summarised:

- The vault note "欲望也是个劳动" (`wiki/philosophy/desire-is-labor.md`, title "Desire is labor /
  欲望即劳动", `publish: true`) could grow into a novel.
- The owner opens a microsite and invites friends to write it together. What people write is kept
  in the microsite's store. The store's content updates live on every open page, through the SDK.
- Everyone collaborates through the owner's agent inside that one microsite.
- The owner's doubts: nobody verified that the agent can read a microsite's store, and the store
  may need an index before the agent can use it. Collaboration and concurrency are hard.

## What already exists (read from the code, 2026-10-01)

The store:

- Each microsite has its own Postgres schema with one generic table
  `records(id, collection, doc jsonb, created_at)` and a `claims` table
  (`backend/internal/plugin/blockstore/store.go:74-87`). A record has no author, no version and no
  `updated_at`. Nothing updates a record in place: the store interface has Insert, Query, CountAll,
  RecordsPage and DeleteByID only (`backend/internal/owner/usecase/microsite_store.go:65-80`).
- `claims` is a single-winner primary-key claim with an expiry, built for "peek then act" races
  (`store.go:58-64`, `blockstore/claim.go:46`).
- Bounds: 500 documents per page, 8 KB per document (`microsite_store.go:31-33`). 8 KB holds
  about 2,700 CJK characters.
- Writes are off until the owner opens them ("model C", `microsite_store.go:142-144`; MCP tool
  `microsite.set_store_writable`). Reads are never gated (`microsite_store.go:170-172`).
- The public route is `GET/POST /api/v1/pages/{slug}/store`
  (`backend/internal/routes/public/microsite_store.go:38-42`). The GET passes no filter
  (`:68-70`) and returns the documents without their ids (`:96-98`). The closures that back it
  read no visitor session (`backend/cmd/server/boot_wireup_microsites.go:196-218`).
  - So a page that is closed to visitors without a code still serves its store to anyone who
    knows the slug. The page itself checks the code grant (`routes/public/microsites.go:204-210`,
    `boot_wireup_microsites.go:69-98`); its store does not.
  - So a write carries no author. The visitor session knows `code_id`, `member_id` and the
    visitor's chosen name (`backend/internal/access/usecase/visitor_session.go:64-65,77`;
    members are `CodeMember`, `access/entity/access_code.go:108-115`), but the store never asks.
- Owner management is three ops in the one owner registry: `microsite.store_docs`,
  `.store_delete_doc`, `.store_clear` (`backend/internal/owner/ops/microsites_store.go:18-47`).

Events:

- An insert records `microsite.store.doc_inserted` (data: collection, doc_id; subject
  `microsite/<slug>`) in the insert's own transaction (`microsite_store.go:115-123`, declared in
  `backend/internal/owner/usecase/events.go:26,51-53`).
- A delete and a clear record nothing (`microsite_store.go:211-233`).
  `docs/design/notify-rules-and-live-transcript.md:74-75` already proposes `doc_updated` and
  `doc_deleted`.

The SDK:

- `useMicrositeStore(collection)` fetches once on mount and again only after its own save
  (`sdk/packages/react/src/use-microsite-store.ts:31-47`). No `EventSource` and no polling exist
  in `sdk/packages/*/src`. Another visitor's text appears only after a reload.
- The bus design lists client polling → SSE as Phase 5, not scheduled
  (`docs/design/event-bus-outbox-webhooks.md:899-907`). The one push primitive in the backend is
  `pgstore.Listener`: one shared `LISTEN` per channel, waiters keyed by string, a cap on waiters
  (`backend/internal/infra/pgstore/listen.go:24-51`). The preview long-poll uses it
  (`boot_wireup_microsites.go:182-191`).

The agent:

- Visitor tools come from block manifests. `corpus.retrieval` declares eight `corpus_*` tools
  (`backend/blocks/corpus.retrieval/manifest.yaml:25-51`). The corpus domain declares the host ops
  behind them (`backend/internal/corpus/usecase/corpus_index_socket.go:67-90`). No block and no
  host op reads a microsite store (grep of `backend/blocks/*/manifest.yaml`).
- The outward registry has corpus, booking, ask, summarize and mail ops only
  (`backend/internal/infra/paritymanifest/manifest_outward.go:50-62`).
- A turn on a microsite carries the page's prerendered text (`PageText`,
  `backend/internal/conversation/inference/agent_turn.go:105-108`). That text comes from the
  build. Store documents load in the browser after mount (`use-microsite-store.ts:35-37`), so they
  are not in it.
- The corpus index is the pattern to copy: the `corpus.index` subscriber takes
  `corpus.note.changed`, re-reads the note and writes Meili; `Coalesce` keeps one job per subject
  per batch (`backend/internal/corpus/subscriber/index.go:52-66`).

Answer to the owner's doubt: **the agent cannot read a microsite's store today.** No tool reaches
it, no index holds it, and the page text it does get never contains it.

## The gap

1. **Agent read.** No retrieval tool over store documents, no index.
2. **Live.** No push from a store change to the open pages.
3. **Concurrent edits.** There is no edit at all. Two friends cannot revise one passage.
4. **Authorship.** A document does not say who wrote it.
5. **Read gate.** A code-only page leaks its store to anyone with the slug.
6. **Moderation coverage.** The owner can delete, but a delete reaches no open page and no index.
7. **Agent write.** Undefined.

## Mechanism

### Data model: append-only passages, edit = supersede with a single-winner claim

The page defines two collections. The store stays opaque; only keys that start with `_` are the
host's, and the host writes them.

```
chapters  { title, order }
passages  { chapter_id, text }                          // written by the page
          + host keys: _id, _created_at,
                       _author { kind: member|agent|owner, member_id, name, code_label },
                       _supersedes <passage id>?,       // this passage is an edit of that one
                       _conflict { base, head }?        // an edit that lost the race
```

- **Write a passage** = insert. Nothing to conflict with.
- **Edit a passage** = insert a new passage with `_supersedes: <base id>`. In the same
  transaction the host claims key `supersede:<base id>` in `claims` with no expiry. One base has
  one winner, by primary key.
- **Losing edit.** The claim fails. The host still inserts the text, marked
  `_conflict { base, head: <winner id> }`, and answers 409 `edit_conflict` with both ids. The
  loser's text is stored, visible on every page and to the owner and the agent. Nothing is lost.
- **Resolve** = an edit whose base is the current head. It carries `_resolves: [conflict ids]`.
- **Reading a chapter** = its passages in `_created_at` order of each chain's first passage,
  each chain shown by its head (the passage no one supersedes). The host computes `_superseded`
  on read, so the SDK and the agent use one rule.
- A client-sent `_` key is refused (`ErrMicrositeStoreInvalid`). The author comes from the
  visitor session, never from the body.

Why not one document per chapter with a version number: one chapter outgrows 8 KB, and every
save of a chapter then conflicts with every other save of it. Passages make the conflict surface
one paragraph.

Why not a CRDT (Yjs): Yjs needs a websocket provider, a binary update log per document, and a
server-side merge to get plain text for the index and the agent. That is a second store beside
the one we have. **What we give up:** two people typing in the same paragraph at the same moment
get a visible conflict, not a merge; no live cursors; text appears on save, not per keystroke.
Writing a novel is turn-taking, so this cost is small. A CRDT can replace the passage body later
without changing the events, the index or the tools.

### Store verbs (one seam: name + verb + JSON)

`microsite.store` gets verbs `insert` (exists), `supersede` (new), `query` (gains ids, `_` keys,
`_superseded`, an optional `since` cursor), `delete` (exists, owner only). The public route, the
SDK and the host ops all call the same use cases. No path writes a record another way.

### Read gate and authorship

- The store route reads the visitor token the same way page serving does
  (`routes/public/microsites.go:208`) and applies the page's grant: open without a code, or a
  session whose code opens the page (`CodeOpensPage`), or the owner.
- A write stamps `_author` from the session (member id, display name, code label). A page open
  without a code stamps `kind: member, name: "anonymous"`.

### Events (reuse, all thin, `Exposure: Webhook`)

| Type | Recorded by | Data |
|---|---|---|
| `microsite.store.doc_inserted` | insert (exists) | collection, doc_id |
| `microsite.store.doc_updated` | supersede (winner) | collection, doc_id (base), new_doc_id |
| `microsite.store.doc_deleted` | owner delete | collection, doc_id |
| `microsite.store.cleared` | owner clear | — |

A losing edit is an insert, so it records `doc_inserted`. `cleared` is new because a dropped
schema has no document ids; the index and the open pages must drop everything for the page.
Each type is declared once in `owner/usecase/events.go` and added to
`cmd/server/wire/event_types_test.go`.

### Live updates: subscriber → NOTIFY → SSE

- Subscriber `microsite.store.live` takes `microsite.store.*`, `Coalesce: true`, and sends
  `pg_notify('microsite_store', <page id>)`.
- New route `GET /api/v1/pages/{slug}/store/stream` (SSE), same read gate as the GET. It holds a
  `pgstore.Listener` waiter keyed by the page id. On wake it sends one `changed` event; the client
  calls `query` with its `since` cursor. The push carries no content, so the read gate stays in
  one place.
- The waiter cap protects the process; a client over the cap falls back to a 15 s refetch
  (`ponytail:` ceiling: one process's LISTEN fan-out; Redis pub/sub if the instance runs several
  app processes).
- SDK: `useMicrositeStore` opens the stream, exposes `docs` with host keys,
  `save(doc)`, `edit(baseId, doc) → {ok} | {conflict: {base, head}}`. The builder image bakes the
  SDK, so the builder ships with it.

### Agent read: a store index and a `microsite.store` block

- Subscriber `microsite.store.index` takes `microsite.store.*`, `Coalesce: true`, re-reads the
  document and writes a Meili index `microsite_store` (page_id, collection, doc_id, text =
  every string value in the JSON, author name, superseded, conflict). It reads current state, so
  retries and reorderings are safe — the `corpus.index` rule. Without Meili, search falls back to
  `doc::text ILIKE` inside the page's schema (bounded by the 500-document quota).
- The owner domain declares host ops beside `CorpusHostOps`: `store_map` (collections, chapter
  titles, counts, open conflicts), `store_search` (query → passages with author and chapter),
  `store_read` (one chapter as its current text, in order, with authors).
- A new block `backend/blocks/microsite.store/manifest.yaml` (`shape: visitor_only`) names these
  as `visitor_tools` and `host_ops`. The page is never a tool argument. The host takes it from the
  turn's `doc_context` (genre `microsite`) and checks the session's grant for that page; no grant
  → empty results.
- The outward registry gets `outward.microsite_store.search` / `.read` (+ `.append`, below), so
  the api and mcp-visitor faces render them from the same list.
- The seed note stays in the corpus. The agent finds it with `corpus_search` and the novel with
  `store_search`; both appear in one turn.

### Agent write and owner moderation

- The agent gets one write: `store_append` — a new passage, `_author { kind: agent, on behalf of
  <member> }`, only when the store is writable, only in the page of the turn. It cannot supersede
  or delete. A visitor who wants the agent's draft revised edits it like any passage.
- The owner moderates with the existing `microsite.store_delete_doc`. It now records
  `doc_deleted`, so the passage leaves every open page and the index.

## Acceptance: one end-to-end test

`e2e/test/microsite-collab-writing.spec.ts`. Real stack, mock LLM in the gateway, Playwright
drives two browser contexts. Fixtures exist: `publishPage` (`fixtures/microsite-rig`),
`scriptMockToolCall` / `gatewayRequestExists` (`fixtures/mock-llm-script.ts`), `callTool`
(`fixtures/mcp`).

0. Owner claims the instance, publishes page `desire-novel` whose source uses
   `useMicrositeStore('passages')` with `edit`, opens its store, closes it to codeless visitors,
   and issues codes `WRITER-A` and `WRITER-B` bound to it.
1. Context A opens `/p/desire-novel?code=WRITER-A`, picks the name Ana. Context B opens it with
   `WRITER-B` as Ben.
2. Ana writes passage P1 ("The master kept a ledger of everything he never wanted.").
   **Ben's page shows P1 with "Ana" within 5 s, with no reload.**
   Red today: the hook never refetches (`use-microsite-store.ts:31-47`); no author is stored.
3. Ben asks the page's agent "Who wrote about the master's ledger?" The mock scripts
   `store_search {query: "ledger"}`, then a reply. **The gateway's second request contains P1's
   sentence and "Ana".**
   Red today: no `store_search` tool exists; the tool call fails and no request carries P1.
4. Ana and Ben both open "edit" on P1. Ana saves P1a; then Ben saves P1b.
   **Ana's and Ben's pages both show P1a as the passage and P1b as a conflict marked "Ben"; after
   a reload of a fresh code-A context, P1b is still there.**
   Red today: there is no edit verb; a second insert is just another passage.
5. Owner deletes the conflict with `microsite.store_delete_doc`. **P1b disappears from both open
   pages within 5 s.**
   Red today: delete records no event, so no page hears it.
6. A codeless request `GET /api/v1/pages/desire-novel/store?collection=passages` **gets 404 and
   no passage text.**
   Red today: the read is ungated and returns P1.

Each step is red on the code of 2026-10-01. Prove it by running the spec on the current main
before the first implementation commit.

## Decisions for the owner

1. **Quota.** 500 documents per page fits a short story, not a novel with edits (each edit is
   one more document). Options: a per-page quota the owner sets (recommended, default 500), or
   one higher fixed cap for every page.
2. **Pre-moderation.** Default: a passage appears at once and the owner deletes after the fact.
   Option: passages wait in `pending` until the owner approves — safer for strangers, slower for
   friends.
3. **Agent write.** Default: the agent may append passages on a visitor's request, never edit or
   delete. Option: read-only agent (the novel is only human text), or an agent that may also
   resolve conflicts by superseding.

## Not in this change

- Per-keystroke co-editing, cursors, presence (the CRDT path above).
- Webhook and IM rules on store events (`notify-rules-and-live-transcript.md` covers them; this
  design only supplies the event types).
- Assets inside passages (images): the store holds JSON only.
