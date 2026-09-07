# Monitor — first-party visitor analytics

> Status: in build. Order of work: this doc → `monitor-tests.md` → tests → implementation.

The owner must be able to answer: **who came, where from, what did they read, and did the
access code I mailed out actually get used.** Today the instance answers none of these.

The `monitor` domain records visitor traffic in the instance's own Postgres, and renders it in
the admin panel under **settings → monitor**. It ships no extra container and no extra database.

## 0. Isolation — monitor watches, and is not felt

**No other domain calls monitor, imports monitor, or knows monitor exists.** Corpus, chat,
access, connector and owner are not edited to add a measurement, and cannot be edited to remove
one. This is the constraint the rest of the design answers to, and it has two halves.

**Half one: recording is observed, not called.** It happens in one chi middleware, mounted once
on the public router at the composition root (§4). It reads the route pattern, the method, the
URL, the request headers and the response status. Everything else it needs, it asks for through
a port it declares itself (`mw.Resolver`), implemented at the composition root.

**Reads converge like everyone else's.** The two owner-facing reads go through the outbound
convergence point, exactly as `ip_bans` does: the admin route holds no repository, it takes an
Op from the dispatcher's admin Face. Owner MCP therefore gets the same two operations with no
second implementation to keep in step.

One thing is deliberately different. Every other domain declares its own ops and depends on
`facadeparity` to do it; monitor does not. It is the domain that watches the others, so it stays
free of everything it can. The split that makes both true:

| Piece | Where | Why |
|---|---|---|
| Payload shapes and input schemas (`EventsArgs`, `EventsOut`, `EventsInputSchema`) | `internal/monitor/repo` | A payload shape belongs to the domain. `encoding/json` is enough to declare one. |
| Decoding and bounding (`EventsQueryFrom`) | `internal/monitor/repo` | Branching is business; a face is a declaration and a call. |
| The `Op` values that bind them | `internal/routes/dispatcher/monitor_ops.go` | The convergence point already has the vocabulary. Aggregating is its job. |
| The REST shape | `internal/routes/admin/monitor.go` | Query parameters, so a filtered view survives being pasted into a message. |

Why this rather than a call at each of the fifty-odd points: a per-call-site plan is a
hand-written list, and a hand-written list rots the first time a route moves. That is the same
defect this document refuses for corpus slugs in §6, one level up. A route that disappears
leaves a table entry that can never fire, and a guard test can see that. A call deleted from
another domain's handler leaves nothing at all to see.

**Half two: no shared files.** Monitor owns its two tables end to end:

| Shared thing | Monitor's relationship to it |
|---|---|
| `backend/db/schema.sql` | **Not touched.** The tables are created by monitor's migration alone. The migration runner applies every unapplied migration on a fresh volume too, so one file covers both a new install and an upgrade. |
| `backend/sqlc.yaml` | **Not touched.** Monitor writes its SQL by hand. |
| every other domain's `db/models.go` | **Not touched.** This is why: all domains generate from that one `schema.sql`, so adding monitor to `sqlc.yaml` and running `make sqlc-gen` rewrote nine other domains' generated files. A module that watches the others must not be able to disturb them. |
| `backend/db/migrations/` | One new file added. Additive; the runner finds migrations by directory listing. |
| `.go-arch-lint.yml`, `check-internal-dirs.sh`, `backend-domain-modules.md` | **Registered, never loosened.** A new domain has to be declared; no existing rule was widened to let this code through. Every gate that fired during the build moved the code, not the gate. |

Outside `internal/monitor/`, the code edits are: the mount and resolver at the composition root
(§4), the op aggregation at the convergence point, the admin route, and the section entry in
§10. No handler in any domain changed.

## 1. Why we build instead of integrating

We evaluated running Umami (MIT) as a service behind our own UI. We rejected that, and we reject
forking it. We port its design instead.

