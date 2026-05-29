# Visitor-driven Google Calendar booking

## Scope

Holder of an access code chats with the AI agent → AI books a meeting on
the owner's Google Calendar after collecting required context. v1 is
**single direction** (visitor proposes time → owner gets event); a
follow-up phase may add owner-side approval-before-write.

**Gating is per-code, not per-owner.** Owner decides at code-issue time
whether each code can use `calendar.book`, the same way they decide
tag scope / max_sessions / max_turns today. No global on/off toggle —
the access code IS the permission.

`access_codes` gains:

- `granted_skills` text[] — agent skills this code carries. NULL/empty =
  no agent skills (only the corpus tools)
- `max_bookings` int NULL — quota for `calendar.book` calls via this code;
  NULL = unlimited; counter increments on successful Events.insert

The tool is exposed when ALL of these hold:

1. `session_mode='code'` (BYOAI + public visitors never reach this branch)
2. `'calendar.book' IN session.access_code.granted_skills`
3. `session.access_code.max_bookings IS NULL OR remaining > 0`
4. Owner has a GCal connection in `connected` state
   (`owner_calendar_connectors.refresh_token_enc IS NOT NULL`)

Enforced at two layers:

1. Tool-spec assembly (visitor_chat_tools.go) — tool not included in the
   LLM's tool list when ANY of the above fail, so the LLM can't try.
2. BookMeeting usecase — runtime re-check (defense in depth + atomic
   `max_bookings` decrement under DB tx).

No `owner_agent_skill_toggles` table. The AgentSkillsSection's UI toggle
becomes "default for new codes" — a checked-by-default chip in the
code-create modal. Not a runtime gate.

## Tool surface

```jsonc
{
  "name": "calendar.book",
  "description": "Book a meeting on the owner's Google Calendar. Before calling: agree with the visitor on topic, duration, and preferred times. Ask whether they want to be invited via email — if they offer one, pass it. If they don't, leave visitor_email blank and just book it on the owner's side; the visitor sees the confirmation in chat. Returns event_id on success, conflict signal otherwise.",
  "input_schema": {
    "type": "object",
    "required": ["topic", "duration_min", "preferred_times"],
    "properties": {
      "topic":           { "type": "string", "minLength": 4,
                            "description": "What the meeting is about; goes into the event title + description" },
      "duration_min":    { "type": "integer", "minimum": 15, "maximum": 240 },
      "preferred_times": {
        "type": "array",
        "items": { "type": "string", "format": "date-time" },
        "minItems": 1, "maxItems": 5,
        "description": "RFC3339 dateTime strings WITH offset (e.g. 2026-06-04T14:00:00-07:00); ordered most-preferred first"
      },
      "visitor_email":   { "type": "string", "format": "email",
                            "description": "OPTIONAL. If provided, attaches as attendee so visitor gets the calendar invite + Google Meet link" },
      "visitor_notes":   { "type": "string",
                            "description": "OPTIONAL. Anything else the visitor shared (context, agenda items); goes into description" }
    }
  }
}
```

Notes on what's NOT in the schema:

- **`visitor_name`**: backend injects from session state (set at name-picker
  modal). Agent doesn't pass it and can't override.
- **`timezone`**: the offset in `preferred_times` already pins the moment.
  Owner-policy hour bounds are evaluated by converting each candidate
  start to the owner's `timezone` column.
- **`visitor_email`** is optional precisely so the agent isn't forced to
  drag this conversation out when the visitor doesn't volunteer one.

Returns one of:

```jsonc
// happy path — visitor_email was provided
{ "event_id": "abc123",
  "html_link": "https://calendar.google.com/event?eid=…",
  "scheduled_time": "2026-06-04T14:00:00-07:00",
  "attendees": ["sijie@standmeet.com", "alice@example.com"],
  "invite_sent": true }

// happy path — visitor_email omitted (owner-only event)
{ "event_id": "abc123",
  "html_link": "…",
  "scheduled_time": "2026-06-04T14:00:00-07:00",
  "attendees": ["sijie@standmeet.com"],
  "invite_sent": false }

// conflict — owner busy at every preferred slot
{ "conflict": "all_busy",
  "busy_windows": [
    { "start": "…", "end": "…" }
  ],
  "next_free_within_policy": "2026-06-05T09:00:00-07:00"   // optional hint to AI
}

// policy denial — slot violates owner's accepting hours
{ "conflict": "policy",
  "reasons": ["outside_working_hours", "lead_time_too_short"],
  "policy": { "min_lead_hours": 72, "working_hours": "09:00-18:00 America/Los_Angeles", "allowed_weekdays": ["mon","tue","wed","thu","fri"] }
}
```

The agent must surface the `conflict` field verbatim — that's the signal
to renegotiate with the visitor in natural language.

## Owner booking policy

Owner sets in the admin connectors UI:

| Field | Default | Meaning |
|---|---|---|
| `min_lead_hours` | 24 | reject any preferred_time `< now() + min_lead_hours` |
| `allowed_weekdays` | `[mon,tue,wed,thu,fri]` | reject slots whose weekday isn't in the set; UI is a 7-checkbox grid |
| `working_hours_start` | `09:00` | reject slots whose **start** local time < this |
| `working_hours_end` | `18:00` | reject slots whose **end** local time > this |
| `timezone` | mirrored from `owners.profile_timezone` at create | the tz the hour bounds + weekdays are evaluated in |
| `buffer_min` | 15 | block slots within `buffer_min` of an existing busy window |

Persisted in `owner_booking_policy` table (1:1 with owner). Created at
the same admin moment the OAuth connection is first established; can be
edited independently.

Note: requires `owners.profile_timezone` (text, IANA tz id). If not yet
populated when policy is first created, the connectors UI prompts owner
to set it inline as part of the policy form.

## Conflict detection

Given a `preferred_times[]`, the booking usecase:

```
for each t in preferred_times:
    if not policyAllows(t, t + duration):       # working hours, weekday, lead time
        continue
    busy = freeBusy.Query(t - buffer, t + duration + buffer, calendarID)
    if busy intersects [t, t + duration]:
        record busy reason
        continue
    return scheduleAt(t)                        # commit + Events.insert

# nothing matched
if any rejected for policy:
    return {conflict: 'policy', reasons: [...], policy: ...}
return {conflict: 'all_busy', busy_windows: [...], next_free: ...}
```

`next_free_within_policy` (optional v2) walks forward from the first
preferred_time and returns the next free slot inside the owner's policy
window — useful hint for the AI to propose to the visitor instead of
just saying "all conflict, try again."

## OAuth

**Self-hosted decision: client_id + client_secret live per-owner in the
database, set by the owner in the admin connectors UI.** No env vars,
no standmeet-shared GCP project. Rationale: standmeet is open-source +
self-deployed; each owner brings their own GCP project, avoiding shared
quota and Google's verification gating on shared credentials.

Owner workflow:

1. In GCP Console: create OAuth 2.0 Client → Web app → add
   `<owner-domain>/api/admin/connectors/google-calendar/callback` as
   authorized redirect URI
2. In `/admin/connectors` → Google Calendar tile → paste client_id +
   client_secret → Save
3. Now "Authorize…" button is live → standard OAuth flow

Backend persists in `owner_calendar_connectors`:
- `client_id` text (not secret in itself, but per-owner)
- `client_secret_enc` bytea (cryptobox-encrypted)
- once tokens land: `refresh_token_enc` + `access_token` + `access_expires_at`

Lifecycle:

- Init: `POST /api/admin/connectors/google-calendar/init` → backend
  reads owner's client_id, returns auth URL
  - `https://accounts.google.com/o/oauth2/v2/auth?client_id=<owner's>&...&access_type=offline&prompt=consent&scope=https://www.googleapis.com/auth/calendar&state=<csrf>`
