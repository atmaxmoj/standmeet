# Event bus, transactional outbox, and webhooks

Status: **released in v0.1.76** (2026-09-27; decisions in *Decided*). Full-suite acceptance passed
(`docs/full-suite-failures.md`, round 2026-09-26: final run 1987/3, the three test-side reds closed
`REPEAT=5`); the production smoke (`docs/real-env-verification/items/release-smoke.md`, driven by
hand with a selftest code) passed on sijie.xyz: grounded answers, a real booking, the confirmation
email in the inbox, `booking.created` through the bus, cancel, revoke. It found four defects outside
this work, all in the booking card and the gate: F-C-61 ⭐ the booking claims a calendar invite was
emailed when the CalDAV calendar sends none (`booker-mcp.js:327`), F-C-62 the card labels a CalDAV
link "View on Google Calendar" (`:778`), F-C-63 cancel claims `sent_updates_to` the same way
(`:523`), F-I-2 two gate lines untranslated in Chinese. All four are now e2e tests
(`booking-invite-caldav`, `visitor-name-picker-zh`), proven RED on v0.1.76 and fixed in v0.1.77: the
calendar reports whether it invited, and when it did not the booker mails an iTIP invite / cancel
(`docs/full-suite-failures.md`, round 2026-09-27; full run 1991/1, the one red test-side and closed
`REPEAT=5`). The v0.1.77 smoke on sijie.xyz verified all four: the zh picker is Chinese
throughout, the visitor's inbox got the `METHOD:REQUEST` invite and then the `METHOD:CANCEL` for the
same UID, and the card offers no Google link. **Pending:** the standmeet.com deploy and its 60 s
real-environment check (S5, S6), which need the owner's KV namespace and hook secret. This document is the design and the progress
ledger: a phase is ticked only when its acceptance specs have run green. Where the build refined
the plan, the sections below state what was built and why.

## Why now

StandMeet had no event mechanism. Every "after X, also do Y" was written by hand at a call site.
The inventory below (as of `origin/main` 6eb8c0a64, before this work) shows what that cost.

| Mechanism before | Where | Failure mode |
|---|---|---|
| Meili index hooks | `corpus/usecase/corpus_index.go:218,224`, called from 9 sites | `CreateWiki` and `CreateOutput` never call it. An 8 s reconcile loop and a process-local `dirty` flag cover the gap. A read failure in `IndexNote` never sets `dirty`. |
| Publish-state reindex | `owner/ops/seo.go:126,140` | This was added after the publish switch skipped indexing. It is the same bug class again. |
| Obsidian post-import reindex | `routes/admin/obsidian.go:133` | This is a fire-and-forget goroutine. A restart loses it. |
| Access-request owner email | `access/usecase/access_requests.go:56` | It runs synchronously in the request. On failure it only logs a warning, and the email is lost. |
| Booking notify-owner email | `infra/plugins/booker/booker-mcp.js:448` → `plugin/adapters/invoke_background.go:53` | A detached goroutine runs `retry.Do`. A restart loses it. |
| Microsite build settled | `infra/buildnotify/notifier.go` | The notifier is in-memory and global, not keyed by owner. It is correct only with one process. |
| Periodic jobs (7) | `cmd/server/wire/periodic.go:35` | Every process runs every job. There is no leader election, and the in-memory board is lost on restart. |
| Embed consumers (standmeet.com) | none | A site that shows the corpus cannot learn that the corpus changed. |

The pattern is the same everywhere: the side effect is **coupled to the call site**, **not
durable**, and **not visible**. An event bus with an outbox gives one path that fixes all three.
Webhooks extend the same path to the world outside the process.

## Reference first

