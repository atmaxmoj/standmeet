# StandMeet Job Loop — the full product picture

> **Status:** In design (drafted 2026-05-20). This document pins down the design decisions that join the outbound job-search chain to the existing inbound visitor chat as one closed loop.
> **Readers:** Whoever actually writes this. It assumes you have read `CLAUDE.md` and the `job-loop-2026-05` memory.
> **How to give feedback:** Each block ends with numbered decision points (`L.1`, `L.2`, …). Reply `Lₙ: accept` or `Lₙ: change — <reason>`. Anything not mentioned counts as accepted.

---

## TL;DR — in one sentence

The owner asks in Claude Code "what new jobs are there today for [filter]"; Claude pulls the data through MCP; the owner picks two; Claude reads the corpus and writes a tailored resume **draft** for each; the owner reviews it in a staging preview and only says yes before it is sent for real; on send, an invitation is issued automatically (reusing the access_codes table), the invitation URL is encoded as a **QR printed in the top-right corner of the resume**, and Playwright MCP then fills in the form and submits it; the recruiter gets the PDF, scans the QR → `/<handle>?code=ABC` → lands straight in the existing visitor chat → the AI answers in the owner's voice → **the loop closes**.

---

## Division of state: StandMeet is the state holder, Claude is reasoning + I/O

| Task | Who | Why |
|---|---|---|
| Pull job data (HTTP / RSS / parse) | StandMeet | adapter knowledge / rate limit / User-Agent / dedup |
| 1d TTL pool (staging for fetched jobs) | StandMeet | Redis state |
| **Choose which / rank / evaluate**  | **Claude** | the owner's taste lives in the corpus |
| **Write the resume draft content**  | **Claude** | curating raw + wiki + JD is LLM work |
| Render PDF (fixed layout + QR) | StandMeet | deterministic / safe / ATS-friendly |
| Persist application + invitation | StandMeet | DB state |
| **Form-filling automation**  | **Claude + Playwright MCP** | every company's UI drifts / Playwright does not run in StandMeet |

**Decision point L.1: the split between state and reasoning follows the table above.**

---

## Deduplicating terms

- **AccessCode is invitation is "邀请码" (invitation code)**. Same `access_codes` table, same domain type. That schema was built in the first place for "the resume I send out carries a code in, to chat with the AI".
- Do not introduce parallel concepts like `ApplicationAccessCode` / `Invitation` anywhere in code or docs.
- In natural language, "邀请码" is OK, "invitation" is OK, "access code" is OK; **they all mean the same access_codes row**.

**Decision point L.2: the term is unified as AccessCode; outward-facing copy may call it "邀请码" (invitation code).**

---

## Full user journey

