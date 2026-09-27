# Paging — one paginator for every owner list

Status: approved direction 2026-09-27 (owner: "make the paginator one util; page every list,
the owner-created ones too"). Ledger of which lists are done: see the table at the end.

## Why

Two failure shapes exist today.

1. **A hard cap hides data.** Conversations (50 in the UI, 200 in MCP), access requests
   (`LIMIT 100`), monitor events (50) and monitor sessions (100). Older rows cannot be reached.
   The owner reads the list as complete.
2. **No bound at all.** Codes (the job loop issues one per application), code members,
   microsite store docs, assets, applications, the `writings.list` tool, and the owner-created
   lists (roles, embeds, API keys, IP bans, microsites). Every read returns every row. An MCP
   client pays for all of it in context.

Corpus and the admin writings grid already page with a keyset cursor
(`routes/admin/corpus_page.go`, `lib/admin/use-corpus-page.ts`). That code is copied per genre.
This design lifts it into one util and moves every list onto it.

## The contract

**Order.** Newest first: `ORDER BY created_at DESC, id DESC`. The id breaks ties.

**Cursor.** Opaque string: base64url of `created_at (RFC3339Nano) | id`. An empty cursor means
the first page. A client never builds or parses a cursor.

**Request.** Every paged op takes the same two optional args, plus its own filters:

| arg | meaning |
|---|---|
| `cursor` | from the previous page's `next_cursor`; omit for the first page |
| `limit` | page size; default 50, clamped to 1..200 |

**Response.** Every paged op returns the same envelope:

```json
{ "items": [ ... ], "next_cursor": "...", "total": 123 }
```

`next_cursor` is absent on the last page. The server fetches `limit + 1` rows; the extra row
only decides whether a next page exists. `total` is present when the list reports it: how many
rows match the filter across every page. It comes from an uncorrelated subquery, never from
`COUNT(*) OVER ()`, which would also apply the cursor and count only what is left. A header
count, a badge or a KPI reads `total` (a one-row page, `lib/api/list-total.ts`), never the
length of a loaded page.

**Filters and search run in SQL, before the LIMIT.** A filter applied to one loaded page
reports "none match" while matches sit on page 2 (F-L-23 was this bug on corpus tags). Counts
per filter (codes: active / revoked / expired / all) come from their own count query, never
from the loaded items.

**REST and MCP get the same op.** The REST route passes the query string into the op
(`queryArgs`). The MCP tool of the same op takes the same args. A list op returns the
envelope on both faces. This changes the shape of existing list ops from a bare array to the
envelope. That is deliberate: a bare-array list op is the unbounded shape this design removes.

## Backend util — `internal/infra/paging`

- `Cursor{At time.Time, ID string}`, `Encode()`, `Decode(s)`.
- `Request{After *Cursor, Limit int32}` and `ParseRequest(cursor string, limit int)`:
  decodes and clamps. A bad cursor is a bad-input error, not a first page.
- `Page[T]{Items []T, NextCursor string}` and
  `Cut[T](rows []T, limit int32, key func(*T) Cursor) Page[T]`: trims the `limit+1` fetch and
  sets `NextCursor` from the last kept row.
- SQL shape, per list (sqlc):

  ```sql
  AND (sqlc.narg('after_at')::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
  ORDER BY created_at DESC, id DESC
  LIMIT sqlc.arg('lim');
  ```

  A list ordered by another time column (conversations by `last_at`, members by
  `last_seen_at`) uses that column as `At`. A nullable order column is coalesced in the
  query and in the cursor the same way.

The corpus and writings page handlers move onto this util. Their copies are deleted.

## Frontend util — `lib/ui/use-paged-list.ts` + `components/ui/LoadMore.tsx`

- `createPagedStore({name, path, item, params})` (`lib/state/create-paged-store.ts`) + `usePaged`
  → `{items, total, status, error, hasMore, loadMore, reload, setParams, patch}`.
  - `params` (filters, search) are part of the key: `setParams` reloads from page 1.
  - `reload()` after a create or delete; `patch(id, fn)` for an in-place edit, so an edit on
    page 3 does not throw the owner back to page 1.
  - A row that comes back on a later page (an activity-ordered list moved it) is kept once.
  - Load failure keeps `status: 'error'`, so `ListPane` still says "did not load", not "empty".
  - A module singleton for a section; a component-local store (`useState(() => create…)`) for
    a picker or a per-card list.
- `<LoadMore>`: a sentinel that loads the next page when it scrolls into view, and a button
  with the same action for keyboard users and for when the observer never fires. Hidden when
  `hasMore` is false.
- `use-corpus-page.ts` moves onto it and is deleted (todo). The monitor panel's own
  prev/next pager over one fetched window was deleted in v0.1.82: one paginator.

## Pickers

A list that also feeds a picker (codes in the embed and preview pickers, roles in the code
modal, microsites in the code's page binding) does not keep a second, unbounded "all" fetch.
The picker reads the same paged op with a `q` search arg: the first page shows the newest,
typing narrows on the server. One source, one shape.

## Ledger

| list | op | kind | status |
|---|---|---|---|
| codes | codes.list (+ state, q, embed) + codes.counts | unbounded | done v0.1.82 |
| conversations | conversations.list (+ code, total) | hard cap | done v0.1.82 |
| access requests | access_requests.list (+ status, id, total) | hard cap | done v0.1.82 |
| monitor events | monitor.events | hard cap | done v0.1.82 |
| monitor sessions | monitor.sessions | hard cap | done v0.1.82 |
| code members | codes.list_members (+ total) | unbounded | done v0.1.82 |
| embeds (moved up: its rows now carry the code string) | embeds.list | owner-created | done v0.1.82 |
| microsite store docs | microsite.store_docs | unbounded | todo |
| assets | assets.list | unbounded | todo |
| applications | (admin route; no op yet) | unbounded | todo |
| writings (MCP) | writings.list | unbounded | todo |
| roles | role.list | owner-created | todo |
| API keys | api_keys.list | owner-created | todo |
| IP bans | ip_bans.list | owner-created | todo |
| microsites | microsite.list | owner-created | todo |
| corpus / admin writings grid | (hand-written routes) | already paged | move onto util |

Out of scope: one conversation's transcript, resume drafts and the job pool (TTL), the
activity feed and task views (recent-only by design).
