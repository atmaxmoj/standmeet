# Traffic — test plan

> Companion to `monitor.md`. Write these tests **before** the implementation.
> 69 end-to-end tests across 9 groups.

## How every test in this plan must be written

These rules are not style advice. Each one is a defect this project has already shipped.

1. **Prove RED before GREEN.** Break the implementation deliberately, run the test, confirm it
   fails, then fix. A test that has never been red carries no information.
2. **A receipt must be unique to the action under test.** `POST /api/t` returning `200` proves
   nothing — it returns `200` when it drops the event too. **Assert the row**, read back through
   `GET /api/admin/monitor/events` or `make dev-psql`.
3. **Never negate against an element that may be absent.** `expect(x).not.toContainText('a')`
   passes when `x` never rendered. Read the text into a variable, assert the variable.
4. **Do not hand the code the answer.** A test for "the reader records the entry's id" must not
   pass that id into the request it is measuring. It must create the entry, visit the public URL by
   its slug, and then assert the recorded id equals the entry's real id.
5. **Assert a correct outcome, not the absence of a crash.** "The panel rendered" is not a pass.
   The number on the panel must be the number the fixture produced.
6. **Cover success, not only failure.** Each group below must contain at least one test where the
   whole path works end to end.
7. **Click the real control.** A test that only calls the HTTP endpoint stays green when the admin
   panel has no button wired to it.
8. **One spec at a time.** `make test-only SPEC=<name>`. Suspected flake gets `REPEAT=5`, never a
   re-run for green.

Spec files live in `e2e/test/`, named `monitor-<topic>.spec.ts`. Reuse the existing fixtures:
`@/fixtures/instance`, `@/fixtures/admin`, `@/fixtures/codes`, `@/fixtures/corpus`,
`@/fixtures/visitor`, `@/fixtures/visitor-chat-loop`, `@/fixtures/mock-llm-script`,
`@/fixtures/embed-token`, `@/fixtures/microsite-rig`, `@/fixtures/navigate`,
`@/fixtures/testid-family`.

A new fixture, `@/fixtures/monitor`, provides: `postBeacon()`, `readEvents(filter)`,
`readMetrics(type, filter)`, `advanceSalt()`, `freezeClock()`.

---

## Group A — ingest and normalisation (9)

**T-A1 · a beacon post writes exactly one row**
Proves the happy path end to end. Red on: the handler validating and discarding.
Assert: `readEvents()` returns one row whose `surface` and `url_path` match what was posted.

**T-A2 · a post with no `User-Agent` header is rejected**
Red on: the header check missing. Assert: response is 4xx **and** `readEvents()` is empty. The
second half matters — a handler can reject and still write.

**T-A3 · `www.` is stripped from the referrer domain**
Post a referrer of `https://www.example.com/x`. Assert `referrer_domain` is `example.com`.

**T-A4 · a self-referral stores no referrer domain**
Post a referrer on the instance's own host. Assert `referrer_domain` is empty, not the own host.
Red on: the self-referral branch being dropped, which makes the instance its own top referrer.

**T-A5 · a path-only referrer resolves against the event's own domain**
Post `referrer: '/gate'` with `hostname` set. Assert `referrer_path` is `/gate` and
`referrer_domain` is empty (self-referral). Red on: resolving against `localhost`, which produces a
`localhost` referrer domain in production.

**T-A6 · query string is split off the path**
Post `url: '/wiki/x?lang=zh&utm_source=mail'`. Assert `url_path` is `/wiki/x` and `url_query`
holds the rest. Red on: the path key including the query, which fragments one page into many rows.

**T-A7 · UTM parameters and click IDs are extracted**
Post a URL carrying `utm_source`, `utm_medium`, `utm_campaign`, `gclid`. Assert each lands in its
own column.

**T-A8 · `src=qr` survives to the row**
Post the coded-landing URL with `?src=qr`. Assert `src` is `qr`. This is the job-loop signal from
`monitor.md` §4.3.

**T-A9 · a malformed payload is dropped without a 500**
Post a body with a missing `surface` and a non-string `url`. Assert the response is not 5xx and no
row is written. A visitor must never see an error from instrumentation.