| Option | Cost | Verdict |
|---|---|---|
| Ship Umami in `docker-compose.prod.yml` | +1 Node service, +1 DB schema, its own boot-time migrations, an extra upgrade path that can fail | Rejected. One-command deploy is the product's differentiator. |
| Fork and modify Umami | 75,971 lines to keep ~10% of them; a second Next.js app and Prisma next to our Go/sqlc backend; permanent rebase burden | Rejected. |
| Owner points at their own Umami (the current `connectors` stub) | No control over the schema; cannot add `code` as a dimension | Rejected. See §9. |
| **Port Umami's design into a new `backend/internal/monitor` domain** | ~2k lines of Go + SQL | **Chosen.** |

Umami is MIT. We may copy its code and its SQL verbatim. We must keep its copyright notice in
our third-party notices file when we do.

### 1.1 What we port, and from where

Read these files in the Umami repository at `umami-software/umami@ca661c7` before implementing.

| What | Source | Why it is worth copying |
|---|---|---|
| Two-level identity | `src/app/api/send/route.ts:154-194` | `viewer` (a person, salted hash) and `visit` (one sitting, 30-minute idle expiry). Bounce rate and dwell time have no definition without the second level. |
| Bot filter | `src/app/api/send/route.ts:142` | One call to `isbot`. This is the one list we cannot maintain ourselves. |
| URL and referrer normalisation | `src/app/api/send/route.ts:196-307` | Strips `www.`; resolves a path-only referrer against the event's own domain, not `localhost`; stores no domain for a self-referral; splits query off path; extracts UTM and click IDs. |
| Client detection | `src/lib/detect.ts` | The provider-header table (`:12-47`) is tried before the MaxMind lookup. `getDevice` (`:49-61`) calls a desktop with a screen of 1920px or less a "laptop". |
| Aggregate SQL shape | `src/queries/sql/getWebsiteStats.ts:44-70` | A two-level `GROUP BY`: first per `(viewer, visit)`, then aggregate. Bounce is a visit with one view and no custom event. Dwell is the sum of per-visit `max(created_at) - min(created_at)`. |
| Index set | `prisma/schema.prisma:152-165` | Fourteen indexes, nearly all `(website_id, created_at, <dimension>)`. |
| One filter vocabulary | `src/lib/types.ts:122-164` | See §5. This is the whole interaction model. |
| One breakdown endpoint | `src/app/api/websites/[websiteId]/metrics/route.ts:48-72` | See §5. |

We do **not** port: the ClickHouse dual path, teams and permissions, session replay, heatmaps,
funnels, goals, revenue, segments, cohorts, or their UI.

## 2. Vocabulary

One word, one meaning. These words are load-bearing. Do not introduce synonyms.

| Word | Meaning |
|---|---|
| **viewer** | One anonymous person. Identified by a salted hash. Never a chat session. |
| **visit** | One sitting by one viewer. Expires after 30 minutes of idle time. |
| **event** | One row in `visit_event`. A view is an event with an empty `event_name`. |
| **view** | An event that records the display of a page or an entry. |
| **surface** | Which part of the product produced the event. See §4. |
| **entity** | A corpus-shaped thing an event is about: a wiki entry, an output entry, a writing, a microsite. Addressed by `(entity_kind, entity_id)`. |
| **code** | An existing StandMeet access code. A dimension on an event, not a new concept. |
| **bot** | A non-human client, as classified at ingest. Recorded, never counted by default. |

`session` in this codebase means the **visitor chat session** (`visitor_sessions`). It keeps that
meaning. A traffic event may carry a `chat_session_id`, which points at that existing row.

## 3. Data model

Two tables. One migration, `backend/db/migrations/2026-09-06-monitor.sql`, and **nothing in
`db/schema.sql`** — see §0.

### 3.1 `visit_viewer`

```
viewer_id      text primary key      -- hash(salt, owner_id, ip, user_agent)
owner_id       uuid not null
first_seen_at  timestamptz not null
```

This table exists for one question: is this viewer new or returning. Nothing else.

### 3.2 `visit_event`

