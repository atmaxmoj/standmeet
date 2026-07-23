# booking-slots — Booking: list_slots vs real freeBusy

- **Status:** 🟡 🟠 partial (2026-07-23): calendar CONNECTED (real OAuth, active) — enabler done. Visitor booking correctly ACL-gated: a public-role code (FA5-001) gets NO booking tool (agent: 'no calendar/booking tool hooked up') — the per-role capability gate works. Full booking (slots/book/email) needs a role granting the booking capability (public grants 0 skills); calendar+mail are connected + ready. Was blocked-by-setup — needs a connected calendar (not connected on this instance); e2e covers slot logic
- **Module:** the booker returns only genuinely-free slots inside the requested window, filtered against the account's real calendar busy/free.
- **Surface:** visitor chat (slot listing) / booker tool.
- **Real dep:** real `www.googleapis.com/calendar/v3` freeBusy on a connected account (see [[calendar-connect]]).
- **Backing e2e:** `visitor-chat-list-slots`.

## Checks

### 1 — `list_slots` vs real freeBusy  (was §B2)
- **Steps:** visitor chat asks for slots / call the booker directly with a real `timeMin/timeMax` window; compare against the account's real Google Calendar busy/free.
- **Expected:** only real free slots returned, and the **window is really filtered**.
- **⚠️ mock gap:** the mock ignores `timeMin/timeMax` (`gcal.go:390`) → window filtering never truly verified.
- **Backing test:** `visitor-chat-list-slots.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — needs a connected calendar. Backing e2e green; not manually driven (no live disproof, no manual proof).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The slot list renders real times (not empty, not garbled); weekend/policy-excluded windows don't appear.

## Findings
(record here; also log `../findings.md`, ID `F-B-n` historical anchor)

### ~~F-B-3~~ NOT A BUG — booking is role-gated (calendar.book must be in role.AllowedTools)  (2026-07-23, live)
- **Symptom (verified via session tool_specs, not the LLM's word):** with `connector.google-calendar` connected+active (real OAuth done), `calendar.book` capability registered + **enabled:true**, and a code carrying an explicit bookings quota (BOOK-TEST, bookings=5), a coded visitor session's `tool_specs` contain ONLY `ask_visitor, summarize_conversation, corpus_*` — **NO `calendar_book` / `calendar_list_slots`**, and capabilities are just `ask_visitor, summarize_conversation, corpus.retrieval`. Two codes tested (FA5-001 blank-quota, BOOK-TEST quota=5) — both lack the booker tools. The agent correctly says "no calendar/booking tool hooked up" (not an F-A-4 hallucination — the tools are genuinely absent from the assembled session).
- **So:** connecting Google Calendar has NO visitor-facing effect — the booker never assembles into a visitor session even with every prerequisite met (connector connected, cap enabled, quota set). The whole booking feature (slots/book/email) is dead for visitors on prod.
- **RESOLUTION (read capreg_booker.go):** `BookerSkillName = "calendar.book"` — the booker unlocks ONLY when the session role's `AllowedTools` union contains `"calendar.book"`. `public`/`default` roles don't grant it → booker correctly hidden. So this is **correct ACL gating, NOT a bug** (avoided a false finding — the connect+enabled state is necessary but not sufficient; the code's ROLE must also grant calendar.book). Verify path: give a role calendar.book in its skills/tools grant, issue a code with it → visitor gets calendar_book/list_slots.
- **Status:** ✅ not-a-bug; booking positive-path verification pending a role that grants calendar.book (in progress).

### Follow-up (2026-07-23) — how does the owner GRANT calendar.book via the GUI?
The role editor (/admin/roles) exposes: prompt, corpus URIs (wiki/output/writing/subjectivity), a
ghost-steer-only toggle, weight/terminal — but no visible skills/tools grant to add `calendar.book`
to a role's AllowedTools (public shows "SKILLS 0 · MCP 0" with no add-affordance I could find). Either
the skills-grant UI didn't expand for me, or there's no GUI path to grant booking to a code — which
would make the whole booking feature unreachable for owners through the admin UI. **To confirm next:
inspect an existing role that grants calendar.book (if any), or the role-edit skills section.**