---

## Group B — identity: viewer and visit (7)

**T-B1 · two posts from the same client share one `viewer_id`**
Red on: a random id per request, which makes every view a new person.

**T-B2 · a different user agent produces a different `viewer_id`**
Assert the two ids differ. Together with T-B1 this pins the hash to its inputs.

**T-B3 · two posts within 30 minutes share one `visit_id`**
Use `freezeClock()` to advance 10 minutes between posts.

**T-B4 · a post after 31 idle minutes opens a new `visit_id`**
Same viewer, new visit. Red on: the idle expiry missing, which merges a week into one visit and
destroys the dwell numbers.

**T-B5 · a monthly salt rotation makes the same client a new viewer**
Call `advanceSalt()`. Assert the `viewer_id` changes. This is the privacy guarantee from
`monitor.md` §8, asserted rather than assumed.

**T-B6 · a server emit lands on the same viewer as the page's beacon**
Load a coded landing page in a browser, then read events. Assert the beacon `view` row and the
server `code_landing` row carry the **same** `viewer_id` and the **same** `visit_id`.
This is the correlation claim in `monitor.md` §4; it is the one that silently breaks.

**T-B7 · an IM event with no viewer does not break an aggregate**
Emit an `im_turn` with a null `viewer_id`, then call `/stats`. Assert the call succeeds and
reports one visit and zero identified viewers. Red on: a `NOT NULL` assumption in the aggregate SQL.

---

## Group C — bots (6)