```
event_id        uuid primary key
owner_id        uuid not null
viewer_id       text            -- null for a surface with no browser (see §4.9)
visit_id        text not null
created_at      timestamptz not null

-- what happened
surface         text not null   -- §4
event_name      text not null default ''   -- '' means a view
is_bot          boolean not null default false

-- where (display only; never a grouping key — see §6)
url_path        text not null default ''
url_query       text not null default ''
page_title      text not null default ''
hostname        text not null default ''

-- where from
referrer_domain text not null default ''
referrer_path   text not null default ''
utm_source      text not null default ''
utm_medium      text not null default ''
utm_campaign    text not null default ''
utm_content     text not null default ''
utm_term        text not null default ''
src             text not null default ''   -- §4.3: 'qr' | 'link' | ''

-- who and what (StandMeet's own dimensions)
entity_kind     text not null default ''   -- 'wiki' | 'output' | 'writing' | 'microsite' | 'asset' | ''
entity_id       text not null default ''   -- the IMMUTABLE id. Never a slug. See §6.
entity_title    text not null default ''   -- snapshot at event time. Fallback only. See §6.
code_id         uuid
role_id         uuid
chat_session_id uuid
embed_id        uuid
microsite_slug  text not null default ''

-- client
browser         text not null default ''
os              text not null default ''
device          text not null default ''
screen          text not null default ''
language        text not null default ''
country         text not null default ''
region          text not null default ''
city            text not null default ''

props           jsonb not null default '{}'
```

Design notes, each a real trade-off:

- **Denormalised on purpose.** `browser`, `os`, `device`, `country` sit on the event even though
  they belong to the viewer. This removes a join from nearly every query. Umami does the same.
- **`props` is `jsonb`, not typed columns.** Umami splits custom properties into
  `string_value` / `number_value` / `date_value` (`prisma/schema.prisma:169-189`) so it can average
  and sum them. We have no numeric aggregation in v1, and our numeric telemetry already lives in
  `stats.inference_usage`. `ponytail: jsonb props, no numeric aggregation over custom properties;
  port Umami's typed-column event_data table if an owner ever needs avg/percentile over one.`
- **No IP column.** The IP is an input to the viewer hash and is then discarded. See §8.
- **`is_bot` stores instead of drops.** Umami drops bot traffic. We keep it, excluded from every
  default aggregate. A link-preview bot fetching a coded landing URL tells the owner their link
  was pasted into a chat app. That is signal for the job loop, not noise. See §4.3.

### 3.3 Indexes

Copy Umami's shape. Every dimension the UI can group by gets
`(owner_id, created_at, <dimension>)`:

```
(owner_id, created_at)
(owner_id, created_at, url_path)
(owner_id, created_at, referrer_domain)
(owner_id, created_at, event_name)
(owner_id, created_at, surface)
(owner_id, created_at, entity_kind, entity_id)
(owner_id, created_at, code_id)
(owner_id, created_at, country)
(owner_id, created_at, device)
(owner_id, created_at, browser)
(owner_id, viewer_id, created_at)
(owner_id, visit_id, created_at)
partial index where is_bot = false
```

### 3.4 Retention

Raw events are kept for 400 days. A daily job deletes older rows. 400 days lets the owner compare
against the same month last year.

`ponytail: delete-only retention, no rollup tables; add hourly rollups if a self-hosted instance
ever outgrows a raw-row scan.`

## 4. Instrumentation points (踩点)

Two mechanisms. Both write to the same table. **Neither one is a call inside another domain.**

- **Observe** — `internal/monitor/mw` wraps the public router. After the handler answers, it
  matches the chi route pattern against its own table (`mw/routes.go`) and records a row. The
  route table is the whole server-side instrumentation plan, and it lives inside monitor.
- **Beacon** — the browser posts to `POST /api/t`. It carries what only a browser knows and no
  server can see: scroll depth, dwell, which link inside a page was clicked, screen size.

**What the middleware can derive.** The route pattern gives the surface and the corpus genre.
The URL gives the slug, and the `Resolver` port turns that into an immutable id and a live title
(§6). The `?code=` parameter or the bearer header gives the access code, exchanged for an id and
a label — the token itself never reaches a row. The response status gives the outcome, recorded
as a word an owner reads (`ok` / `denied` / `throttled` / `missing` / `rejected` / `error`)
rather than a number. The user agent gives the browser, OS, device and the bot classification.
Proxy headers give the country.