- Callback: `GET /api/admin/connectors/google-calendar/callback?code=&state=`
  - Validate `state` against the owner's session
  - Exchange at `https://oauth2.googleapis.com/token` (`grant_type=authorization_code`)
  - Encrypt + persist refresh_token via `internal/cryptobox`
  - Redirect to `/admin/connectors?gcal=connected`
- Refresh: when access_expires_at within 5 min of expiry, re-POST to
  `/token` with `grant_type=refresh_token` + the encrypted refresh
- Disconnect: `POST /api/admin/connectors/google-calendar/disconnect` →
  clears `refresh_token_enc`, `access_token`, `access_expires_at`,
  `connected_at` only — keeps `client_id` + `client_secret_enc` so owner
  can re-Authorize without re-pasting credentials. Optionally calls
  `https://oauth2.googleapis.com/revoke` for the token.

OAuth state CSRF:
- `/init` generates random state, stores it as a short-lived (5min)
  entry in the owner's session keyed `gcal_oauth_state`
- Auth URL includes `state=<random>` in query
- Mock OAuth echoes the state back unchanged in the callback URL
- Real Google echoes state back unchanged (per RFC 6749)
- `/callback` reads state from query, compares to session entry,
  rejects on mismatch / missing / expired

Dev/e2e: same flow but `GOOGLE_OAUTH_BASE_URL` + `GOOGLE_CALENDAR_BASE_URL`
env vars point at `job-board-mock`. Mock:

- `GET /google-oauth/auth?...` → 302 to backend callback with
  `code=mock-auth-code-<token>` and the `state` echoed back
- `POST /google-oauth/token` → returns
  `{access_token, refresh_token, expires_in: 3600, scope, token_type: 'Bearer'}`
  deterministic per request body
- `POST /google-calendar/calendars/primary/events?sendUpdates=all` →
  returns synthesized `{id, htmlLink, status: 'confirmed', start, end}`
- `POST /google-calendar/freeBusy` → returns the fixture loaded for the
  current test (e2e seeds via a `/__mock/gcal/set_busy` admin endpoint)

## Schemas

> **Note:** changes are edits to `backend/db/schema.sql` (the single
> source of truth — no migrations, rebuild via `make clean && make dev`).
> The diffs below describe what to add to existing tables and what new
> tables to define; production-style `ALTER TABLE` statements are not
> needed pre-launch.

**Add to `owners` table:**

- `profile_timezone text NOT NULL DEFAULT 'UTC'` — IANA tz used by
  booking policy + future localized features. Setup wizard prompts owner
  to set it; falls back to UTC if skipped.

**Add to `access_codes` table:**

- `granted_skills text[] NOT NULL DEFAULT '{}'` — agent skills this code carries.
- `max_bookings int` (nullable) — quota for `calendar.book`; NULL = unlimited.

**New tables:**

```sql
-- owner's Google Calendar connector — credentials (their own GCP
-- project) + active tokens. Created with credentials at first save;
-- tokens fields are NULL until the OAuth dance completes.
-- Disconnect clears only the token columns; credentials persist so
-- owner can re-Authorize in one click.
CREATE TABLE owner_calendar_connectors (
  owner_id            uuid PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
  provider            text NOT NULL DEFAULT 'google',
  client_id           text NOT NULL,
  client_secret_enc   bytea NOT NULL,          -- AES-GCM via cryptobox
  redirect_uri        text NOT NULL,           -- echoed back to Google verbatim
  -- token fields populated after OAuth callback
  refresh_token_enc   bytea,
  access_token        text,
  access_expires_at   timestamptz,
  calendar_id         text NOT NULL DEFAULT 'primary',
  scopes              text[],
  connected_at        timestamptz,
  last_refreshed_at   timestamptz,
  -- credentials lifecycle, regardless of token state
  credentials_saved_at timestamptz NOT NULL DEFAULT now()
);
-- "authorized" = refresh_token_enc IS NOT NULL.

-- owner's accepting-policy for visitor-booked meetings
CREATE TABLE owner_booking_policy (
  owner_id              uuid PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
  min_lead_hours        int  NOT NULL DEFAULT 24,
  allowed_weekdays      text[] NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri'],
  working_hours_start   time NOT NULL DEFAULT '09:00',
  working_hours_end     time NOT NULL DEFAULT '18:00',
  buffer_min            int  NOT NULL DEFAULT 15,
  timezone              text NOT NULL                         -- mirrored from owners.profile_timezone at create
);

-- track per-code calendar bookings for quota enforcement + audit.
-- Doubles as the visitor-facing "your previous bookings via this code"
-- if we add a chat surface later.
CREATE TABLE code_bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id  uuid NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  event_id        text NOT NULL,        -- Google Calendar event id
  scheduled_for   timestamptz NOT NULL,
  duration_min    int NOT NULL,
  topic           text NOT NULL,
  visitor_email   text,                 -- nullable; visitor may not have given one
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_bookings_code_idx ON code_bookings(access_code_id);
```