```
owner @ Claude Code (with standmeet MCP + playwright MCP)
   │
   │ "what new staff IC remote jobs are there today"
   ▼
[1] Claude → jobs.fetch_new(criteria?)
   │      ── StandMeet ──
   │      │ call the N registered sources (Greenhouse / Lever / Ashby / RemoteOK
   │      │ / WWR / HN Who-is-Hiring)
   │      │ take the full set → diff against job_fingerprints to dedup
   │      │ new entries go into the Redis 1d TTL pool (key: owner_id:job_cache_id)
   │      │ write fingerprint
   │      └ return N jobs (with cache_id / title / company / JD / source_kind / apply_url)
   │
   │ Claude ranks them itself, by owner.page.where.looking_for + corpus,
   │ and gives top recommendations
   ▼
[2] owner: "yes, #3 and #7, get ready to apply"
   │
   ▼
[3] Claude (for each job):
   │   - read the corpus (existing MCP: list_recent_raw / list_recent_wiki / search)
   │   - read the job JD (jobs.show(cache_id) or the cache from the previous step)
   │   - write resume_content (structured JSON, shape below)
   │   ▼
   │ Claude → resume.draft(job_cache_id, resume_content)
   │      ── StandMeet ──
   │      │ write the resume_drafts table (id, owner_id, job_cache_id, resume_content jsonb,
   │      │ created_at), 1d TTL (same lifetime as the job pool; expires and is deleted with it)
   │      │ render a **preview PDF** (the layout is real, the QR is a placeholder)
   │      └ return { draft_id, preview_pdf_url }
   │
   │ Claude gives preview_pdf_url to the owner: "take a look"
   ▼
[4] owner looks at the preview (in a browser or the Claude Code file preview, either works)
   │
   │   Not happy → "change it, focus on the GraphQL part" → back to [3], Claude
   │           refines resume_content → resume.draft(...) produces a new draft
   │           (the old draft id can be kept, or Claude discards it proactively)
   │
   │   Happy → "send it"
   ▼
[5] Claude → applications.commit(draft_id)
   │      ── StandMeet ──
   │      │ a) read content from resume_drafts; read the job snapshot from the Redis pool
   │      │ b) write an applications row (job_snapshot + resume_content both go in the table)
   │      │ c) auto-issue one AccessCode:
   │      │     label = "{title} @ {company}"
   │      │     purpose = "applied {date} via {source_kind}"
   │      │     tags = keywords in resume_content ∪ JD keywords
   │      │           (Claude passes them in the commit input)
   │      │     expires_at = now() + 180d
   │      │     max_sessions_per_member = 10
   │      │     max_turns_per_session = 50
   │      │     suggested_questions = the default four
   │      │ d) render the **final PDF**: same layout as the preview, the QR is replaced with the real code's
   │      │    deeplink → `https://<owner-domain>/<handle>?code=ABC`
   │      │    QR position: **top-right corner**
   │      │ e) delete that resume_drafts row + evict the job from the Redis pool
   │      │ f) return {
   │      │      application_id, pdf_url, apply_url,
   │      │      next_action_hint: "Next: use playwright MCP to go to
   │      │      {apply_url} and fill in the form; upload the resume {pdf_url}"
   │      │    }
   │      └
   │
   │ Claude takes the hint: starts Playwright, goes to apply_url, fills in the form + uploads
   ▼
[6] Submitted
   │
   │ ─── some time later ───
   ▼
[7] recruiter receives the PDF → scans the **top-right QR** → /<handle>?code=ABC
   │  the frontend detects ?code= → no /gate hop, issues a visitor
   │  session directly → enters chat (existing logic)
   │
   │ AI answers in the owner's voice (existing corpus + tag scope by tag intersection)
   │
   │ in /admin/codes the owner sees how many times this invitation was scanned, and who asked what
```

**Decision point L.3: the staging draft → preview → owner says yes → commit flow is mandatory; "Claude writes it and sends it straight away" is not allowed.**

**Decision point L.4: QR position = top-right corner (an earlier document wrongly said top-left; corrected).**

**Decision point L.5: a visitor who scans the QR lands on `/<handle>?code=ABC`; the frontend starts a session automatically and enters chat, with no /gate interstitial (the recruiter has already shown intent; no ceremony).**

---

## Data model

### New tables

```sql
-- registered job sources
CREATE TABLE job_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  kind          text NOT NULL,        -- greenhouse / lever / ashby / remoteok / wwr / hn_hiring
  config        jsonb NOT NULL,        -- {"company":"vercel"} / {"category":"remote-back-end-..."} / {}
  label         text NOT NULL,         -- owner-friendly: "Vercel careers"
  last_fetched_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_sources_owner ON job_sources(owner_id);

-- for cross-day dedup
CREATE TABLE job_fingerprints (
  source_id     uuid NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  external_id   text NOT NULL,        -- per-source stable id (gh.id / lever.id / hn.comment_id / wwr.guid …)
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, external_id)
);