**What it cannot, and what happens instead.** Anything that never leaves a handler is not
reachable, and monitor does not reach for it. Where the fact is visible in the response, it is
read from the status; where it is only visible to the visitor, the browser reports it. A fact
that is neither is not recorded, and that is the price of the isolation in §0.

**Correlation needs no token.** Both mechanisms compute
`viewer_id = hash(secret, month, owner_id, ip, user_agent)` from the same request, so a beacon
and an observed row from the same page land on the same viewer. `visit_id` comes from the
viewer's newest visit within 30 minutes; if none exists, a new one opens.

Each point below lists: **name · mechanism · dimensions carried.** `observe` means the route
table already covers it; `beacon` means the browser reports it.

### 4.1 Public index (`app/src/app/page.tsx`, surface `index`)

| # | Event | How | Carries |
|---|---|---|---|
| 1 | `view` | beacon | referrer, screen, language |
| 2 | `hero_cta_click` | beacon | which CTA |
| 3 | `chat_input_focus` | beacon | — |
| 4 | `chat_submit_anonymous` | beacon | the question is handed to `/gate`; record that it happened, never the text |
| 5 | `pin_click` | beacon | `entity_kind`, `entity_id` — an insight or project pin |
| 6 | `contact_click` | beacon | which channel |
| 7 | `scroll_depth` | beacon | 25/50/75/100, at most once per threshold per visit |
| 8 | `language_switch` | beacon | from, to |

### 4.2 Gate (`app/src/app/gate/page.tsx`, surface `gate`)

| # | Event | How | Carries |
|---|---|---|---|
| 9 | `view` | beacon | referrer |
| 10 | `code_submit` | emit | outcome only |
| 11 | `code_accepted` | emit | `code_id`, `role_id` |
| 12 | `code_rejected` | emit | reason: `invalid` / `expired` / `exhausted` / `banned`. **Never the submitted text.** |
| 13 | `byoai_panel_open` | beacon | — |
| 14 | `byoai_configured` | emit | provider name only. **Never the key.** |
| 15 | `access_request_submit` | emit | — |
| 16 | `identity_picked` | beacon | which member slot |

### 4.3 Coded landing (`/?code=…`, surface `landing`)

This is the job-loop closing path: a recruiter scans the QR printed on a resume PDF.

| # | Event | How | Carries |
|---|---|---|---|
| 17 | `code_landing` | emit | `code_id`, `src` |
| 18 | `qr_scan` | emit | `code_landing` with `src=qr` |
| 19 | `code_landing_bot` | emit | `is_bot=true`, bot name |

**Required change elsewhere.** The QR URL minted into the resume PDF must carry `?src=qr`, and a
link the owner pastes into an email must carry `?src=link`. Without this, a scan of the printed
page and a click in a mail client are indistinguishable. This changes `docs/design/job-loop.md`
step 3 and the QR renderer. It is a prerequisite for point 18, not an optional extra.

**Why point 19 matters.** When a recruiter pastes the URL into Slack, Teams, WhatsApp or
LinkedIn, that service fetches the URL to build a preview card. `isbot` classifies it. Umami would
discard it. We record it, because "your link was pasted into a group chat" is the strongest early
signal the job loop produces.

### 4.4 Visitor chat (surface `chat`)

| # | Event | How | Carries |
|---|---|---|---|
| 20 | `chat_session_start` | emit | `code_id`, `role_id`, `chat_session_id` |
| 21 | `chat_turn_sent` | emit | `chat_session_id`, turn index |
| 22 | `chat_turn_answered` | emit | outcome `ok`/`error`/`timeout`, duration bucket |
| 23 | `chat_turn_abandoned` | emit | the visitor disconnected mid-stream |
| 24 | `tool_call` | emit | tool name, outcome `ok`/`denied`/`error` |
| 25 | `tool_card_open` | beacon | tool name — an MCP App card iframe was shown |
| 26 | `ghost_shown` | emit | steer id |
| 27 | `ghost_accepted` | emit | steer id |
| 28 | `suggested_question_click` | beacon | index |
| 29 | `source_click` | beacon | `entity_kind`, `entity_id` — the visitor opened a citation |
| 30 | `quota_hit` | emit | which quota: sessions / turns / tools |
| 31 | `report_open` | emit | report id |
| 32 | `report_pdf_download` | emit | report id |
| 33 | `booking_slots_viewed` | emit | — |
| 34 | `booking_created` | emit | — |
| 35 | `booking_cancelled` | emit | — |