**T-C1 · a known crawler user agent is marked `is_bot`**
Post with `Googlebot`'s user agent. Assert the row exists **and** `is_bot` is true. Red on: the
row being dropped (Umami's behaviour) — our design keeps it.

**T-C2 · bot rows are excluded from `/stats` by default**
Seed 3 human views and 5 bot views. Assert `/stats` reports 3.

**T-C3 · `include_bots=true` returns them**
Same fixture, assert 8. Without T-C3, T-C2 would also pass if bots were never written.

**T-C4 · a link-preview fetch of a coded landing URL is recorded as a bot landing**
Fetch `/?code=…` with a Slack-unfurl user agent. Assert a `code_landing_bot` row exists carrying
the right `code_id`. This is the job-loop signal, and it must not be silently discarded.

**T-C5 · a bot landing does not consume the code's quota**
The critical pairing for T-C4. Assert the code's remaining sessions is unchanged after the bot
fetch. A preview bot must never burn a recruiter's invitation.

**T-C6 · a crawler fetch of `/robots.txt` records the crawler's name**
Assert `robots_fetch` with the bot name in `props`. Red on: recording the fetch but not which
crawler, which makes the panel useless.

---

## Group D — corpus drift (7)

This group encodes `monitor.md` §6. It is the group most likely to be quietly wrong.

**T-D1 · a reader view records the entry's immutable id, not its slug**
Create a wiki entry, visit its public URL by slug, assert the row's `entity_id` equals the entry's
real database id. Per rule 4 above, the test must not pass the id into the visit.

**T-D2 · renaming an entry keeps one row in the entries breakdown**
View an entry 3 times, rename its slug, view 2 more times. Assert
`/metrics?type=entity` returns **one** row with a count of 5.
Red on: grouping by `url_path`, which returns two rows of 3 and 2.

**T-D3 · reparenting an entry keeps one row**
Same as T-D2, using the reparent path that `e2e/test/corpus-reparent-path.spec.ts` exercises.

**T-D4 · promoting raw → wiki keeps the reading history continuous**
Assert the promoted entry's count includes views recorded before the promotion.

**T-D5 · deleting an entry does not delete its traffic rows**
View an entry, delete it, assert `/metrics?type=entity` still returns a row with the count.
Red on: a foreign key with `ON DELETE CASCADE`, which erases history when the owner tidies up.

**T-D6 · a deleted entry renders its snapshot title, marked deleted**
Assert the admin panel shows the title the entry had, with a `(deleted)` marker. Read the text
into a variable first — do not negate against a possibly-absent element.

**T-D7 · a live rename beats the snapshot in the panel**
View an entry, rename it, open the panel. Assert the panel shows the **new** title, not the
snapshot. This is the other half of rule 2 in §6, and it fails if the implementation reads the
snapshot first.

---

## Group E — instrumentation coverage (13)

One test per surface, each asserting the point actually fires from the real UI, not from a
hand-made request.

**T-E1 · index** — load `/`, scroll to the bottom, click a pin. Assert `view`, `scroll_depth` at
100, and `pin_click` carrying the pinned entry's `entity_id`.

**T-E2 · gate, accepted** — enter a valid code through the form. Assert `code_accepted` with the
right `code_id`.

**T-E3 · gate, rejected, without leaking the code** — enter an invalid code. Assert
`code_rejected` exists with reason `invalid`, **and** that the submitted text appears in no column
and in no `props` value.

**T-E4 · coded landing by QR** — open `/?code=…&src=qr`. Assert `qr_scan` semantics: a
`code_landing` row with `src=qr`.

**T-E5 · chat turn** — drive one full turn with the mock LLM. Assert `chat_session_start`,
`chat_turn_sent`, `chat_turn_answered` with outcome `ok`, in that order, all sharing one
`chat_session_id`.

**T-E6 · tool call denied** — deny a capability for the code, call the tool. Assert `tool_call`
with outcome `denied` and the tool's name.

**T-E7 · quota exhaustion** — exhaust a code's turn quota. Assert one `quota_hit` row naming
`turns`.

**T-E8 · reader** — open a wiki landing page. Assert `view` with `entity_kind=wiki`, plus
`read_complete` after scrolling to the end.

**T-E9 · citation click** — from a chat answer, click a source. Assert `source_click` carrying the
cited entry's `entity_id`.

**T-E10 · search without a click** — run a corpus search, click nothing. Assert one `search` row
and zero `search_result_click` rows. This is the pairing that makes the search panel meaningful.

**T-E11 · microsite** — publish a microsite, visit a page. Assert `view` with the right
`microsite_slug`.

**T-E12 · embed on a third-party origin** — load the widget from the mock external origin. Assert
`embed_view` carrying the `embed_id` **and the real parent origin**, not the instance's own host.

**T-E13 · blocked embed origin** — load the widget from an origin not on the allowlist. Assert
`embed_blocked_origin` and that no chat session was created.

---

## Group F — read model and admin panel (11)

**T-F1 · the section appears under settings**
Open the admin sidebar. Assert a `monitor` link sits inside the `settings` group, and that its
label is translated, not a raw key.

**T-F2 · summary numbers match the seeded fixture**
Seed a known set of viewers, visits and views. Assert each of the five summary numbers exactly.
Red on: a placeholder constant, which is how the dashboard sparkline shipped a fixed zigzag.

**T-F3 · bounce rate matches the two-level definition**
Seed one visit with a single view and one visit with three views. Assert bounce is 50%.
Red on: bounce computed per event instead of per visit.

**T-F4 · the compare period reports a real delta**
Seed 10 views last week and 20 this week. Assert the summary shows `+100%`.

**T-F5 · `?type=` drives every breakdown from one endpoint**
Call `/metrics` once per supported `type`. Assert each returns rows in the same shape. Red on: a
type falling through to a 400, which shows the panel as permanently empty.

**T-F6 · clicking a leaderboard row filters every other panel**
Click `Chrome` in the browser panel. Assert the country panel's numbers change and the URL query
string now carries `browser=Chrome`.

**T-F7 · the filtered view is shareable**
Copy the URL from T-F6, open it in a fresh context, assert the same filtered numbers render.

**T-F8 · `match=any` widens the result**
Two filters with `all` returns fewer rows than the same two with `any`. Assert strictly fewer.

**T-F9 · the live panel shows an event within its window**
Generate a view, assert it appears in `/active` and in the ticker. Then advance past the window
and assert it leaves.

**T-F10 · a viewer journey lists that viewer's events in order**
Assert the ordered event names for one seeded viewer.

**T-F11 · an empty instance reads as empty, not broken**
On a fresh instance, open the panel. Assert an explicit empty state, no error toast, and no raw
zero-division output such as `NaN%`.

---

## Group G — privacy and owner exclusion (6)

**T-G1 · no IP address is stored anywhere**
Post from a known IP. Dump every column and every `props` value of the row and assert the IP string
appears in none of them.

**T-G2 · the owner browsing their own public page records nothing**
Sign in as owner, open `/`, assert no row was written. Red on: the exclusion check running after
the write, or only on `/admin`.

**T-G3 · an anonymous visit to the same page does record**
The positive control for T-G2. Without it, T-G2 also passes when collection is entirely broken.

**T-G4 · turning collection off stops ingest**
Flip the setting, post a beacon, assert no row. Then flip it back and assert a row appears.

**T-G5 · a chat message body never reaches a traffic row**
Send a distinctive sentence in a chat turn. Assert that sentence appears in no traffic row.

**T-G6 · an API key or code text never reaches a traffic row**
Configure BYOAI with a recognisable key. Assert `byoai_configured` carries the provider name and
that the key string appears nowhere.

---

## Group H — failure and degradation (5)

**T-H1 · ingest failure never breaks the page**
Make the traffic write fail. Assert the public page still renders fully and the visitor sees no
error.

**T-H2 · a chat turn still completes when the emit fails**
Same fault, driven through a chat turn. Assert the answer arrives.
Traffic is instrumentation; it may never become a dependency.

**T-H3 · traffic queries are not on the shared aggregate endpoint**
Assert `/api/admin/system` issues no traffic query, and that its `dur_ms` is unchanged from the
baseline. Red on: someone adding a traffic read to the dashboard aggregate, which turns every
unrelated consumer's test red with a timeout.

**T-H4 · the migration runs against a populated volume**
Upgrade an instance that already holds corpus data. Assert the tables exist, the existing data is
intact, and the panel loads. A green run against an empty volume proves nothing about an upgrade.

**T-H5 · retention deletes only rows past the window**
Seed rows at 399 and 401 days old. Run the job. Assert the first survives and the second is gone.

---

---

## Group I — isolation (5)

The invariant from `monitor.md` §0. Without this group the isolation is a promise in a comment.

**T-I1 · no domain imports monitor**
`go-arch-lint check` passes, and no component other than the composition root lists a `monitor*`
component in `mayDependOn`. Red on: someone adding an import to a handler, which fails the build
rather than the test — which is the point.

**T-I2 · monitor owns no line of the shared schema**
Assert `backend/db/schema.sql` contains neither `visit_event` nor `visit_viewer`, and that
`backend/sqlc.yaml` has no monitor entry. Red on: a future change adding monitor to the shared
codegen, which silently rewrites nine other domains' `models.go`.

**T-I3 · a fresh volume gets the tables from the migration alone**
Bring up an empty instance, assert both tables exist. This is what T-I2 is trading against: if
the migration path is wrong, monitor's tables would only ever exist on upgraded instances.

**T-I4 · every route in the table still exists**
Walk the registered public routes; assert each pattern in `mw.Patterns()` matches one. Red on: a
route being renamed elsewhere, which leaves a rule that can never fire — and a rule that can
never fire is indistinguishable from no rule.

**T-I5 · removing the middleware removes all server-side recording**
Unmount it; assert a reader view records nothing. The positive control for the whole design: it
proves the recording really does come from one place, and that no stray call site survives in
another domain.

---

## Coverage summary

| Group | Tests | Covers |
|---|---|---|
| A · ingest and normalisation | 9 | `monitor.md` §7, and the ported normalisation |
| B · identity | 7 | §4 correlation, §8 salt rotation |
| C · bots | 6 | §3.2 `is_bot`, §4.3, §4.10 |
| D · corpus drift | 7 | §6, all four rules |
| E · instrumentation | 13 | §4.1 – §4.9 |
| F · read model and panel | 11 | §5, §10 |
| G · privacy | 6 | §8, §4.11 |
| H · failure | 5 | §7, §3.4, §12 |
| I · isolation | 5 | §0, both halves |
| **Total** | **69** | |

Every point in `monitor.md` §4 that is not named above is covered by its surface's group-E test
plus the group-A ingest tests. When a point is added to §4, decide here whether it needs its own
test or is covered by an existing one, and record the decision. An unlisted point is an untested
point.