-- intermediate drafts (the owner has not said yes to sending yet)
-- Note: drafts also have a 1d TTL and are cleared together with the Redis job pool. An alternative is
-- to put drafts in Redis too and not in PG — but PG makes it easy for admin to list "unsent drafts"
-- for the owner; if we decide not to open that admin view, we can switch to Redis.
-- Default is PG.
CREATE TABLE resume_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  job_cache_id    text NOT NULL,        -- second half of the Redis key, so commit can still look up the job snapshot
  resume_content  jsonb NOT NULL,
  preview_pdf_path text NOT NULL,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '1 day',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_resume_drafts_owner ON resume_drafts(owner_id);
CREATE INDEX idx_resume_drafts_expires ON resume_drafts(expires_at);

-- persisted application records
CREATE TABLE applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  invitation_id   uuid NOT NULL REFERENCES access_codes(id),   -- reused, not a new table
  job_snapshot    jsonb NOT NULL,        -- what the job looked like when applied (unchanged even if the source changes after commit)
  resume_content  jsonb NOT NULL,        -- structured content Claude wrote
  resume_pdf_path text NOT NULL,         -- artifact path of the final version (with the real QR)
  source_kind     text NOT NULL,
  apply_url       text,                  -- the URL Playwright goes to fill in the form
  status          text NOT NULL DEFAULT 'applied',  -- applied / interview / rejected / offered / withdrawn
  applied_at      timestamptz NOT NULL DEFAULT now(),
  last_status_at  timestamptz NOT NULL DEFAULT now(),

  -- ★ calendar placeholder (not implemented now; the calendar PR plugs in here)
  next_event_at   timestamptz,
  notes           text NOT NULL DEFAULT ''
);
CREATE INDEX idx_applications_owner ON applications(owner_id);
CREATE INDEX idx_applications_status ON applications(owner_id, status);
CREATE INDEX idx_applications_next_event ON applications(owner_id, next_event_at)
  WHERE next_event_at IS NOT NULL;
```

**Tables we do not want**:
- ~~`resumes`~~ — resume_content lives in applications; each application has its own independent content
- ~~`invitations`~~ — that is access_codes
- ~~`application_access_codes`~~ — the single applications.invitation_id field is enough

**Decision point L.6: drafts go in PG (not Redis), to make a later /admin/drafts view easy if we open one.**

**Decision point L.7: the applications table gets `next_event_at` + `notes` as a hook for later calendar integration, but this phase does not implement calendar features.**

### Redis pool

```
key:  job:{owner_id}:{job_cache_id}           value: FetchedJob JSON
                                              TTL: 86400s
```

`job_cache_id` = a short random string (so Claude does not see the source's internal id format leak in the conversation).

---

## resume_content shape

Borrowed from interviewme's STAR project design:

```json
{
  "identity": {
    "name": "Sijie Wang",
    "email": "...", "phone": "...",
    "location_line": "Markham, Ontario, Canada",
    "links": [{"label": "github", "url": "..."}, {"label": "site", "url": "..."}]
  },
  "summary": "1-2 sentence lead-in (Claude rewrites it per application to match JD tone)",
  "works": [
    {"title": "...", "company": "...", "location": "...", "period": {"start": "2023-01", "end": null},
     "bullets": ["..."] }
  ],
  "projects": [
    {"name": "Lucerna",
     "situation": "...", "task": "...", "action": "...", "result": "...",
     "supplementary": "(optional: tech stack or metric)"}
  ],
  "educations": [{"school": "...", "degree": "...", "period": {...}}],
  "skills": [{"category": "languages", "items": ["Go", "TypeScript", "Python"]}, ...]
}
```

For each JD, Claude rewrites `summary` + reorders `works.bullets` + chooses which `projects` go in + sorts the `skills` list. **The identity section barely changes** (unless the owner edits the corpus).

**Decision point L.8: resume_content uses JSON, not markdown — ATS parsing relies on the PDF text layer, and a PDF renderer that lays out from JSON produces deterministic output.**

---

## PDF rendering

- **Library**: `github.com/signintech/gopdf` (pure-Go, vector PDF, text is selectable and searchable,
  ATS can parse it; also supports unicode + TrueType embedding). The first doc draft said
  `react-pdf`, which is a JS library and does not fit a Go backend; switched to gopdf to keep a single-language stack.
- **QR**: `github.com/skip2/go-qrcode` generates a PNG byte slice server-side → embedded directly
  into the gopdf page.
- **layout**: one fixed version, **simple**. Single column, serif body (Source Serif),
  mono labels, **no icons, no sidebar, no photo**.
- **Not used**: `html2canvas` + `jspdf` (the interviewme route — produces an image-PDF,
  ATS cannot see the text); headless chromium / wkhtmltopdf (extra dependency); a React PDF
  sidecar (a Node service adds deployment complexity with no real gain).
- **QR position**: top-right corner, ~24mm × 24mm.
- **URL encoding**: `https://{owner-public-url}/{handle}?code={access_code}`