### 4.5 Public corpus reader (`/wiki/*`, `/output/*`, surface `reader`)

Every event here carries `entity_kind` and `entity_id`. See §6.

| # | Event | How | Carries |
|---|---|---|---|
| 36 | `view` | emit + beacon | `entity_kind`, `entity_id`, `entity_title`, `url_path` |
| 37 | `read_complete` | beacon | the visitor reached the end of the body |
| 38 | `read_dwell` | beacon | dwell bucket, sent on page hide |
| 39 | `related_click` | beacon | from entity id, to entity id |
| 40 | `cited_by_click` | beacon | from entity id, to entity id |
| 41 | `asset_download` | emit | `asset_id` |
| 42 | `lang_switch` | beacon | from, to |
| 43 | `tree_expand` | beacon | the expanded node's entity id |
| 44 | `search` | emit | result count. **Query text goes in `props`; see §8 for the redaction rule.** |
| 45 | `search_result_click` | beacon | `entity_id`, rank |

Points 44 and 45 together answer "is corpus search working". A high `search` count with a low
`search_result_click` count means it is not.

### 4.6 Writings (surface `writings`)

| # | Event | How | Carries |
|---|---|---|---|
| 46 | `view` | emit | `entity_kind=writing`, `entity_id` |
| 47 | `read_complete` | beacon | — |

### 4.7 Microsites (surface `microsite`)

| # | Event | How | Carries |
|---|---|---|---|
| 48 | `view` | emit | `microsite_slug`, path |
| 49 | `widget_render` | beacon | which SDK widget |
| 50 | `store_write` | emit | the visitor wrote to the microsite store |

### 4.8 Embeds and SDK on third-party sites (surface `embed`)

These are cross-origin. `POST /api/t` must accept them. See §7.

| # | Event | How | Carries |
|---|---|---|---|
| 51 | `embed_view` | beacon | `embed_id`, the real parent origin |
| 52 | `embed_chat_start` | emit | `embed_id`, `code_id` |
| 53 | `embed_blocked_origin` | emit | `embed_id`, the rejected origin |

Point 51 tells the owner where their widget actually runs. Point 53 is a security signal: someone
copied the snippet to an origin that is not on the allowlist.

### 4.9 IM bridge (surface `im`)

| # | Event | How | Carries |
|---|---|---|---|
| 54 | `im_turn` | emit | channel kind, `code_id` |

An IM visitor has no IP and no user agent. `viewer_id` is therefore **null**. Every aggregate must
tolerate a null viewer: it counts as one visit and zero identified viewers. This is the one place
where the identity model does not apply, and it must not throw.

### 4.10 Crawlers (surface `seo`)

| # | Event | How | Carries |
|---|---|---|---|
| 55 | `robots_fetch` | emit | `is_bot=true`, bot name |
| 56 | `sitemap_fetch` | emit | `is_bot=true`, bot name |

The product's thesis is that an AI answers in the owner's voice. Knowing that `ClaudeBot`,
`GPTBot` or `Googlebot` crawled the corpus is therefore part of the product, not infrastructure
trivia.

### 4.11 Owner exclusion

**A request that carries a valid owner admin session records nothing.** The owner reading their own
page must not inflate their own numbers. The check runs before the bot check and before every
write.

The exclusion is overridable by one environment variable, for tests only. The variable name must
say so.

## 5. Read model — one filter vocabulary, one breakdown endpoint

This is Umami's interaction design, and it is the reason its UI feels coherent. It is an API-shape
decision, not a UI decision, so we take it whole while keeping our own visual language.