| Concern | Reference | What we take |
|---|---|---|
| Durable jobs on Postgres | [River](https://riverqueue.com) (Go, pgx/v5 native, MPL-2.0) | We take the transactional insert (`InsertTx`), `SKIP LOCKED` claims, LISTEN/NOTIFY wake-up, retries with backoff, unique-by-args inserts, leader-elected periodic jobs, and job rows as a queryable log. We do not re-implement a queue. |
| Outbox | Debezium / microservices.io "transactional outbox" | The event row commits in the **same transaction** as the change it describes. A relay publishes after commit, with at-least-once delivery. |
| Webhook wire format | [Standard Webhooks](https://www.standardwebhooks.com) (Svix) | The headers are `webhook-id`, `webhook-timestamp` and `webhook-signature: v1,<base64 HMAC-SHA256(id.ts.body)>`. The retry schedule is exponential. An endpoint is disabled after sustained failure. |
| Event shape | Stripe "thin events" | The payload carries the type, the subject and ids. The consumer fetches the resource through the API. Less data leaves the instance, and there is one source of truth: the fact stays with the producer that owns it. |
| Plugin events | cordis `ctx.on` / `ctx.emit` | This is a later phase. A dsh plugin declares its subscriptions as data, and the host delivers each event as a verb call (string + JSON), like every other seam. |

## Why not Redis/Bull, Kafka or RabbitMQ

The queue lives in the Postgres we already run. No new service is added. River is one existing way
to build a queue on Postgres. A self-built minimal queue on Postgres keeps the stack just as small.

1. **A broker does not remove the outbox.** The domain change and "the event happened" must
   commit together. Kafka, RabbitMQ and Redis cannot join a Postgres transaction. Using them still
   needs an outbox plus a relay that publishes to the broker, which only adds a hop. A queue in the
   same database makes enqueueing part of the transaction itself.
2. **Wrong semantics.** We need a job queue: each delivery retried on its own, on a backoff
   schedule, with an endpoint disabled after sustained failure.
   - Kafka is an ordered log. It has no per-message delayed retry, so it needs hand-built retry and
     dead-letter topics, and one failing message blocks its partition.
   - RabbitMQ can do delayed retry, but only by composing dead-letter exchanges and TTLs, or with a
     plugin.
3. **Our Redis is built to lose data.** `docker-compose.prod.yml` caps it at 256 MB with
   `allkeys-lru`. Sessions and rate-limit buckets survive eviction because they can be rebuilt;
   queued jobs would be dropped silently. The repo has no Bull or BullMQ, and the backend is Go, so
   Bull would also add a Node process.
4. **Volume and cost.** The event volume is hundreds to a few thousand a day: corpus edits,
   access requests, bookings. Postgres handles thousands of such writes per second. Self-hosting on
   a 1 GB box is part of the product.

| Option | New service | Typical memory | Transactional | Per-message delayed retry | Operations |
|---|---|---|---|---|---|
| Kafka | broker (KRaft still runs a JVM) | 1 GB and up | dual write, needs outbox | no; needs retry topics | partitions, retention, disks, upgrades |
| RabbitMQ | Erlang server | 150 MB and up | dual write, needs outbox | composed from DLX + TTL | queues, exchanges, durability config |
| Redis + Bull | none, but eviction and persistence must change | shared | dual write, needs outbox | yes | an extra Node process |
| River | none (a few tables in the existing Postgres) | near zero | same transaction | yes | backed up and migrated with the database; +1 Go module |
| Self-built on Postgres | none | near zero | same transaction | we implement it | a few hundred lines we own; the builder's `SKIP LOCKED` lease is a start |

**When Kafka would make sense:** a large multi-tenant SaaS, with many independent services
consuming and replaying the same stream. The job runtime (`Jobs`, `Inspector`) and the relay inside
`internal/infra/events` would change; the domains would not notice (see *Interfaces*).

**A further option to shrink the stack:** move sessions and rate limits into Postgres (UNLOGGED
tables), and Redis can be removed entirely. This is a separate proposal.

## Model

### Event

```
event  = { id (uuid), seq, type (string), owner_id, subject (string URI or id),
           occurred_at, data (json) }
```

- `id` is `gen_random_uuid()` (v4). `seq` is an identity column used only to order a claim; no
  cursor reads it (see *Message loss*).
- `type` is a dotted string: a noun (which may itself be dotted) then a verb, for example
  `corpus.note.changed`, `access_request.created` or `microsite.build.settled`. The substrate never has a Go type per
  event. It sees a string and JSON, the same rule as seams (a seam is a name, a verb and JSON, never a typed contract).
- Every event type is **declared once** by the domain that owns it. The declaration is data:
  `events.Type{Type, Description, Subject, Exposure}`. The composition root collects the
  declarations in `cmd/server/wire/periodic.go`, one line per source. The admin UI and the MCP
  `webhooks.event_types` op read the collected list. No hand-kept list exists.
- `Exposure` sets who may receive the event. The value is `Internal` (in-process subscribers only)
  or `Webhook` (it may leave the instance). **The zero value is `Internal`.** A new event type
  cannot leave the instance by accident. The registry UT (`cmd/server/wire/event_types_test.go`)
  fails when a type is left at the zero value without being listed as internal on purpose.
- **39 types are declared, all thin, all `Webhook`:** `corpus.note.changed` (trigger),
  `webhook.test`, `access_request.created` / `.approved` / `.status_changed`, `code.issued` /
  `.revoked` / `.redeemed`, `conversation.started` / `.message` / `.pruned`, `ghost.accepted`,
  `writing.published` / `.unpublished`, `vault.imported`, `api_key.issued` / `.revoked`,
  `supplier.connected` / `.disconnected` / `.activated`, `block.installed` / `.failed`,
  `gas.exhausted` / `.refilled`, `instance.upgrade_requested`, `owner.login` / `.email_changed` /
  `.recovery_requested`, `ip_ban.added`, `booking.created` / `.cancelled` / `.rescheduled`,
  `application.committed`, `jobs.fetched`, `microsite.build.settled`, `page.promoted_live` /
  `.rolled_back` / `.unpublished`, `microsite.store.doc_inserted`.
  - `instance.upgrade_requested` commits in its own transaction, and only when the updater exists.
  - `owner.login` commits in its own transaction (a login writes no row; the session lives in
    Redis). A recovery-phrase sign-in also records it, committed with the spent phrase.
  - `jobs.fetched` is recorded once per source that fetched successfully.

### Two ways an event is born

1. **Row-change events, written by the database.** An `AFTER INSERT/DELETE` trigger and an
   `AFTER UPDATE … WHEN (watched columns changed)` trigger on `corpus_notes` write an outbox row in
   the same transaction. `corpus_notes` is the only table that emits (see *Enforcement*,
   `check-table-event-policy.sh`).
   - Watched columns: genre, title, body, tags, parent_id, published, show_as_source, aliases,
     excerpt, slug, archived, css_classes, lang. A change to `updated_at` alone emits nothing.
   - Subject: the note URI, computed in SQL (`corpus_note_uri`, `corpus_path_segment`). The SQL
     copy of the path rule is held to the Go rule by the UT `TestSQLPathSegmentMatchesGo`.
   - Data: `op` (created, updated, deleted), `note_id`, `genre`, `parent_id`, `published`,
     `was_published` and `path_changed` (title or parent changed).
   - Coverage is total by construction. A write path cannot "forget" to emit. This is the
     `CreateWiki` bug class made impossible, not fixed once.
2. **Domain events, emitted by use cases.** These are facts that no single row states, for
   example `access_request.created`, `booking.created` or `application.committed`.
   - The use case calls `recorder.With(tx).Record(ctx, ownerID, type, subject, data)` inside its
     own transaction.
   - Explicit calls are acceptable here because each event has exactly one producing use case. A
     UT per use case asserts that the event is recorded.

Both ways write the same `events` table and send `pg_notify('standmeet_events')`. A consumer
cannot tell them apart and does not need to.

### Relay and delivery

```
events (outbox) ──relay──► river jobs ──► in-process subscribers (Go handlers)
                                    └──► webhook.fanout ──► webhook.deliver (signed HTTP POST)
```

- **Relay.** The relay is a loop in `internal/infra/events` (`run.go`) that runs in every
  process. It is not a River job.
  - It wakes on `NOTIFY standmeet_events` (sent by the trigger and by `Record`), and on a 1-minute
    periodic job `events relay sweep` that only pokes it. The sweep covers a NOTIFY lost while the
    listener reconnects.
  - It claims at most 200 rows with `… WHERE fanned_out_at IS NULL AND poisoned_at IS NULL
    ORDER BY seq FOR UPDATE SKIP LOCKED`. `SKIP LOCKED` already prevents a double fan-out, so no
    leader is needed.
  - For each (event, subscriber) match it inserts a River job, and it sets `fanned_out_at` and
    `fanout` (which job each subscriber got) **in the same transaction**. Fan-out therefore happens
    exactly once, and handling is at least once.
  - A failing pass backs off: 2 s, doubling, capped at 1 minute. A failing batch is then retried
    row by row, so one bad row cannot block the others. A row that fails 5 times is poisoned (set
    aside with `poisoned_at`) and raises an alert. The owner puts it back in line from the
    event's detail in the Tasks panel (`events.requeue`, which calls `Bus.Requeue`).
  - After a fan-out commits, the relay sends `NOTIFY standmeet_events_fanned` with the event ids.
    `AwaitFanout` waits on it (write receipts, see *Response contract*).
  - It does **not** use a sequence cursor. A cursor loses events: see *Message loss*.
- **Coalescing is a per-subscription opt-in** (`Subscription.Coalesce`). Within one claimed batch,
  a coalescing subscriber gets one job per subject, for the latest event. Only `corpus.index`
  coalesces: it re-reads the note's current state, so the latest change covers the earlier ones.
  Webhooks and mail never coalesce: two events about one subject are two facts. (An early build
  coalesced for every subscriber and dropped `supplier.connected` when `supplier.activated`
  followed in the same batch. The UT `TestEverySubjectEventReachesANonCoalescingSubscriber` holds
  the fix.)
- **Subscribers.** A subscriber is a named Go handler declared as data (`events.Subscription`),
  for example `corpus.index` on `corpus.note.changed`. Its name is also its job kind. It must be
  **idempotent**, because it receives the event id and may see the same event twice.
- **Webhooks.** Delivery is two job kinds in the owner domain:
  - `webhook.fanout` subscribes to every `Webhook`-exposed type. It loads the owner's enabled
    endpoints, applies the type globs and the scope, and enqueues one `webhook.deliver
    {endpoint_id, event_id}` per endpoint in one transaction. The insert is unique by args, so a
    fan-out that runs twice queues each delivery once.
  - `webhook.deliver` posts through `httpx.NewClient{BlockInternalEgress: true, NoRetry: true}`,
    with a 10 s HTTP timeout inside the 15 s job timeout. River owns the retries.
  - It uses the Standard Webhooks headers and a per-endpoint secret (`whsec_` + base64 of 32
    bytes), sealed at rest with `cryptobox`. The secret is unsealed only in `cmd/server/unseal.go`.
  - The retry schedule follows Svix: 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, then 10 h steps.
    `MaxAttempts` is 18, which reaches about 5.3 days.
  - Any non-success sets the endpoint's `failing_since` (410 and 429 too); a success clears it.
    The endpoint is disabled after 5 days of continuous failure, with the reason recorded.
- **Scope.** Only `corpus.note.changed` is scoped; every other type goes to every endpoint that
  subscribes to it. `raw://` never leaves the instance.
  - A standalone endpoint gets the **published slice**: a note change goes out only when the note
    is published or was published a moment ago (`published` or `was_published`), so an unpublish
    is heard.
  - An endpoint attached to an embed gets that embed's code scope, decided by the access domain
    (`EmbedAdmits`) with the single ACL predicate `entity.AllowsCorpusEntry`: role globs minus the
    code's denials. `published` counts only where the code's role reads the published slice. A
    revoked or expired code, or a deleted embed, admits nothing.
  - `webhook.test` goes only to the endpoint it names.
- **Payload.** The payload is a thin event:

  ```json
  { "id": "…", "type": "corpus.note.changed",
    "subject": "wiki://software/project/standmeet/architecture", "occurred_at": "…",
    "data": { "op": "updated", "note_id": "…", "published": true, "was_published": true } }
  ```

  The consumer reads the resource through the public or scoped API it already uses. A delete
  carries the last known subject.

### Webhook endpoints

```
webhook_endpoints (id, owner_id, url, description, event_types text[] -- glob list,
                   secret_enc, embed_id NULL -- scope source, enabled,
                   disabled_reason, failing_since, busy_until, created_at, updated_at)
```

- `failing_since` starts the cooldown and the 5-day disable. `busy_until` is the per-endpoint lease
  (see *Concurrency*). Deleting the embed deletes its endpoint (`ON DELETE CASCADE`).
- **Ops.** The owner domain declares these ops once, and the MCP and admin faces are projections of
  them:
  - `webhooks.list`, `webhooks.create`, `webhooks.update` and `webhooks.delete`.
  - `webhooks.rotate_secret` shows the new secret once.
  - `webhooks.send_test` sends a `webhook.test` event.
  - `webhooks.deliveries` reads the `webhook.deliver` job rows for that endpoint: attempts, the
    state and the last error, each linked to the job in the Tasks panel.
  - `webhooks.redeliver` re-delivers the endpoint's discarded jobs after the receiver is fixed.
  - `webhooks.event_types` lists the types whose `Exposure` is `Webhook`.
  - Admin routes: `/api/admin/webhooks*`.
- **Admin.** A **Webhooks** section under Integrations has an endpoint list, a create form with a
  URL and event-type checkboxes, a one-time secret reveal, a delivery log with links to
  `/admin/tasks?job=<id>`, and a "send test" button.
- **The embed "update hook".** `embeds.create` and `embeds.update` take `update_hook_url`. Filling
  it creates or updates the endpoint attached to that embed, with
  `event_types = ["corpus.note.changed"]` and the embed's code scope. The response carries
  `update_hook {endpoint_id, url}`, and the secret only when the endpoint was just created. The
  embed form has an *Update hook URL* field. The receiving side is described under standmeet.com
  below.
- **Embed sync mode.** Each embed chooses how the consuming site keeps up with the corpus. The
  embed owns this fact; the consuming site reads it and keeps no setting of its own.
  - `copy` (*RSS + hook*): the site keeps a copy (standmeet.com: Workers KV, from which it serves
    the blog, RSS and sitemap). The instance tells it what changed through the update hook. A
    `copy` embed must have an update hook URL.
  - `live`: the site reads the instance on every request and keeps no copy. There is no hook:
    setting `live` deletes the attached endpoint, and an update hook URL sent with `live` is
    refused (`400`, "a live embed has no update hook").
  - `embeds.create` and `embeds.update` take `sync_mode`. It defaults to `live` on create. The
    embed form shows it as a choice; the *Update hook URL* field belongs to `copy`.
  - Public read: `GET /api/v1/embeds/{kid}` → `{kid, sync_mode}`. The kid is already public (it is
    in the embed snippet); nothing secret is returned. `Cache-Control: max-age=60`.
  - Migration: column `sync_mode` (`live` | `copy`, not null). An existing embed with an attached
    endpoint becomes `copy`; every other embed becomes `live`.

## Where it lives

The fixed `internal/` directory set is enforced by `check-internal-dirs.sh`. Domain-less
mechanism goes in `infra`.

| Package | What | Layer rule |
|---|---|---|
| `internal/infra/jobs` | The ports (`Jobs`, `Inspector`, `Runtime`), the queue table, the failure classes and `DefaultBackoff`. | Knows no domain. |
| `internal/infra/jobs/river` | The River adapter: River's migrator, the worker, periodic jobs, the inspector, `Wait`. | The only package importing `riverqueue`. |
| `internal/infra/events` | The `Recorder`, the type declarations, the relay loop, retention, the reads for the panel, and webhook signing, sending and classification. | Knows only type strings and JSON. Scope is decided by the owner-domain subscriber, so infra imports no domain (`check-infra-not-domain`). |
| `internal/infra/pgstore` | `InTx`, `Nested`, `DBTX`, `Listener`, `Notify`. | The only place a transaction is begun. |
| `internal/infra/sideeffect/{mail,supplier}` | The mail port and the durable `supplier.invoke` job. | Importable only by `subscriber` packages, infra and the composition root. |
| Each domain | Declares its event types, subscriptions and job kinds (data), and calls `Record` in its use cases. | Normal domain layering, with `subscriber` between usecase and facade. |
| Webhook endpoints | The owner domain holds the repo, the ops and the `subscriber` (fan-out and delivery). Endpoints are instance configuration, like suppliers. | Via facade. |
| Tasks panel ops | The stats domain (`internal/stats/ops/tasks.go`). | Owner plane only. |

Later option: delivery could become an externalized dsh block that subscribes to the event seam.
We do not do this now. The block event seam (Phase 5) has to exist first, and the webhook worker
is mechanism rather than a capability.

## Interfaces: the implementation is swappable

The upper layers (domains, the admin panel, MCP) depend only on our own interfaces. River is one
implementation. Replacing it with another queue must not change any upper-layer code. The
transport is swappable; the outbox is not. Whatever runs underneath, an event is first written to
the outbox in the same transaction as the domain change.

| Interface | Methods | Implementations |
|---|---|---|
| `events.Recorder` (fixed) | `With(tx) Recorder`, `Record(ctx, ownerID, type, subject, data) error` | the outbox writer (Postgres), the only one |
| `jobs.Jobs` | `With(tx) Jobs`, `Enqueue(ctx, kind, args, EnqueueOpts{RunAt, UniqueByArgs}) (JobID, error)` | River adapter |
| `jobs.Inspector` | `Overview(kind)`, `List(filter)`, `Get`, `Retry`, `Cancel`, `Periodic`, `RunPeriodic` | River adapter |
| `jobs.Runtime` | `Jobs` + `Inspector` + `Wait(ctx, id, max) (State, ok)`, `Start`, `Stop` | River adapter |
| `jobs.Handler` | `func(ctx, args json.RawMessage) error`, idempotent | job kinds and subscriptions |

- There is no separate `Transport` interface. Subscriptions are data (`events.Subscription`) that
  the bus turns into job kinds, and the relay enqueues through `jobs.Jobs`. A different transport
  would replace the relay inside `internal/infra/events`; no domain code would change.
- Periodic jobs are data too (`jobs.Periodic{Name, Every, Run}`), handed to the runtime at
  construction.
- States: `pending`, `running`, `retryable`, `completed`, `discarded`, `cancelled`. A handler's
  `jobs.Discard(err)` becomes River's cancel-with-error and shows as `discarded`; a cancel from the
  panel shows as `cancelled`.
- The interfaces carry only strings and JSON: `type` and `kind` are strings, `data` and `args` are
  JSON. Kinds are strings on River through one raw-JSON args type plus `KindAliases`
  (`internal/infra/jobs/river/worker.go`), so River's generic arg types never leak upward.
- The contract does not change with the implementation: at-least-once delivery, idempotent
  handlers, no ordering across events.
- A gate keeps River behind the port: only `internal/infra/jobs/river` may import `riverqueue`
  (`check-queue-behind-port.sh`, no exclusion list).
- A conformance suite (UT, about 27 cases) states the contract. Any new implementation must pass it
  unchanged, and the full e2e acceptance must stay green.

## Phases

Every phase is test-first (e2e, black-box, real services). Its specs must be seen **red** on the
unchanged code (`make test-asis`) before any implementation. The webhook sink mock is a set of
routes on the external mock (`mock-stack/job-board/webhook_sink.go`):
- It records every request with its headers and body.
- It can be told to return a status for the next N requests, or to delay (`/__mock/set_delay`).
- It exposes what it received.
- It sits in `EGRESS_ALLOW_HOSTS` for e2e only.

### Phase 0: decisions and spike
- [x] Adopt River v0.47 (see *Decided*). River's tables are created by River's own migrator
      (`jobsriver.Migrate`), called at boot right after `pgstore.Migrate`, on fresh and old volumes
      alike. `schema.sql` does not copy River's DDL: River owns it, and a copy would drift on the
      next River upgrade. A worker starts and stops cleanly with the server context.

**Spike outcomes (2026-09-26).** These refined the sections below; the sections now match the
build.
- **Kinds are strings on River.** One raw-JSON args type whose `Kind()` returns the declared kind
  name and whose `KindAliases()` lists every declared kind, so each kind is registered with River by
  its string name. River's generic arg types never leave `internal/infra/jobs/river`.
- **No River unique jobs for coalescing.** River requires `running` in a unique job's `ByState`, so
  a change that arrives while its index job is running would be merged into the running job and
  lost. Coalescing happens in the relay instead, and only for a subscription that opts in.
  (Unique-by-args is still used where it is right: one `webhook.deliver` per endpoint and event.)
- **The relay is not a River job.** It is a loop in every process, woken by `LISTEN` and by a
  1-minute sweep. `FOR UPDATE SKIP LOCKED` already prevents a double fan-out, so it needs no
  leader, and a one-second periodic job would fill `river_job` with rows.
- **Completion is a notification, not an outbox event.** A job reaching a terminal state sends
  `pg_notify('standmeet_job_final', id)`. One shared `LISTEN` connection per process
  (`pgstore.Listener`) wakes in-request waiters (cap 64). The job row is the durable record the
  panel and `tasks.get` read. Recording `job.completed` into the outbox would fan out again for
  every job. Business state that follows a send (for example "replied") is written by the handler
  after the send succeeds.
- **Periodic jobs are declared as data** (`periodic.Job` → `jobs.Periodic`) and handed to the
  runtime at construction, not registered through a `Periodic(...)` method.
- **Pool size.** pgxpool `MaxConns` goes from 20 to 40. The boot check requires the sum of queue
  workers plus the relay to be at most half of `MaxConns` (today 19 ≤ 20).

### Phase 1: the bus, with Meili as the first consumer
- [x] `events` table, `corpus_notes` trigger, `pg_notify`, relay, subscriber registry.
- [x] `corpus.index` subscriber replaces the 9 explicit hook calls, the SEO reindex and the
      Obsidian reindex goroutine. `IndexNote` read failures are retried by River instead of warned
      and dropped. The 8 s reconcile loop and the process-local `dirty` flag are deleted. A
      `corpus.reindex` job (full rebuild) is enqueued at boot.
- [x] Periodic jobs run on River (leader-elected, run on start). The in-process scheduler and the
      stats `JobRegistry` are deleted; `instance.jobs` reads River's durable records.
- [x] Obsidian import: the per-note trigger events cover indexing, and the reindex goroutine is
      deleted (inventory #11, #23).
- **Acceptance (e2e):** `events-index-via-bus`, `events-bulk-import-bound`, `tasks-panel`,
  `tasks-panel-more`, `upgrade-events-outbox`.
  - A wiki entry created through MCP `corpus.create` is found by visitor-side `corpus_search`
    (Meili) at once. Shown red on the unchanged code first. (Owner-side `corpus.search` reads
    Postgres and is unaffected.)
  - An update and a delete show in search at once, and the write receipt says so.
  - A write during a Meili outage returns a receipt and is indexed once Meili is back, even across
    a backend restart in between.
  - A bulk import: every note searchable, at most N + slack index jobs, none discarded.

### Phase 2: webhooks
- [x] `webhook_endpoints`, the ops, the admin section, signing, SSRF guard, retry schedule,
      cooldown, auto-disable, delivery log, re-deliver, `webhook.test`.
- [x] Event types exposed: all 39, thin. None is subscribed by default.
- **Acceptance (e2e):** `webhooks`, `webhook-event-types`, `events-fault-injection`.
  1. The owner adds an endpoint in /admin → the owner edits a published wiki entry → the sink
     receives `corpus.note.changed`. The signature verifies with the secret revealed at creation,
     and the `subject` equals the entry's URI.
  2. Scope: two changes, one inside and one outside the endpoint's scope, followed by one
     sentinel change inside the scope. The sink's received subjects equal exactly
     [inside, sentinel] in order. This is a positive assertion, not an absence test.
  3. The sink returns 500 twice → the delivery log shows attempt 3 succeeded, and the event is
     received exactly once with status 200.
  4. `send_test` delivers `webhook.test` to the sink.

### Phase 3: embed update hook and standmeet.com
- [x] The embed form's *Update hook URL* field maps to an attached endpoint, as described in the
      model (e2e `embed-update-hook`).
- [x] `/api/v1/corpus-cards` gains `updated_at` (second precision).
- [ ] standmeet.com (separate repo `atmaxmoj/standmeet-landing`). Built, not deployed:
  - Blog, RSS, the blog sitemap and "latest notes" render per request from Workers KV (Astro
    Cloudflare adapter; `prerender = false` only on the blog routes; latest notes as a server
    island).
  - `POST /api/corpus-hook` verifies the Standard Webhooks signature (±5 min), dedupes on
    `webhook-id` (24 h in KV), re-lists cards and fetches only entries whose `updated_at` moved,
    both languages.
  - Links are resolved at request time against the current index.
  - The first request fills KV (bootstrap). No reconcile cron: delivery is guaranteed or visibly
    failed (see *Decided*).
  - Deploy needs the KV namespace id and `CORPUS_HOOK_SECRET`.
  - **Deploy attempt 2026-09-27, rolled back.** KV namespace `standmeet-landing-CORPUS`
    (`559323b2547b4ea888f45b3e885e303f`) exists. The Worker's logs showed two errors on the first
    request with an empty KV: `Too many subrequests by single Worker invocation` and
    `Worker exceeded CPU time limit`. The account is on the free Workers plan: 50 subrequests and
    10 ms CPU per request. The bootstrap fetches every entry in both languages in one request, so
    it cannot fit. `wrangler dev` does not apply these limits, so it passed locally. The landing
    repo was reverted to the static blog, and the embed's hook was detached.
  - Measured (Node, local): the blog subtree is 127 cards, 254 entries. A full fill is 255
    subrequests and about 780 ms CPU. One render averages 3 ms; the slowest take 13–24 ms, above
    the free plan's 10 ms even alone. So the copy mode needs Workers Paid; the free plan fits only
    the live mode, and even there the heaviest notes are at risk.
- [x] **Embed sync mode** (see the model): `sync_mode` on the embed, the form choice, the public
      read, the migration. Released in v0.1.78; the standmeet.com embed reads `live`.
  - **Acceptance (e2e, `embed-sync-mode`):** create a `copy` embed with a hook URL → the public
    read says `copy` and an edit reaches the sink; switch it to `live` → the public read says
    `live` and the next edit reaches no endpoint because the endpoint is gone (asserted as the
    endpoint list, not an absence of deliveries); `live` with a hook URL → `400` with the sentence.
    Upgrade: an embed with an endpoint before the migration reads `copy` after it.
- [x] **standmeet.com follows the embed's mode.** The Worker reads `sync_mode` by kid (cached
      60 s). Deployed (landing `e1c217f`); if the mode cannot be read it keeps the last answer,
      else serves the copy.
  - `live`: blog, RSS, sitemap and latest notes read the instance per request. No KV, no hook.
  - `copy`: the KV copy. The hook refreshes **synchronously within a budget** (at most 4 cards per
    invocation) and answers `200` only when KV has caught up, else `503`. The instance's durable
    retry is then the continuation, and a refresh that fails is visible on the instance. The first
    fill also advances one budget per page request. No reconcile cron.
- [x] **Acceptance:** the owner edits a note on sijie.xyz → within 60 s the standmeet.com page shows
  the change without a deploy. **Passed 2026-09-27 on v0.1.78, live mode:** a line added to the
  vault note `events/storage-bounds` and synced through `obsidian.import` was on
  `standmeet.com/en/blog/…/storage-bounds/` (plain URL) under 1 s after the sync returned; the
  revert disappeared the same way. Every blog route answers 200 on the free plan, the heaviest note
  (`backend-domain-modules`) included. The copy mode's real-environment check (S5, the signed
  hook) waits for an embed that uses copy, which needs Workers Paid.

### Phase 4: consolidate the rest
- [x] `access_request.created` → `owner.notify` sends the email with retries. The synchronous call
      in `access_requests.go` is removed. The approval mail (#2, send then mark replied) and the
      email-change confirmation (#4) are jobs; the mail port is `internal/infra/sideeffect/mail`;
      the per-recipient cap snoozes (#98).
- [x] Booker records `booking.*` through the `booking.record` host op. `owner.notify` sends the
      mail, and `invoke_background.go` and `notifyPolicy` are deleted. The background supplier call
      is the durable `supplier.invoke` job; the compensating calendar delete goes through it.
- [x] `microsite.build.settled` replaces `buildnotify`. Waiters wake on LISTEN/NOTIFY, keyed by
      owner.
- [x] `jobs.fetch_new` runs one `jobs.fetch_source` job per source; `jobs.fetch_result` returns the
      listings.
- **Acceptance (e2e):** `events-side-effects-durable`, `events-build-settled`.
  - The mail mock fails the first send → the access-request email still arrives.
  - A booking made while the backend restarts still notifies the owner.
- The diff of this phase must be net **deletion** in the call sites. A replacement that adds
  aliases or wrappers around the old path is the wrong direction.

### Phase 5: later, not scheduled
- dsh plugins subscribe to events. The manifest declares `on: ["corpus.note.*"]`, and the host
  delivers the event as a verb call.
- The activity feed becomes a projection of `events` instead of a read-time UNION.
- Live admin updates over SSE from the same stream.
- The IM bridge receives pushes instead of polling.

## Decided

Decided by the owner on 2026-09-26: every recommendation below is adopted. The second table
records the decisions made during the build.

| Decision | Outcome | Why |
|---|---|---|
| Queue implementation | River, behind the `Jobs` / `Inspector` / `Runtime` interfaces | Proven in production; no new service; MPL-2.0 is compatible with AGPL; swappable later without upper-layer changes |
| Row-change capture | Database triggers with a `WHEN` clause; semantic events stay explicit `Record` calls | Coverage is total by construction; a skipped call cannot happen |
| Payload | Thin (type, subject, ids) | Nothing private leaves the instance; one source of truth |
| Off the bus | Monitor and traffic recording | High volume, no consumer; moving it would double the write load |
| Reconcile loops | None: no daily cron on standmeet.com, and the Meili 8 s loop is deleted | Outbox plus durable jobs plus panel alerts already guarantee delivery or make failure visible. A reconcile loop hides unreliable delivery; with reliable delivery it is not needed. |
| Open inventory items | Resolved as proposed in *Consolidation inventory* | — |

| Build decision | Outcome | Why |
|---|---|---|
| Coalescing | Per-subscription opt-in; only `corpus.index` coalesces | The index re-reads current state, so the latest change covers the rest. A webhook or a mail delivers a fact; merging two facts loses one. |
| Relay | A loop in every process plus a 1-minute sweep, not a River job | `SKIP LOCKED` already prevents double fan-out, so no leader is needed. A frequent periodic job would fill `river_job`. The sweep covers a lost NOTIFY. |
| One delivery per endpoint | A lease row (`webhook_endpoints.busy_until`), not `pg_try_advisory_xact_lock` | An advisory transaction lock would hold a transaction, and a connection, across the POST. |
| Owner-notify burst cap | Stays a drop (5 per owner per hour), now a Postgres slot | A flood must not mail the owner once per request; every request stays visible in admin. A retry keeps its slot, so retries never eat the cap. |
| Synchronous supplier calls | Sent once; the in-request `retry.Do` is gone | Retry has one owner. A visitor waiting on calendar free/busy gets `ErrCalendarUnavailable` at once instead of waiting through backoff. |
| Completion | `pg_notify` on terminal state; no `job.completed` / `job.discarded` outbox events | An outbox event per job would fan out again for every job. |
| Fetch result | `jobs.fetch_result {job_ids}` returns the listings; `tasks.get` shows state only | The Tasks ops stay generic; the job loop owns its result shape. |
| Scheduled fetch | None | `docs/design/job-loop.md` rejects an automatic daily fetch. |
| Gate self-tests | None kept. Each gate was shown red once on a planted sample in a scratch copy. | A gate is a gate; a self-test script is one more thing to keep green. |
| Meili client retries | Disabled (`meilisearch.DisableRetries()`) | The job layer owns retries. |

## Storage bounds

The main risk of a queue inside the database is unbounded storage. The rule: every way storage
can run away has a **hard bound** and is **visible**. None of them rely on "it should get cleaned
up".

| Runaway | How it happens | Control | How it is enforced and seen |
|---|---|---|---|
| `events` grows forever | Nothing deletes rows, or the relay is stuck and un-fanned rows pile up | The periodic job `events retention` runs hourly and deletes rows that are fanned out and at least 7 days old. Unfanned and poisoned rows stay: they are the backlog. | The overview shows the backlog, the poisoned count, the age of the oldest un-fanned event and the table size. Alert `events_backlog` above 1,000 unfanned or oldest over 5 min; alert `events_poisoned` for any poisoned row. The alert is on the panel, not an email: mail may be the very thing failing. |
| Finished `river_job` rows pile up | Completed jobs stay in the table | River's job cleaner on the elected leader, at River's defaults: completed rows after 24 h, discarded rows after 7 days | The overview shows the table size. Alert `jobs_discarded` while discarded jobs exist. |
| Retries to a dead endpoint pile up | The receiving site is down for a long time | `MaxAttempts` 18. During a failure streak new deliveries are scheduled 5 min out. The endpoint is disabled after 5 days of continuous failure, and a disabled endpoint gets no new fan-out. | Endpoint state and disable reason are shown in admin. |
| A bulk operation explodes fan-out | One Obsidian import of 2,000 notes | The relay takes at most 200 rows per pass. `corpus.index` coalesces per subject within a batch. Webhooks do not coalesce: each event is a fact, delivered once per subscribing endpoint. | e2e `events-bulk-import-bound`. |
| No-op updates emit events | Only `updated_at` was touched | The trigger has a `WHEN` clause: it writes only when a watched column really changed | A spec asserts the event sequence before a sentinel event, a positive assertion. |
| One bad event stalls the pipeline | The relay fails on the same event repeatedly | A failing batch is retried row by row. A row that fails 5 times is poisoned and raises an alert; delivery failures are retried by their own jobs. | Same as above: the backlog is visible. |
| Dead-tuple bloat | High-churn updates on queue tables leave MVCC row versions until vacuum | `events` has lower autovacuum thresholds (scale factor 0.02). `river_job` keeps River's settings: River owns that DDL. | The overview shows the table sizes. |

Precedent: the visitor-traffic table would also grow without bound. It is held by a 24 h retention
job (`visitor traffic retention`). The event and job tables follow the same pattern.

Other choices do not remove this problem:
- A Redis queue grows the same way, and our Redis evicts silently when full.
- Kafka has built-in retention by time or size, at the cost of running another service.

## Admin "Tasks" panel

The queue, the periodic jobs, the event stream and the delivery log are visible and actionable
in admin. The panel follows River UI's information layout, but River UI itself is not adopted: it
is a separate service with its own auth. The panel is built on dispatcher ops in the stats domain,
so admin and MCP both get it. An owner can also ask their AI "are any tasks stuck?".

| View | Shows | Actions |
|---|---|---|
| Overview | job counts per state, age of the oldest pending job, `events` backlog and poisoned count, table sizes, alerts | — |
| Periodic jobs | name, interval, last and next run, last result | run now |
| Job list | filter by kind (every declared kind, before it ever ran) and state (pending, running, retryable, completed, discarded, cancelled) | — |
| Job detail | args, the error of every attempt, the next retry time | retry now, cancel |
| Event stream | recent events: type, subject, the subscribers each fanned out to | — |
| Event detail | payload, the relay's last error, and the job state per subscriber | requeue (poisoned events only) |
| Webhooks (own section) | endpoints, delivery log, send test, re-deliver | links to job detail |

- The section sits in the settings group, after traffic. `?job=<id>` opens a job directly (the
  webhook delivery log links here).
- The periodic-job list in the old monitor panel was backed by the in-memory `JobRegistry`, lost
  on restart. It is deleted; `instance.jobs` (System panel) now reads River's durable records.

The ops are declared once and projected to admin (`/api/admin/tasks*`, `/api/admin/events*`) and
MCP:
- Reads: `tasks.overview`, `tasks.list`, `tasks.get`, `tasks.periodic`, `events.list`, `events.get`.
- Actions: `tasks.retry`, `tasks.cancel`, `tasks.run_periodic`, `events.requeue`.
- The plan's "discard" on a job is `cancel`: River stops a job for good only by cancelling it, so
  a second verb would do the same thing.
- `webhooks.deliveries` is a filtered view of `webhook.deliver` jobs.

These ops are owner plane only; they are not on the API-key face. Job args and event payloads are
thin, so the panel never shows corpus bodies.

Acceptance (e2e `tasks-panel`, `tasks-panel-more`): a failing job is produced → the panel shows
it and its error → the owner clicks Retry → the state becomes completed.

## Code structure

Most of this is "infra behind interfaces" and needs little comment. Three things need a decision:
how a transaction reaches the use case, how subscribers register with zero glue, and where the
side-effect ports move.

| Package | Holds | Rule |
|---|---|---|
| `internal/infra/pgstore` | `InTx(ctx, db Beginner, fn)`, `Nested(q, pool)`, `DBTX`, `Listener`, `Notify` | the only place a transaction is begun |
| `internal/infra/events` | `Recorder`; type declarations; relay and retention; reads; webhook signing, sending and classification | strings and JSON only |
| `internal/infra/jobs` | `Jobs`, `Inspector`, `Runtime`, `Kind`, `Periodic`, failure classes | no domain imports |
| `internal/infra/jobs/river` | the River adapter | the only package importing `riverqueue` |
| `internal/infra/sideeffect/{mail,supplier}` | the mail port; the `supplier.invoke` job | importable only from `subscriber` packages, infra and `cmd/server` |
| `internal/infra/detach` | `detach.Go`: owns a goroutine and absorbs its panic | for in-process plumbing such as the block mount warm |
| each domain's facade | the domain's event types, subscriptions and job kinds (data) | collected in `cmd/server/wire/periodic.go`, one line per source |
| `internal/<domain>/subscriber` | subscriptions and job handlers (`corpus`, `owner`) | new layer between usecase and facade: may use usecase and repo, not the reverse |

**How a transaction reaches the use case (the real change).** Transactions used to be opened
**inside** repos, and most writes were single autocommit statements. Use cases held no
transaction, so an explicit `Record` could not join the business write. Trigger-captured row
events are unaffected; semantic events are.

**The transaction is an explicit parameter, never a `ctx` value.** `ctx` already carries 14
`WithValue` keys. Putting the transaction there too would add a hidden dependency: whether a repo
call joins a transaction would depend on what the caller's `ctx` happens to hold. That is how `ctx`
becomes a god object.

```go
err := pgstore.InTx(ctx, s.pool, func(tx pgstore.Tx) error {
    if err := s.requests.With(tx).Create(ctx, req); err != nil {
        return err
    }
    return s.events.With(tx).Record(ctx, ownerID, "access_request.created", subject, data)
})
```

- `pgstore.InTx(ctx, db, fn)` begins the transaction on `db` (a `Beginner`: the pool, or an open
  transaction) and hands it to `fn` as a parameter. Commit lands the business rows, the event and
  the job together. A panic in `fn` rolls back and re-panics.
- `pgstore.Nested(q, pool)` is where a repo bound by `With(q)` opens its own transaction: a
  savepoint inside `q` when `q` is a transaction, else a transaction of its own on the pool.
- Every repo, `Recorder` and `Jobs` gets `With(tx)`, returning a copy bound to that transaction.
  Existing method signatures do not change. A call without `With` behaves exactly as before.
- Who is inside the transaction is visible at the call site and checked by the compiler.
- `ctx` carries cancellation and deadlines only; this plan adds no `ctx` key. `Record` takes the
  owner and other inputs as explicit arguments, never from `ctx`.
- Gate `check-tx-only-via-pgstore.sh`: `.Begin(`, `BeginTx(` and `BeginFunc(` may appear only in
  `internal/infra/pgstore`. The 11 existing `Begin` sites were converted (the plan estimated ~20).
- UTs: an error or panic in `fn` rolls back business rows, event and job together; a `With(tx)`
  copy does not alter the original; calls without `With` behave as before.

**Subscribers with zero glue.** Each domain declares its event types, subscriptions and job kinds
as data, the same shape as dispatcher ops. The composition root collects them with one line per
source; it says nothing about what a job does. The only dedicated wiring is the embed-scope
function (`EmbedAdmits`, from the access domain) handed to the owner domain's fan-out.

**Side-effect ports moved.** `OutboundSender` lived in `cmd/server/port` and the background
supplier call in `plugin/adapters`. The mail port is now `internal/infra/sideeffect/mail` and the
background supplier call is the durable `supplier.invoke` job in
`internal/infra/sideeffect/supplier`, so the gate governs them. Their error tables, lint
exemptions and test hooks moved with them.

## Response contract after going async

A response never claims what has not happened. It promises only what is committed. Work still in
flight is represented by a **receipt** (an event id or a job id) whose state can be read. Where a
caller needs to read its own write, the request waits briefly, then falls back to the durable job.

| Side effect | What the response promises | How the caller learns the rest |
|---|---|---|
| Search index (search right after write) | `corpus.create` / `corpus.update` / `corpus.promote` wait up to 2 s (`LatestFor` → `AwaitFanout` → `jobs.Wait`) and return `indexed: true`; on timeout `indexed: false` plus `index_job_id` | MCP or UI reads `tasks.get`; an AI that sees `false` knows to search again later |
| Access-request notification | "Submitted", never "the owner has been notified" | The owner sees the mail job in the Tasks panel; a final `discarded` raises an alert |
| Approval mail | The code (issued synchronously) plus the mail job; MCP `access_requests.approve` waits up to 2 s | The request row shows the mail state: sending, sent or failed |
| Booking notification | The booking succeeded (the booking row is committed); the notification state is separate | Same as the access-request notification |
| Obsidian import | The number of notes imported (committed) | The per-note events index each note; the Tasks panel shows the jobs |
| Microsite build | Queued, plus the build id | Waiters wake on `microsite.build.settled` (NOTIFY keyed by owner), no longer an in-process signal |
| `jobs.fetch_new` | The listings when every source finished within 20 s; otherwise `{job_ids, pending: true}` | `jobs.fetch_result {job_ids}` returns the same shape |
| Webhooks | A write response to the owner promises no delivery | The delivery log |

The same rule governs copy: UI and MCP text states only confirmed facts. "Sent" appears only after
the job is `completed`.

## Completion hooks: who waits for the result once work goes async

A code check of the 13 operations being moved found 4 whose callers waited for the result. Going
async, each needed a completion signal.

| Operation | Who waited | Completion signal as built |
|---|---|---|
| Approval email with the code | Admin showed "emailed to the requester" or the error; MCP `access_requests.approve` returned the result | The code is issued synchronously and the mail job is enqueued in the same transaction (`mail_job_id`). The row shows `request-mail-state` sending / sent / failed. **The request is marked replied only after the send succeeds** (via `UpdateAccessRequestStatus`). MCP waits up to 2 s, then returns the receipt. |
| Email-change confirmation | Toast "Confirmation sent to X" | The pending row is written synchronously with `pending_email_job_id`; the toast says "queued"; the pending row shows the send state. The job mints the link token at send time, so a stale job sends nothing. |
| `jobs.fetch_new` | MCP returned the fetched listings; admin awaited the POST | One `jobs.fetch_source` job per source (fetch queue). MCP waits up to 20 s and returns the listings if done; otherwise `{job_ids, pending: true}`, and `jobs.fetch_result` returns the same shape. `tasks.get` shows state only. |
| Visitor-side search (Meili) reading its own write | `retrieval-search-consistency.spec.ts` asserts a hit right after the write | The write receipt carries `indexed` and `index_job_id`; the request waits up to 2 s |

Nobody waits on the rest: the access-request notification, booking notification, compensating
delete, Obsidian rebuild, post-build hooks and boot backfill. The recovery-phrase email waits for its
result and stays synchronous by decision.

**Mechanism: a terminal job state is a notification.** A job entering `completed`, `discarded` or
`cancelled` sends `pg_notify('standmeet_job_final', id)`. One `LISTEN` connection per process
(`pgstore.Listener`) wakes the waiters of that id; at most 64 wait at once, and past that the
caller gets its receipt immediately. There are no `job.completed` / `job.discarded` outbox events.
UI status chips poll the job state (SSE is Phase 5). Business state follows completion: a state such
as "replied" is written by the handler after the send, never before.

**Existing specs updated.** Rule: change only **when** a spec looks, never **what** it asserts.
Synchronous assertions became waits or polls with the same expected outcome.
- Approval and mail: `mail-supplier`, `mail-throttle-recipient`, `admin-requests` (the 400 with no
  mail supplier **stays synchronous**), `access-request-notifies-owner`.
- Email change and recovery: `account-email-change-needs-confirmation`,
  `account-email-pending-lifecycle`, `account-recovery-row-tells-the-truth`, `account-edit`.
- Retrieval: `retrieval-search-consistency`; re-checked `retrieval-acl`, `corpus-grep`,
  `subjectivity-not-cited`, `corpus-search-cjk-not-silent`.
- Job fetch: the `job-fetch-*` specs, `integration-job-loop`, `application-status-persist`,
  `admin-listings-dedup`.
- `booking-owner-notify` waits for a terminal state before asserting the count.
- The `norm-outward-toolset` golden gained the `tasks.*`, `events.*`, `webhooks.*` and
  `jobs.fetch_result` tools.

## Message loss

Every hop from write to delivery states what happens when it fails. The rule: at least once;
duplicates are absorbed by idempotency. What truly cannot be delivered ends in `discarded`, raises
an alert and can be retried by hand. Nothing is lost silently.

### A loss bug found in design review: reading the outbox by sequence cursor

The first relay design read `seq > cursor`. Sequence numbers are assigned when a transaction
starts, but transactions commit in any order:

1. Transaction A inserts an event and gets `seq 101`, uncommitted.
2. Transaction B inserts an event, gets `seq 102`, and commits.
3. The relay reads `seq > 100`, sees only 102, and moves its cursor to 102.
4. A commits. Row 101 is now visible, but it sits behind the cursor and is never read. It is lost.

**Fix:** no cursor. Each row carries `fanned_out_at`. The relay claims `WHERE fanned_out_at IS NULL
FOR UPDATE SKIP LOCKED`, enqueues and marks in one transaction. An unmarked row is always claimed
eventually; nothing can be skipped. A UT runs two interleaved transactions, and both events end up
fanned out.

### Guarantees per hop

| Hop | Failure | Guarantee |
|---|---|---|
| ① write → outbox | The transaction rolls back | The change and the event vanish together; "changed but no event" and "event but no change" are impossible |
| ② outbox → job | The relay crashes mid-batch | Claim, enqueue and mark share one transaction; a crash rolls all back, and a restart claims again |
| ② lost wake-up | A NOTIFY is lost while the listener reconnects | The 1-minute `events relay sweep` pokes the relay |
| ③ job → execution | The worker is killed mid-job | A job stuck in `running` past the threshold is rescued and retried (River rescuer); a duplicate run is absorbed by idempotency |
| ③ sustained failure | The receiver stays down | Backoff to the limit → `discarded` → alert; the panel can retry by hand. Never silent. |
| ④ received but dropped | The consumer returns 200 but fails to process | Out of our control. `events.list` lets the owner inspect the stream. No scheduled reconciliation. |
| Duplicates | Inherent in at-least-once | `webhook-id` equals the event id and consumers dedupe on it; in-process subscribers are idempotent |
| Mail | SMTP 250 means accepted, not delivered | `Message-ID` is `<event id@standmeet>`; bounce handling is out of scope |
| Owner-notify over the burst cap | More than 5 access requests per owner per hour | A deliberate, logged drop; every request stays visible in admin (see *Decided*) |
| No mail supplier | Nothing can ever be sent | The job completes and logs; no alert |
| The database itself | Disk failure | Same backups as business data (`backup.sh`); no extra promise |

## Retry

Retry has one owner: the job layer. A handler only **classifies** a failure; the policy declared on
the job kind decides when to try again.

**There were three nested retry layers**: `invoke_background` ran `retry.Do`, `mail_retry` applied
`notifyPolicy`, and `httpx` retried 5xx and 429 itself. 3 × 3 × 3 = one failure became up to 27
requests. Now only the job layer retries: `internal/infra/retry` and `notifyPolicy` are deleted,
webhook delivery runs `httpx` with `NoRetry`, and the Meili client's own retries are disabled.

**Synchronous calls a visitor waits on are sent once.** Calendar free/busy, insert and delete
through the openapi adapter no longer run `retry.Do` inside the request. A transient failure maps to
`ErrCalendarUnavailable` at once. A visitor-facing call answers fast; a retry that matters (the
compensating delete) is a durable `supplier.invoke` job.

**Failure classes** (`internal/infra/jobs`):
- `nil`: completed.
- `jobs.Snooze(d)`: the receiver said when to come back (429 or 503 with `Retry-After`, capped at
  10 h), or our own cap is spent. Retried at that time, **without** consuming an attempt.
- `jobs.Discard(err)`: permanent. 4xx other than 408 and 429 (for example 410 Gone), a URL blocked
  by the SSRF guard, a disabled or deleted endpoint, a pruned event, unreadable args. Retrying would
  not help and would only hammer the receiver.
- Any other error: retryable, on the kind's backoff with ±10% jitter.
- From `discarded`, the owner can retry by hand in the panel.

**Policies (declared on the job kind, as data):**

| Kind | Queue | Max attempts | Backoff | When exhausted |
|---|---|---|---|---|
| `corpus.index`, `corpus.reindex` | index | 10 | `DefaultBackoff`: from 1 s, doubling, capped at 15 min | `discarded` + alert; the panel can retry |
| `owner.notify`, `access_request.approval_mail`, `owner.email_confirmation` | notify | 8 | 20 s, then ×3: about 6 h in all | `discarded` + alert (on the panel, not another email) |
| `webhook.fanout` | webhook | 10 | `DefaultBackoff` | `discarded` + alert |
| `webhook.deliver` | webhook | 18 | Svix: 5 s · 5 min · 30 min · 2 h · 5 h · 10 h · 10 h… (about 5.3 days) | `discarded`; the endpoint is disabled after 5 days of continuous failure |
| periodic jobs | maintenance | no retry | the next period | the panel shows the last failure |

**Do not hammer a dead endpoint.** While an endpoint's `failing_since` is set, new deliveries to it
are scheduled 5 min out instead of each hitting it at once. The first success clears
`failing_since`.

**Retries with side effects:**
- Webhooks carry the same `webhook-id` (the event id) on every retry; consumers dedupe on it.
- Mail has no idempotency key in SMTP. The order is "send, then mark" (`notified_at`, replied, or
  the deleted booking notice); a crash in between sends a duplicate. That is the price of
  at-least-once, far better than "lost on failure". The message carries `Message-ID`
  `<event id@standmeet>`, and most mailboxes merge duplicates by it.
- The per-recipient mail throttle (30 per hour) snoozes to the next window instead of dropping.
- Search indexing is an upsert and naturally idempotent.

**Manual retry:** the panel retries a single job; `webhooks.redeliver` re-delivers every
`discarded` job of one endpoint after the receiver is fixed. Covered: 429 with `Retry-After` →
retried later without consuming an attempt; 410 → `discarded` immediately.

## Concurrency and goroutines

All background work runs in workers that are **bounded, time-limited and stoppable**. Bare
`go func` in application code no longer exists.

| Queue | MaxWorkers | Job timeout | Extra limit |
|---|---|---|---|
| `index` | 4 | 30 s (reindex 10 min) | also runs the build-settled subscribers |
| `notify` | 2 | 30 s | also runs `supplier.invoke` |
| `webhook` | 8 | 15 s (fan-out 30 s) | at most 1 in flight per endpoint |
| `maintenance` | 1 | 10 min | periodic jobs |
| `fetch` | 3 | per kind | `jobs.fetch_source`, one job per source (added in P4) |

The numbers are starting values, tuned by measurement.

- **Separate queues, separate limits.** A slow external endpoint can only fill the webhook queue;
  it cannot slow indexing or mail. A UT blocks the webhook queue and asserts that index jobs still
  finish.
- **At most one in flight per endpoint.** `webhook.deliver` takes a lease row:
  `UPDATE webhook_endpoints SET busy_until = now() + 20 s WHERE id = $1 AND enabled AND
  (busy_until IS NULL OR busy_until < now()) RETURNING …`. If it cannot, it snoozes 2 s (no
  attempt spent). The lease outlives the job timeout, so a crashed worker's lease expires on its
  own. It holds across processes. An advisory transaction lock was rejected: it would hold a
  transaction across the POST.
- **The relay takes at most 200 rows per pass.** A 2,000-note import never becomes one huge
  transaction.
- **Queues a request waits on poll every 100 ms** (`jobs.QueueAwaited`: `index`, `notify`); the rest
  keep River's 1 s. River sends one insert notification per queue per `FetchCooldown` (100 ms), so a
  write's second index job (the wiki note, ~5 ms after the raw one) sends none; after the worker's
  fetch it waited for the 1 s poll, ~0.5 s per write. With it a receipt is the poll (≤ 100 ms) plus
  River's batch completer (records completions every 250 ms, not configurable).
- **Connection budget: no network call inside a transaction.** A worker reads what it needs (a
  short read that returns the connection at once), then makes the HTTP call holding no connection.
  pgxpool `MaxConns` is 40. At boot, if the sum of MaxWorkers plus the relay (today 4+2+8+1+3+1 =
  19) exceeds half of `MaxConns`, the server refuses to start.
- **Timeouts and cancellation.** Every job kind has a hard timeout; on expiry its context is
  cancelled and the job counts as retryable. The webhook HTTP timeout (10 s) is shorter than the
  job timeout (15 s), so a clear network error arrives first. A panic in a worker is caught by the
  job layer and counted as a failure; it cannot crash the process.
- **Graceful shutdown** (upgrades recreate containers). On SIGTERM: stop the relay first, then the
  workers. Workers stop claiming and wait up to 20 s for running jobs, then cancel their contexts.
  Unfinished jobs stay `running` and are rescued after restart (at least once).
- **Backpressure for in-request waits.** "Wait up to 2 s for the index" is served by one shared
  LISTEN connection per channel that fans out completion notices, not one polling connection per
  request. At most 64 waiters per channel; beyond that the request returns `indexed: false` at once
  instead of queueing.
- **Process plumbing that must own a goroutine** (a socket accept loop, a LISTEN connection, an
  in-process cache warm) lives in `internal/infra/**` or `cmd/server/**`. `detach.Go` owns a
  goroutine and absorbs its panic (the block mount warm uses it); `hostsocket.ListenWith` starts
  its own accept loop.

## Enforcement: structure first, gates second

Goal: future code **cannot express** a side effect that bypasses the bus. Structure makes it
unrepresentable; gates only stop someone from bringing the capability back.

**Structure: the request path holds no side-effect capability.**
- Every port that affects the outside world lives under `internal/infra/sideeffect/**` (today
  `mail` and `supplier`). Webhook sending is not a port a use case can reach: it lives in
  `internal/infra/events` and runs only inside `webhook.deliver`. A new kind of side effect adds
  its port under `sideeffect` and is governed automatically.
- Use cases (`usecase`, `ops`, `routes`) receive only `Recorder` and `Jobs`. To send mail they can
  only `Record` an event or enqueue a job; a handler in the domain's `subscriber` package sends it.
- Synchronous queries whose result is needed on the spot (calendar free/busy, OAuth, captcha,
  model listing) are not side-effect ports and stay available to the request path. The split is by
  the tree a port lives in, so there is no exclusion list.

**Gates** (six run as `event-bus-gates` in the backend `make lint`; `periodic-via-scheduler` runs as
its own lint target):

| Gate | Forbids | New or existing |
|---|---|---|
| `check-side-effects-behind-bus.sh` | importing `internal/infra/sideeffect/**` from anywhere but `internal/<domain>/subscriber`, `internal/infra/**` and `cmd/server/**` | new; `subscriber` joins the `check-domain-layering` order (between usecase and facade) |
| `check-no-bare-goroutine.sh` | a `go` statement outside `internal/infra/**` and `cmd/server/**` (non-test) | new |
| `check-retry-only-in-jobs.sh` | `retry.Do` outside `internal/infra/jobs` | new (replaces the verbal rule in `mail_retry.go`) |
| `check-periodic-via-scheduler.sh` | `time.NewTicker` / `time.Tick` outside `internal/infra/jobs/**` | existing, updated: the scheduler is now `jobs.Periodic` |
| `check-queue-behind-port.sh` | importing `github.com/riverqueue/**` outside `internal/infra/jobs/river` (tests included) | new |
| `check-table-event-policy.sh` | a `CREATE TABLE` in `schema.sql` without `-- events: emit` or `-- events: none (reason)`; a table declared `emit` without its trigger | new; 58 of 58 tables annotated, only `corpus_notes` emits. A required declaration, not an exclusion list. |
| `check-tx-only-via-pgstore.sh` | `.Begin(`, `BeginTx(` or `BeginFunc(` outside `internal/infra/pgstore` | new (see *Code structure*) |

**Gates are not self-tested.** No permanent self-test script is kept: a gate is a gate. Each gate
was shown red once on a planted sample in a scratch copy before it landed.

The existing goroutine violations were cleared before the gate landed:
- `routes/admin/obsidian.go`: the reindex goroutine was deleted (P1).
- `plugin/adapters/invoke_background.go`: deleted (P4).
- `routes/hostdesk/hostdesk.go` and `agentcore/hostops.go`: the accept loop moved into
  `hostsocket` (`ListenWith`).
- `plugin/mount/mounted_warm.go`: uses `detach.Go`.

**Runtime and test backstops:**
- `Record` with an undeclared type returns `ErrUndeclaredType`. A subscription whose glob matches no
  declared type fails at boot.
- Idempotency is covered by **one registry-driven UT** (`cmd/server/wire`): it iterates every
  registered subscriber, delivers the same event twice to each, and asserts a single effect. It
  fails for a subscriber it does not know how to drive; there is no list to maintain.
- Schema parity: the UT `TestMigrationsAddNothingToASchemaSQLDatabase` applies the migrations to a
  `schema.sql` database and asserts they add nothing. It found `visit_event`, `visit_viewer` and two
  indexes missing from `schema.sql`; they were added.

## Consolidation inventory

A full sweep of backend, app, sdk, builder, im-bridge, infra/plugins and the updater found 101 items.
Targets: **E** emit an event plus a subscriber, **J** durable job, **P** periodic job on River,
**W** exposed as a webhook event type, **K** keep. Row numbers refer to the sweep.
Counts: E 22, J 22, P 9, W 23, K 44 (an item may count in several). The "As built" column says
where each move landed.

### Moves: after-write side effects

| # | What | Where it was | Failed by | Target | As built |
|---|---|---|---|---|---|
| 1 | Access request → email the owner | `access_requests.go:59` → `request_notify.go:44` | blocked the request through retries; lost on failure; Redis throttle dropped silently | E `access_request.created` + J | `owner.notify` (`owner/subscriber/mail.go`); the burst cap is a Postgres slot and stays a drop |
| 2 | Approve request → mail the code + mark replied | `access_approval.go:86-89` | mail sent but status not written = inconsistent | E + J | `access_request.approval_mail` job enqueued with the code; replied written after the send |
| 4 | Email-change confirmation | `email_change.go:138` | failed send left a dangling pending row | J | `owner.email_confirmation` job; token minted at send time |
| 5 | Booking → notify owner | `booker-mcp.js:458` → `invoke_background.go:53` | detached goroutine, lost on restart | E `booking.created` + J | `booking.record` host op writes `booking.*` and a `booking_notices` row in one transaction; `owner.notify` sends and deletes it |
| 7 | Booking persist failed → delete calendar event (compensation) | `booker-mcp.js:309,337` | failed delete left an orphan event, never retried | J | durable `supplier.invoke` |
| 8–10 | Meili upsert / delete / reindex after publish | `corpus_crud.go`, `subjectivity.go`, `corpus.go:139`, `output.go:61`, `seo.go:126,140` | skipped calls, slow requests, process-local dirty flag | E `corpus.note.changed` + J | trigger + `corpus.index` |
| 11 | Full rebuild after Obsidian import | `obsidian.go:115,133` | goroutine, lost on restart | J | per-note trigger events; goroutine deleted |
| 14 | Build settled → auto-publish homepage | `builds.go:242` | failure only logged, never retried | E `microsite.build.settled` + J | `owner.SettleBuild` writes the build row, the event and `pg_notify('standmeet_build_settled', owner)` in one transaction; subscriber `microsite.homepage_publish` |
| 15 | Build settled → recompute asset refs | `builds.go:247,256` | same | E + J | subscriber `microsite.asset_refs` |
| 16 | Build settled → wake preview long-poll | `builds.go:193` → `buildnotify` | in-process broadcast, broke with replicas | E (LISTEN/NOTIFY) | `pgstore.Listener` keyed by owner; the version is the durable ms timestamp of the owner's latest settle; `infra/buildnotify` deleted |

### Moves: goroutines, periodic jobs, calls inside requests

| # | What | Where it was | Failed by | Target | As built |
|---|---|---|---|---|---|
| 22 | InvokeBackground (background supplier call + retry) | `invoke_background.go:49-65` | lost on restart, no dead letter, single process | J `supplier.invoke` | `internal/infra/sideeffect/supplier`; `invoke_background.go` and `notifyPolicy` deleted |
| 23 | Obsidian rebuild goroutine | `obsidian.go:135` | same as #11 | J | deleted |
| 30 | The periodic scheduler itself | `periodic.go:47-92` | ran on every replica; state in memory | P | River periodic jobs; the in-process scheduler deleted |
| 31 | Meili 8 s reconcile | `corpus_index_periodic.go:40` | relied on a process-local flag | delete | deleted |
| 32–36 | public conversation prune, gas refill, resume-draft sweep, traffic retention, usage cleanup | each `*_periodic.go` | ran on every replica | P | River periodic jobs (leader, run on start) |
| 38 | Boot-time Meili index + full backfill | `wire/search_index.go:22` | slowed boot | J | `corpus.reindex` enqueued at boot |
| 39, 62 | Job-source fetch (all sources serially inside the request) | `sources_write.go:133`, `jobfetch.go:149` | slow; could hit the 30 s write timeout | one J per source + E `jobs.fetched` | `jobs.fetch_source` on the fetch queue; `jobs.fetch_result`. No scheduled fetch (`job-loop.md` rejects it). |
| 63 | Outbound mail (`retry.Do` inside the request) | `mail_retry.go:49`, `outbound_sender.go:103` | request blocked through backoff | J (covers #1, #2, #4) | mail port `internal/infra/sideeffect/mail`; `internal/infra/retry` deleted |
| 98 | Mail throttle | `mailthrottle.go:82` | dropped silently | throttle hit snoozes | per-recipient cap (30/h) snoozes to the next window |
| 101 | Background-jobs list in the monitor panel | `jobreg_registry.go:24` | reset on restart | reads River jobs | `JobRegistry` deleted; `instance.jobs` reads River |

### Client polling → pushed events (Phase 5)

| # | Polling | Where | Interval | Target |
|---|---|---|---|---|
| 50 | Microsite list long-poll | `use-microsites.ts:127` | held request | SSE |
| 51 | Poll a build until settled | `use-microsites.ts:290` | 1.5 s | SSE |
| 52 | Sidebar access-request badge | `use-sidebar-badges.ts:39` | 60 s | SSE |
| 54 | Wait for Google Calendar after OAuth | `use-gcal.ts:161` | 1 s × 15 | SSE |
| 56 | SDK recovery of a dropped turn | `agent-adapters.ts:186` | 1 s × 6 | SSE |

### Webhook event types (all thin; none subscribed by default)

The sweep listed 23 rows; as declared they are 37 types, plus `corpus.note.changed` and
`webhook.test`: 39 in all (see *Model › Event*).

| # | Events | Phase |
|---|---|---|
| 75–76 | `access_request.created` / `.approved` / `.status_changed` | P2 |
| 77–78 | `code.issued` / `.revoked` / `.redeemed` | P2 |
| 79–82 | `conversation.started` / `.message` / `.pruned`, `ghost.accepted` | P2 |
| 83 | `booking.created` / `.cancelled` / `.rescheduled` | P4 |
| 84–85 | `application.committed`, `jobs.fetched` | P4 |
| 86–88 | `writing.published` / `.unpublished`, `corpus.note.changed`, `vault.imported` | P2 |
| 89–90 | `microsite.build.settled`, `page.promoted_live` / `.rolled_back` / `.unpublished`, `microsite.store.doc_inserted` | P4 |
| 91–93 | `api_key.issued` / `.revoked`, `supplier.connected` / `.disconnected` / `.activated`, `block.installed` / `.failed` | P2 |
| 94–97 | `gas.exhausted` / `.refilled`, `instance.upgrade_requested`, `owner.login` / `.email_changed` / `.recovery_requested`, `ip_ban.added` | P2 |

### Keep (K)

- Writes into the same database that are themselves the source of truth: #12 cross-link rebuild,
  #13 import receipt, #17 block-failure record, #19 inference usage, #20 dialog, card and ghost
  writes, #21 seen job ids.
- Process plumbing and servers: #24–#29.
- Per-node sandbox cleanup: #37.
- The updater's file signal and polling: #44–#46. It deliberately does not touch the database.
- Telegram long-polling and in-memory im-bridge sessions: #48–#49.
- External calls whose result a visitor needs on the spot: #64 calendar, #66 media fetch, #67
  model listing, #68 spec validation, #71 OAuth, #72 captcha, #73 system probes, #74 inference.
  These are now sent once (see *Retry*).
- Session and cache invalidation: #99–#100.
- Waiting for restart after an upgrade: #55. The server is down during the restart.
- Traffic recording: #18 (decided).

### Open items, resolved as proposed

| # | Item | Resolution | Why |
|---|---|---|---|
| 3 | Recovery-phrase email | K, synchronous | The user waits on the login page and must learn on the spot whether it was sent |
| 6 | Visitor booking confirmation email | K, synchronous | The visitor needs the confirmation now; the compensating delete moves to J (#7) |
| 41–43 | Build queue (hand-written SKIP LOCKED + lease) | K for the queue; its settle hooks go through E | The builder is a cross-process Node sidecar and the queue is already durable; little gain from moving it |
| 47 | im-bridge polls its config every 15 s | K; SSE considered in P5 | The config rarely changes |
| 53 | System info refreshed every 1 s | K | Live metrics are naturally polled |
| 57 | Visitor tools "appear on the next poll" | find the caller before P5 | The sweep did not find the client call site |
| 59–61 | PDF render for application commit, draft, public report | K, synchronous | The user wants that PDF now; commit renders first on purpose |
| 69 | Marketplace install | K | The result is needed on the spot |
| 75–97 | Webhook exposure | all subscribable, none by default, all thin | These are facts of the owner's own instance; security events suit alerting |

### Fixed along the way (not in the plan)

- SDK hydration: `BlockWidget` and `use-chat-session` read `localStorage` in the first render
  (React #418 on prerendered microsites); they now read it after mount.
- The codeless AgentWidget offered bring-your-own-key even with no public provider wired, which
  left the ask box disabled and no way to `/gate` (5 specs red on main). The
  `standmeet-public-chat` meta now carries three states (`true` / `spent` / `false`): a spent
  tier, or a page with BYOAI on, offers the visitor's key; no provider keeps the gate handoff.
- The Tasks panel's kind filter listed only kinds that had jobs; it lists every declared kind.
- A Meili search failure fell back to Postgres without a log line; it now warns.
- `corpus.promote` carried no index receipt, so a search right after a promotion could miss it;
  it now waits like create and update.
- A write's second index job waited for River's 1 s poll when its insert notification was
  rate-limited away (~0.5 s per write, measured); the awaited queues now poll every 100 ms
  (UT `TestAWaitedOnQueuePicksUpAJobWhoseNotificationWasSwallowed`, built on production options).
- A data race on `plugin/mount` `knownToolSpecs`; Tasks detail acting on a stale job after
  switching rows; Meili `Index` now takes a fresh index handle per call.
- Three places where the wiki was right and the code wrong: `schema.sql` lacked `visit_event` /
  `visit_viewer`; a stale Typst comment in `drafts_edit.go`; the manual-upgrade copy told users to
  set a nonexistent `STANDMEET_REDEPLOY_HOOK` (8 locales).

## Test plan

Internal mechanism is covered by UTs (real Postgres, `httptest` endpoints, no mocked database).
External behaviour is covered by e2e. Each phase re-runs the specs that touch the affected areas;
the end is the full suite.

**As built.**
- UT: River conformance (~27), events relay / trigger / recorder (~26), the saturation suite
  (below), registry-driven idempotency (`cmd/server/wire`), the event-type registry, per-use-case
  event coupling, webhook signing (Standard Webhooks vector), classification, scope, embed hook
  upsert, schema parity, SQL path-segment parity.
- New e2e: `events-index-via-bus`, `events-bulk-import-bound`, `tasks-panel`, `tasks-panel-more`,
  `upgrade-events-outbox`, `webhooks`, `webhook-event-types`, `embed-update-hook`,
  `events-side-effects-durable`, `events-build-settled`, `events-fault-injection`.
- Mock: the webhook sink as routes of the external mock (`mock-stack/job-board/webhook_sink.go`),
  plus `/__mock/set_delay`.
- Gates: each shown red once on a planted sample (see *Enforcement*); not e2e.

**UT plan:**

| Suite | Covers |
|---|---|
| Recorder | committed rows land, rolled-back rows vanish; undeclared type errors; Exposure defaults to internal |
| Trigger | every watched column change emits; no-op updates do not; deletes carry old values; payload shape is fixed |
| Relay | row claiming; **interleaved commits lose nothing**; batch size; poison marking; concurrent relays never fan out twice; crash rolls back and re-claims; a non-coalescing subscriber gets every event of a subject |
| Subscriber registry | glob matching; duplicate names error; the registry-driven idempotency test |
| Retry classification | every status code or error → retryable / snoozed / discarded; both `Retry-After` formats; snooze consumes no attempt |
| Backoff and jitter | each policy's schedule; jitter bounds; exhaustion |
| Endpoint cooldown and disable | new jobs deferred during a failure streak; released on success; disabled after 5 days; no fan-out once disabled |
| Signing | Standard Webhooks test vector; secret rotation; timestamp |
| SSRF | private, loopback and redirect-to-private targets blocked and discarded at once |
| Scope | raw never leaves; published slice; code denials apply; an embed inherits its code's scope |
| Storage bounds | retention deletes only fanned-out, expired rows |
| Concurrency | queue limits; per-endpoint lease; boot-time pool budget check; graceful shutdown; timeout cancellation; panic caught; waiter cap |
| Interface conformance suite | the `Jobs` / `Inspector` / `Runtime` contract, run against River now and against any future implementation unchanged |

**e2e plan by phase:**

| Phase | Representative specs |
|---|---|
| P1 | visitor-side search finds an entry just created via MCP (shown red on the old code first); the publish switch takes effect at once; kill after write, restart, still indexed; a bulk import all searchable within the bound; Tasks panel overview / list / detail / retry / run periodic now; event stream shows fan-out; periodic jobs keep their last run across a restart |
| P2 | endpoint created in admin receives a verifiable signed event; inside/outside scope plus sentinel; 500 × 2 then success, received exactly once; 429 + Retry-After; 410 discarded at once; secret rotation; send test; bulk re-deliver; each exposed event type reached by a real action |
| P3 | embed form hook → edit a note → sink receives it; cards carry `updated_at`; an out-of-scope edit does not trigger (sentinel form); standmeet.com updates within 60 s (real environment, pending) |
| P4 | access-request email arrives despite a failed first send; approval mail and status agree; email change; a booking during restart still notifies; build settled after a restart reaches the open preview; background supplier call is durable; mail throttle snoozes instead of dropping |
| Upgrade | an instance born before this plan (no `events`, no trigger, no River tables) upgrades by restart: the migration and River's migrator run at boot, an existing note edited afterwards is indexed through the bus, and periodic jobs run on River; plus `make updater-e2e` |

**Regression and fault injection:**
- **Each phase:** the affected specs (embed, corpus, access, booking, microsite, obsidian, jobs,
  monitor, mail, search, supplier, calendar, upgrade, …) with `REPEAT=5` to rule out flakes.
- **Fault injection:** `events-fault-injection` covers an endpoint slower than the timeout, a
  refused connection and a Postgres restart; `webhooks` covers 500, 429 and 410;
  `events-side-effects-durable` and `events-build-settled` cover backend restarts.
- **Order:** each component's UTs first; each acceptance e2e written first and shown red on the
  unchanged code; then the implementation.

**Saturation and degradation UTs: what "graceful" means when hardware or rate limits are maxed.**
Under saturation the system **slows down, queues and alerts**. It never loses data, never crashes
the process and never starves visitor requests. Each case is simulated with an injected fault.

| Saturation | Expected behaviour | UT asserts |
|---|---|---|
| Connection pool exhausted | A worker's wait for a connection times out and the job counts as retryable; the reserve for visitor requests is always kept | With the pool full, a job does not crash and turns retryable |
| All workers busy | New jobs queue; no new goroutines; queues do not starve each other | With the webhook queue fully blocked, index jobs still finish on time |
| Downstream rate limit hit (endpoint 429) | Snooze until `Retry-After` without consuming an attempt; the endpoint enters its cooldown | Repeated 429s never exhaust a job into `discarded`; no extra requests go out during cooldown |
| Our own mail throttle hit | Snooze until the window ends; never drop | Mails over the limit all go out in the next window, same count |
| Disk full / Postgres refuses writes | The business write and its event fail together with a readable error; the relay backs off instead of spinning | No "changed but no event"; the relay's retry interval grows |
| Meili fully down | Index jobs back off and retry; writes are unaffected; the backlog drains after recovery | After recovery every backlogged job completes, none discarded |
| Backlog surge (bulk import) | Same-subject index jobs coalesce; an alert fires above the threshold | Job count within the bound; the alert flag is set |
| In-request waiters full | Requests over the cap return the receipt at once instead of queueing | The 65th waiter immediately gets `indexed: false` |
| Job timeout | The hard timeout cancels the job, which turns retryable; other queues are unaffected | The timed-out job is cancelled and can be rescued |

**Tasks panel e2e** (real UI; every assertion is on what the page shows):
1. Overview numbers match reality: make 3 retryable and 1 discarded; the overview shows 3 and 1 and
   the age of the oldest pending job.
2. The job list filters by state and kind; results contain only the selection.
3. Job detail shows every attempt's error and the next retry time.
4. "Retry now" → the state becomes completed, and the side effect really happens.
5. "Cancel" → the job no longer runs and its side effect does not happen (a sentinel job proves the
   queue is running).
6. The periodic list shows last and next runs; "Run now" updates the last-run time.
7. After a backend restart, the panel still shows periodic runs from before the restart.
8. Event stream: edit a note → the event appears; its detail lists the subscribers it fanned out to
   and each one's state.
9. The webhook delivery log links to job detail; "Re-deliver all" delivers every discarded job of
   that endpoint.
10. Alert: the panel shows an alert while the backlog is over the threshold, and clears it once
    drained.
11. Permission: calling `tasks.*` with an API key (not the owner) is refused.
12. Completion hooks: after approving a request, its row goes from "sending" to "sent"; with the
    mail mock failing first it shows "failed", then "sent" after the retry; `jobs.fetch_new` past its
    wait limit returns a receipt, and `jobs.fetch_result` returns the result in the same shape.
13. Requeue: a poisoned event, put back with `events.requeue`, fans out. No user action can
    poison an event (only a failing database does), so this one is a UT on the op
    (`stats/ops/tasks_requeue_test.go`), not an e2e.

**Final acceptance: every test in this repo green — passed 2026-09-27** (lint, backend-test,
test-unit, im-bridge-test, updater-e2e, every eval but the interactive `eval-ask`, dsh-plugin-test
14/0, and the full e2e run; see `docs/full-suite-failures.md`).

`make dsh-plugin-test` follows DSH itself, not dsh-testkit. `@deepseek-ai/cordis-plugin-hmr` 1.0.18
(2026-09-22) removed `registerConfig` in a patch release, so every DSH that dsh-testkit 0.4.4 accepts
(≤ 0.1.5) crashed at boot, and no testkit release supports DSH 0.1.7. The suite now drives DSH
0.1.7-rc.2 through its own lifecycle (`dsh plugin add`, `--dump-config`, a probe patch, `dsh plugin
remove`; `infra/dsh-acceptance/run.mjs`), pinned in one place. Each plugin declares its DSH peer range
(`peerDependencies["@deepseek-ai/dsh"]`), which DSH checks at install and at every start; blocks find
their install directory through the running profile, not a hardcoded profile name.

### Production smoke tests (after the release, on sijie.xyz)

Each one drives the live instance through its real surfaces (owner MCP, admin UI, public page)
and records its evidence in `docs/real-env-verification/`. A smoke test passes on what an outside
observer sees, not on a status the instance reports about itself.

| # | Capability | Pass when |
|---|---|---|
| S1 | The upgrade | `instance.status` reports the new version; the Tasks panel loads with no alert |
| S2 | Index via the bus | A new wiki note answers `indexed: true`; a visitor's `corpus_search` finds it by a CJK term; after delete it is gone |
| S3 | Event stream | That note's `corpus.note.changed` is in the event stream, fanned out to `corpus.index`, job completed |
| S4 | Periodic jobs | The panel lists every periodic job with a last run after the upgrade; "Run now" moves one |
| S5 | Webhook | An endpoint pointed at standmeet.com's `/api/corpus-hook` receives "Send test" with a signature the receiver accepts |
| S6 | Embed update hook | Editing a note inside an embed's code refreshes standmeet.com within 60 s |
| S7 | Owner mail | Approving an access request shows "sent", and the mail arrives in the real inbox |
| S8 | Booking | A coded visitor books a real calendar slot; the owner's "new booking" mail arrives; cancelling removes the event |
| S9 | Codeless homepage | With no public provider, asking on the homepage hands off to `/gate` with the question |
| S10 | Job fetch | `jobs.fetch_new` answers rows, or a receipt that `jobs.fetch_result` completes in the same shape |

| Command | Covers |
|---|---|
| `make lint` | secrets, env, backend (every `check-*.sh` gate, including the 7 of this plan), no-mock, app, sdk, e2e, im-bridge, verify-items |
| `make backend-test` | Go tests (the existing files plus the new UTs) |
| `make test-unit` | frontend and SDK unit tests |
| `make im-bridge-test` | im-bridge |
| `make stack-test` | whole-stack tests |
| `make dsh-plugin-test` | every block installed into a real dsh and run |
| `make test-fresh` | the full e2e suite from an empty volume, proving `schema.sql` and the migrations agree |
| the evals (`make eval-blocks`, `make eval-owner-mcp`, `make eval-ghost`, `make eval-summary`, … — every `eval-` target in the Makefile except the interactive `eval-ask`) | evaluations on the real agent loop |

Gate: all of the above green in one pass. A failure is read from its logs and its mechanism found;
it is never re-run until green. Only then: merge to main, release, upgrade sijie.xyz, deploy
standmeet.com, and run the P3 standmeet.com acceptance in the real environment, recorded under
`docs/real-env-verification/`.

## Risks

- **Outbox growth.** Fanned-out events older than 7 days are pruned hourly. River prunes its own
  completed jobs. See *Storage bounds*.
- **Trigger payload drift.** The captured column list lives in one migration and in `schema.sql`.
  A spec asserts the payload shape of `corpus.note.changed`, so a schema change that drops a column
  fails loudly. The SQL copy of the path rule is held to Go by `TestSQLPathSegmentMatchesGo`.
- **Ordering.** Delivery is not strictly ordered across events. Consumers must be idempotent and
  treat events as "go re-read" signals, which is what thin events are for.
- **More than one process.** Everything above is safe with more than one backend process: the
  relay claims with `SKIP LOCKED`, River claims jobs with `SKIP LOCKED` and elects a leader for
  periodic jobs, the webhook lease is a row, and waiters wake through `pg_notify`. That removes the
  single-process assumptions for the work the bus absorbed.
- **A lost NOTIFY.** A wake-up lost during a listener reconnect costs at most one sweep interval
  (1 minute) of latency, never an event.