**Decision point L.9: no template selection, no LayoutConfig. One layout, one set of fonts, forever.**

---

## Frontend `?code=` landing behaviour

The `/<handle>` page (the existing PublicPage) adds `useSearchParams` to detect `?code=`:

```ts
const searchParams = useSearchParams();
const code = searchParams.get('code');

useEffect(() => {
  if (code) {
    // issue the session directly, skip /gate
    void fetch('/api/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ handle, code, visitor_name: '(from invitation)' }),
    }).then(...).then(() => navigate to chat-active state);
  }
}, [code]);
```

Do not leave `?code=` in the URL bar — once the session is up, `replaceState` erases the code (so the code does not leak when the recruiter forwards the URL to a colleague).

**Decision point L.10: once the session is up, use history.replaceState to erase `?code=`.**

---

## MCP tool surface

```
# Phase 1
jobs.register_source(kind, config, label) → source_id
jobs.list_sources()                        → [{id, kind, label, config, last_fetched_at}]
jobs.fetch_new(source_id?, since_hours?=24) → [headline row: cache_id, ttl_remaining_seconds, new]
jobs.show(job_cache_id)                    → FetchedJob (full JD)
jobs.discard(job_cache_id)                 → ok
jobs.unregister_source(source_id)          → ok

# Phase 2
resume.draft(job_cache_id, resume_content, tags_for_invitation?)
                                           → {draft_id, preview_pdf_url, ttl_remaining}
resume.update_draft(draft_id, resume_content)
                                           → {draft_id, preview_pdf_url}
resume.discard_draft(draft_id)             → ok

# Phase 3
applications.commit(draft_id)              → {
                                               application_id, pdf_url, apply_url,
                                               next_action_hint: "use playwright MCP ..."
                                             }
applications.list(status?)                 → [{id, job_snapshot.title, ...status, applied_at, next_event_at, notes}]
applications.show(id)                      → full record + invitation stats (times scanned / number of chats)
applications.update_status(id, status, next_event_at?, notes?)
                                           → ok
```

**Decision point L.11: the Playwright hand-off relies on a `next_action_hint` field embedded in the commit response; no separate tool.**

**Decision point L.14 (2026-08-20, driven out by F-E-29): `jobs.fetch_new` returns "the whole board for the pool's window",
not "the few jobs this run newly caught".** Two things are fixed along with it:

- **The list sends headline fields only** (cache_id / title / company / location / url / tags / published_at /
  ttl_remaining_seconds / new), **not body_text**. Two or three hundred real jobs a day, each body one or two thousand words —
  stuffing all of it into the receipt burns through the owner side's context; the chosen few are then read in full with `jobs.show`.
  This is also why `fetch_new` and `show` have always been listed separately in this table.
- **`new=true` means it entered the pool on this run**. So "what does today's board look like" and "what is new since last time"
  are answered by the same list, and the owner asking a second time in a day does not get an empty array.
- **Cross-source dedup also applies on the pool side** (the pool is written per source, so a duplicate physically exists twice),
  and the winner is decided by **order of entering the pool**. `/admin/listings` and this path read the same `jobsuc.ListPoolBoard`,
  so the two surfaces cannot give different boards.