### 5.1 `TrafficFilters`

Every read takes the same struct.

```
start, end, unit, timezone, compare      -- date
path, title, query, host                 -- page
referrer, utm_*, src, channel            -- source
os, browser, device, country, region, city, language
surface, event, entity_kind, entity_id   -- StandMeet dimensions
code_id, role_id, microsite_slug, embed_id
include_bots  (default false)
exclude_bounce
match         'all' | 'any'
search
order_by, descending, limit, offset
```

Because every query takes the same object, clicking any row on any panel means adding one field to
it. Every other panel then re-queries. Drill-down is a property of the vocabulary; it needs no
per-screen wiring. `match` turns AND into OR. `compare` makes period-over-period a filter field
rather than a separate feature.

### 5.2 Endpoints

Mounted under `/api/admin/monitor`. Owner auth. All read-only. Each is a dispatcher op, so each
is also an owner MCP tool with no extra work.

**Built and verified:**

```
GET /events   the raw feed, newest first (?surface, ?event, ?entity_id, ?include_bots, ?limit)
GET /stats    viewers / visits / views / events / bots
```

**Planned, not built:**

```
GET /series           a time series, unit=hour|day|week|month
GET /metrics?type=…   ONE endpoint for every breakdown
GET /active           viewers seen in the last 5 minutes
GET /viewers/{id}     one viewer's journey
```

`/events` comes first on purpose: a summary number cannot tell you which row produced it, so a
test that only reads a summary cannot tell a correct row from a wrong one that happens to count
the same.

`type` accepts: `path`, `entity`, `referrer`, `channel`, `country`, `region`, `city`, `device`,
`browser`, `os`, `language`, `surface`, `event`, `code`, `role`, `microsite`, `embed`, `utm_source`,
`utm_medium`, `utm_campaign`, `src`, `bot`.

One endpoint means one leaderboard component in the UI. Search, paging and click-to-filter are
written once and every panel gets them.

**Do not add any of these calls to `/api/admin/system` or to the dashboard's aggregate endpoint.**
A slow read on a shared aggregate turns every unrelated consumer's test red with a timeout.

## 6. Corpus drift — instrumentation must survive rename, reparent and delete

The corpus changes. Entries are renamed, reparented, promoted between genres, and deleted. The
instrumentation must not be a hand-written list of paths that rots the first time an entry moves.

`backend/internal/routes/public/landing.go:27` keys the reader on the URL slug, and
`e2e/test/corpus-reparent-path.spec.ts` proves slugs move. Four rules follow.

**Rule 1 — group by id, never by path.** Every event about an entity carries
`(entity_kind, entity_id)`, where `entity_id` is the immutable database id. `url_path` is recorded
for display only. No aggregate may group by `url_path` for entity-shaped surfaces.

*Failure this prevents:* an owner reparents `wiki/ml/attention` to `wiki/papers/attention`. Grouped
by path, the entry's history splits into two rows that cannot be summed, and the entry appears to
have lost all its readers.

**Rule 2 — the live title wins; the snapshot is a fallback.** The admin UI resolves
`entity_id` to the current title with a `LEFT JOIN` at read time. `entity_title` on the event row
is a snapshot, used only when the join finds nothing because the entity was deleted. A deleted
entity renders as its snapshot title marked `(deleted)`.

This mirrors how the job loop already snapshots `job_snapshot` onto a committed application. A
snapshot for a row whose subject may vanish is legitimate; a second live source of truth is not.

**Rule 3 — a new genre adds a value, not a code path.** `entity_kind` is a value. Adding a corpus
genre must not require a new event name, a new endpoint, or a new panel. If it does, the
instrumentation was written per-page instead of per-entity, and that is a defect.

**Rule 4 — promotion keeps the lineage.** `corpus.promote` moves an entry from `raw` to `wiki` to
`output`. The promoted entry keeps its identity in the pipeline. Its traffic history follows it, so
a promoted entry's reader count is continuous across the promotion.

## 7. Ingest endpoint

```
POST /api/t
```