## Test plan (e2e)

1. **`admin-gcal-oauth-connect.spec.ts`** — owner clicks Connect in
   connectors → mock OAuth → status shows Connected with calendar id +
   scopes. Confirms token persisted.
2. **`admin-gcal-policy-edit.spec.ts`** — owner edits min_lead_hours,
   weekdays, working hours → saved + reflected on reload.
3. **`chat-book-success.spec.ts`** — code visitor, mock LLM picks
   calendar.book with required args, mock FreeBusy returns empty busy,
   mock event insert succeeds. AI confirms event_id in reply.
4. **`chat-book-conflict-busy.spec.ts`** — same as 3 but FreeBusy
   fixture says owner is busy at all preferred_times. Backend returns
   `conflict: all_busy`; AI message includes busy windows.
5. **`chat-book-conflict-policy-leadtime.spec.ts`** — visitor proposes
   time in 1 hour but owner min_lead_hours=72 → `conflict: policy`,
   reasons=[`lead_time_too_short`].
6. **`chat-book-conflict-policy-weekend.spec.ts`** — visitor proposes
   Saturday slot, policy excludes weekends → `conflict: policy`,
   reasons=[`day_not_allowed`].
7. **`chat-book-conflict-policy-hours.spec.ts`** — visitor proposes
   23:00 local slot → outside working hours → `conflict: policy`,
   reasons=[`outside_working_hours`].
8. **`chat-book-public-denied.spec.ts`** — public visitor's tool list
   excludes calendar.book.
9. **`chat-book-byoai-denied.spec.ts`** — BYOAI visitor's tool list
   excludes calendar.book.
10. **`chat-book-not-connected.spec.ts`** — owner hasn't done OAuth → tool
    not exposed even to code visitor.
11. **`chat-book-skill-not-granted.spec.ts`** — code's `granted_skills`
    does not include calendar.book → tool not exposed (covers the
    "code doesn't have permission" case).
11b. **`chat-book-quota-exhausted.spec.ts`** — `max_bookings=2`; after 2
     successful bookings, tool either disappears from spec OR returns
     `quota_exhausted` error on the 3rd call. (Pick one in implementation.)
11c. **`admin-code-create-grants-skill.spec.ts`** — owner creates new code
     in admin, checks "calendar.book" skill chip, sets max_bookings=1.
     Code row in DB has `granted_skills=['calendar.book']` and
     `max_bookings=1`.
12. **`chat-book-schema-rejects-partial.spec.ts`** — mock LLM calls
    calendar.book with missing `duration_min` → backend rejects with
    schema error; AI sees error in tool result.
13. **`admin-gcal-disconnect.spec.ts`** — owner disconnects → status
    flips, tool stops being exposed (covered indirectly by 10 but worth
    its own test for the disconnect API).
14. **`chat-book-token-refresh.spec.ts`** — access token at insert time
    is expired → backend silently refreshes → insert succeeds.

Backend Go unit tests fill in the policy boundary cases (timezone
math, weekday bitmask edge cases, lead-time fence-post) — those are
faster than e2e for purely-arithmetic checks.