---

## Applied view (/admin/applications)

A list; each row has:
- status badge (`applied` / `interview` / `rejected` / `offered` / `withdrawn`)
- "{title} @ {company}" + source kind in small text
- applied time
- **next_event_at** (if any) — the owner fills it in by hand now; the calendar fills it in automatically in future
- invitation entry link → /admin/codes to see how many times that code was scanned and what was discussed
- resume PDF download
- apply_url external link

Filters: status / source kind / date range

**Hook for future calendar integration**: every application row has `next_event_at`; when the calendar PR comes it will:
1. treat applications as one of the calendar event sources
2. the owner sees an aggregated view in admin /calendar
3. connect ICS output or Google Calendar push (to be discussed)

**Decision point L.12: no calendar this phase, but applications.list returns `next_event_at`, and the UI already shows that column (filled in by hand).**

---

## Phase split and implementation order

See tasks #80–#84.
- #80 Phase 1: jobs.* + 6 fetchers + Redis TTL pool
- #81 Phase 2: resume.* + react-pdf rendering + STAR shape
- #82 Phase 3: applications.* + auto-issue invitation + top-right QR + `/<handle>?code=` frontend logic
- #83 Phase 4: next_action_hint guides playwright (no separate tool)
- #84 Write the vision into the CLAUDE.md mirror

Dependencies: 80 → 81 → 82. 83 can be done alongside 82 (same commit response field). 84 can be done any time.

---

## Open questions (noted for now, not blocking implementation)

- **resume_content "seed"**: before the owner applies to the very first job, the corpus may have no work history (the owner has not yet fed their resume material in via raw_dump). Should there be a `resume.seed_identity()` MCP tool that lets the owner pour basic identity into the wiki in one go? Or should Claude, on the first draft, proactively ask the owner what is missing, have the owner dictate it in the conversation → Claude lands it in the corpus with the existing raw_dump. **Leaning towards the latter**; no new tool.

- **Coupling between drafts and the job pool**: the draft table's `job_cache_id` points into the Redis pool; once it expires, commit fails. Two ways to handle it:
  - (a) copy the job snapshot into the draft row as soon as the draft is created → commit uses the snapshot in the draft directly
  - (b) keep things as they are; if commit hits a Redis miss, return an error and let the owner / Claude re-fetch
  - **Leaning towards (a)** — redundant data but robust behaviour; drafts are decoupled from the job pool. **Decision point L.13: snapshot the job into the draft row when the draft is created.**

- **Reverse-tracking invitations**: the owner wants to know "has the code from my Vercel application been scanned?". /admin/codes already shows each code's member list. **Good enough**; no separate reporting.

- **Withdrawal**: the owner wants to withdraw an application (e.g. they already accepted another offer). The requirement is: (a) mark status=withdrawn (b) revoke the invitation. `applications.update_status(id, 'withdrawn')` internally cascades to `revoke code(invitation_id)`.

- **A company happens to scan the same QR twice into the same invitation**: access_codes' existing `max_sessions_per_member=10` already handles this.

---

## Out of scope (explicit boundary)

- ❌ Server-side scraping of Wellfound / LinkedIn / Indeed (anti-scraping + TOS + legal). If we ever do LinkedIn, it goes through an owner-side browser extension (the owner's own cookies, the owner's own session), not into the StandMeet server.
- ❌ Resume template selection / custom layout. One layout forever.
- ❌ Cover letter as a separate artifact. If a cover letter is needed, Claude writes it and hands it straight to Playwright to fill into the application form's textarea; StandMeet does not store cover letter files.
- ❌ A scheduled "auto daily fetch jobs for me" task. Fetch is on-demand (the owner asks in Claude); StandMeet does not stockpile.
- ❌ AI fully automatically deciding which job to apply to. The owner must look at the draft and say yes before commit.
- ❌ Email notifications / Slack notifications / multi-device push. Status changes on applications rely on the owner updating them (or the future calendar pulling them in).