- Public. No authentication. CORS is open, because embeds run on third-party origins.
- **Rejects a request with no `User-Agent`.** Umami does the same; it removes the cheapest
  bulk-forgery path.
- Rate-limited per `viewer_id`.
- Fire-and-forget. It must never block the page and must never surface an error to a visitor. A
  failure is logged, not returned.
- The response returns a short-lived signed token carrying `viewer_id`, `visit_id` and `iat`. The
  client returns it on the next post, so repeat events skip the viewer lookup. This is Umami's
  `x-umami-cache` design (`route.ts:112-120`, `:374`).

## 8. Privacy

- **No IP address is ever stored.** It is hashed and discarded in the same function.
- The salt rotates monthly, so a `viewer_id` cannot be linked across months. The cost is that a
  returning visitor looks new after a month boundary. Accepted.
- **No cookies.** Nothing is written to visitor browser storage except the in-memory cache token
  described in §7.
- Cookieless collection with no personal data means no consent banner is required. We do not build
  one.
- **Redaction rule.** The following must never reach a row: an access code's text, an API key, a
  visitor's chat message body, an email address. Point 44 records a search query; the query is
  truncated and stored only because it is the owner's own corpus search, and the admin panel is
  owner-only. Any new event that wants free text must state here why it is safe.
- The owner may switch traffic collection off entirely. One setting, honoured at ingest.

## 9. What happens to the analytics connectors

`app/src/lib/admin/connector-registry.ts:204-230` currently lists `plausible`, `umami` and
`webhook` under an `analytics` category. The `umami` entry says "point at your umami instance".

That entry is the design decision this document replaces. Once the instance collects its own
traffic:

- Remove the `umami` and `plausible` entries. A second, weaker copy of this data is not worth a
  connector.
- Keep `webhook`, re-scoped: it becomes an **export** destination for traffic events, not a
  competing collector.
- Rename the category from `analytics` to `export`.

## 10. Admin UI — settings → monitor

Add `{ slug: 'monitor' }` to the `settings` group in `app/src/lib/admin/nav.ts`. The group
currently holds `ip-bans`, `account`, `system`. The display name lives in the message catalog as
`adminNav.section.monitor`, never in `nav.ts`.

Page at `app/src/app/admin/monitor/page.tsx`, section component under
`app/src/components/admin/sections/`.

Panels, top to bottom:

1. **Live** — viewers active in the last 5 minutes, and the last 20 events as a ticker.
2. **Summary** — viewers, visits, views, bounce rate, average visit length. Each with its
   change against the compare period. A sparkline per number.
3. **Series** — one chart, unit switchable.
4. **Breakdowns** — a grid of leaderboards, all fed by `GET /metrics?type=…`: pages, entries,
   referrers, channels, countries, devices, browsers, languages, codes, roles, events, microsites,
   embeds, UTM.
5. **Journeys** — a viewer list; opening one shows that viewer's ordered events.
6. **Bots** — separate, never mixed into the numbers above.

Rules for the UI:

- The filter state lives in the URL query string. A filtered view must be shareable by copying the
  address bar.
- Clicking any leaderboard row adds that dimension to the filter and re-queries every panel.
- The design language is the project's own: Newsreader for body, JetBrains Mono for metadata and
  numbers, cream paper, ink, vermillion accent. No borrowed Umami styling.
- Every number must be reachable without a chart. A chart is a second view of a number that is
  already written out.
- Empty state is normal on a fresh instance. It must read as "nothing yet", never as an error.

## 11. Out of scope for v1

Funnels, retention cohorts, revenue, heatmaps, session replay, saved segments, goals, teams and
sharing, hourly rollup tables, numeric aggregation over custom properties.

## 11a. Build status — what actually runs

Verified against the real dev stack, not compiled and assumed.

**Working, with tests that have been red:**

- The migration, applied by the running backend (`schema_migrations` carries it; both tables
  exist, and the e2e reset truncates them).
- The recording middleware on `/api/v1`: viewer and visit derivation, bot classification with
  the crawler's name, URL and referrer normalisation, client detection, owner exclusion, and
  entity resolution from slug to immutable id.
- **The beacon** (`POST /api/v1/t`) and the `TrackVisit` component behind it: the index has a
  signal, and scroll depth is reported. Everything a stranger may write through it is
  enumerated, not validated — an unknown event name, a known name on the wrong surface, an
  oversized body and a missing user agent are each dropped, and the caller may name a slug but
  never an entity id.
- `GET /api/admin/monitor/events` and `/stats` through the convergence point — and therefore
  the same two operations on owner MCP.
- **The panel at settings → traffic** (§10): five numbers and the event feed, in eight locales.
- The retention job on the shared periodic schedule (§3.4).
- The connector registry change (§9): `analytics` is now `export`, and the Umami and Plausible
  entries are gone.
- 20 e2e tests across five specs. 60/60 at REPEAT=3, run one spec at a time — the repo's own
  convention, and necessary here: every spec resets the shared instance in `beforeAll`, so
  running five of them interleaved has them wipe each other's fixtures.
- `make lint` — the whole repo chain — clean.

**How the two test layers divide, deliberately:**

`monitor-records-a-reader-view` owns the arithmetic (exact counts, deltas, what is and is not
counted) because it drives no browser and its instance is quiet. `monitor-panel` owns what is
*visible*, and asserts on rows rather than counts: the harness's own sign-in records index
views through the beacon, fire-and-forget, so a count delta measured across a browser
navigation is a statement about the harness as much as about the product.

**Eight defects these found, none of which a compile or a green assertion would have:**

1. The bot's name was detected and then dropped between `DetectClient` and the row — `is_bot`
   said a crawler came, nothing said which.
2. `url_path` recorded the API route (`/api/v1/wiki/x`), a path no visitor ever types.
3. The owner exclusion could never fire: it read the session cookie, which is `Path=/api/admin`
   and never reaches `/api/v1`. The panel showed eight views on an instance nobody had visited.
   It reads the CSRF cookie now, which is `Path=/`.
4. `/homepage` was counted as an index view. It is the Next middleware's liveness probe, fired
   on every request to `/`, so the app was measuring itself.
5. The feed rendered its heading over an empty table while loading — "you have no visitors",
   said before the data arrived. Three states now, not two.
6. The panel used `ensureLoaded`, which fetches once and then serves that snapshot for the rest
   of the session. Every other admin section shows state the owner changed themselves; this one
   shows other people, and it was showing them as of whenever the tab was opened.
7. Scroll depth fired all four thresholds instantly on any page shorter than the viewport —
   "read to the end" is not the same fact as "there was nothing to scroll".
8. A screenshot spec that waited for the feed's container photographed the loading state: it
   went green over a picture of an empty panel.

Defects 3 through 8 were only visible by looking at the rendered panel. Every one of them had
passing tests either side of it.

**Not built. Nothing here is implied by the above:**

- 49 of the 69 tests in `monitor-tests.md`. The reader surface, the beacon and the panel are
  proven; the rest of §4's table is not.
- The route rules for gate, chat, microsite, embed and SEO. Written in `mw/routes.go`,
  unverified — a rule that never fires and a rule that fires correctly look the same from here.
- The breakdown endpoints (`/metrics?type=`), `/series`, `/active`, `/viewers/{id}`, and the
  filter bar that makes §5's one-vocabulary design visible to an owner. The panel today is five
  numbers and a feed; §5's design is what turns that into something you can interrogate.
- The `?src=qr` change to the job loop (§4.3), which is what would let the owner tell a scanned
  resume from a clicked link.

## 12. Build order

1. Migration and the two tables, with an upgrade-path test against a populated volume.
2. Ingest: `POST /api/t`, the viewer and visit derivation, the bot filter, URL and referrer
   normalisation, client detection.
3. Server emit helper, plus owner exclusion.
4. Instrumentation points §4.1 through §4.11.
5. Read model: `TrafficFilters` and the six endpoints.
6. Admin UI.
7. Connector registry change, §9.
8. Retention job.

Points 1 to 3 must be complete before any point in §4 is wired, because every point in §4 depends
on the same emit path.
