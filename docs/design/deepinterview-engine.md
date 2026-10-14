# DeepInterview engine / driver split — plan (2026-10-13)

Source: owner's spec "DeepInterview 引擎/交互剥离 Spec v0.1" + test plan (TC-01…TC-41), pasted
2026-10-13. This file is the plan; the spec text is the owner's.

## What exists today (DeepInterview, `~/Develop/projects/DeepInterview`, branch `standmeet`)

- Prep: a LangGraph (`apps/agent/.../prep/`) turns CV + JD into a `QuestionPlan` (~15 min,
  sections, 1–3 rubric items per question). The count is whatever the LLM returns.
- Per turn: the **LiveKit voice agent's LLM** decides follow-ups and **phrases every question
  itself** (`live/interviewer.py`, tool calls over `live/state.py`). This breaks §7.1: today the
  driver *is* the brain.
- `live/state.py` (cursor, answers, transcript) is already LiveKit-free.
- Scoring: per-question 0–5 against the rubric, averaged; report with narrative + coverage.
  Six-dimension evaluation (grounding/attribution/…) does not exist; StandMeet's eval-harness
  has the 2026-09-28 failure cases (`interview_integrity_live_test.go`, persona theo-marsh).
- Storage: Supabase is not configured, so sessions live in process memory and vanish on restart.
  §6 `state` + driver hand-off needs durable sessions.
- LLM adapter: `complete_text` / `complete_json` only, no history, no tools.

## Decisions taken in this plan (reversible)

1. **The engine lives in DeepInterview's agent-api** (Python), as the §6 HTTP API. StandMeet
   stays the state holder of jobs: it builds the packet and receives the report.
2. **Durable sessions**: a SQLite store (one file, volume-mounted) behind the existing repository
   interface. Supabase stays optional.
3. **Determinism for TC-01/02**: the engine records every LLM call (prompt hash → response) per
   session. TC-01/02 run on a recorded cassette: the same answers give the same moves by
   construction. A live LLM is never bit-for-bit repeatable, so equality is defined on replay;
   TC-31 measures live stability separately.
4. **Verbatim enforcement (§7.1, TC-03)**: `next()` takes the answer **and** `delivered_text`,
   the question text the driver actually showed. Anything but the exact `question_text` is
   recorded as a protocol violation on the session and in the report.
5. **The packet is self-contained**: StandMeet sends the JD, the brief (actual_work_profile), the
   assessment fields and the **texts** of the notes in corpus_scope, hashed into the fingerprint.
   The engine never calls back into StandMeet, so §7.5 is checkable against the packet alone.
6. **Report write-back** appends one markdown report to the ledger row's `interview_reports`
   (read, append, `jobs.annotate`) — no new storage (spec point B).
7. Missing packet fields (no Fermi chain: there is no `scale_estimate` field today) → degraded
   questions + a gap line in the report (§3), never invented.

## Contracts between the two repos

**Packet** (StandMeet op `jobs.interview_packet {job_seen_id}` → engine `create_session`):

```json
{ "fingerprint": "<sha256 hex of the exact UTF-8 bytes of body>",
  "body": "<a JSON document, as a string>" }
```

`body` decodes to:

```json
{ "version": 1,
  "source": { "job_seen_id": "…", "application_id": "…|null" },
  "company": "…", "title": "…", "jd_text": "…",
  "actual_work_profile": "<the row's brief, '' if none>",
  "homework": "<the row's homework, '' if none>",
  "scale_estimate": null,
  "flags": [], "deductions": [{"points": -1, "why": "…"}], "cited_notes": ["wiki/…"],
  "corpus_scope": { "uris": ["subjectivity://cv", "wiki://…"],
                    "notes": [{ "uri": "wiki://…", "title": "…", "text": "…" }] } }
```

- The fingerprint is over `body`'s bytes, so neither side has to agree on a JSON canonical form.
- `corpus_scope.notes`: the cv note, each project root note (`software/project/<name>`), and each
  cited note — the evidence the engine may ask about (§7.5). `uris` names them.
- `scale_estimate` is null until StandMeet has a field for it (§3 degraded mode).

**Report write-back**: after `finish`, the driver calls StandMeet
`jobs.add_interview_report {job_seen_id, report}` — an atomic append to the row's
`interview_reports`. The engine never calls StandMeet.

## Phases

| # | Where | What | Tests |
|---|---|---|---|
| P1 | DeepInterview | Engine core: Move/Event models (Zod + Pydantic parity), `create_session/next/state/finish` HTTP, SQLite store, intent queue from the packet, LLM cassette, verbatim check | TC-04, TC-01, TC-02, TC-03, TC-10, TC-11, TC-12 |
| P2 | StandMeet | `jobs.interview_packet(job_seen_id)` → packet + fingerprint; report append to `interview_reports` | e2e: packet content + fingerprint stable; TC-40, TC-41 |
| P3 | DeepInterview + eval | Six-dimension judges; gold answer sets from the 2026-09-28 failures; calibration | TC-20…25, TC-30, TC-31 (real LLM, answers read) |
| P4a | eval-harness | Ghost driver: the StandMeet visitor agent answers (replaces `mock-interview-live.cjs`) | TC-01 across drivers on a cassette |
| P4b | DeepInterview web | The text/voice room becomes a verbatim driver (`session.say(question_text)` instead of the LLM phrasing) | TC-02 hand-off UI ↔ eval |
| P4c | StandMeet admin | Owner-mode page: answer the engine's questions, see the weakness list | e2e |
| P4d | DeepInterview | **Any agent is a driver** (owner, 2026-10-13: "任何agent…你也能当作传话筒，让我打字面试…是谁，哪个agent，我们不感知"): the §6 operations as an MCP server. The agent shows `question_text`, takes the owner's typed answer, and calls `next(answer, delivered_text)`; the engine checks delivered_text against the question it issued | TC-01/02 with an MCP client as the driver; TC-03 by sending an altered delivered_text |

Acceptance gate (spec): TC-01/02/03 + TC-20…25 + TC-30.

## 豆包 as a driver — background only (owner: the engine does not know which agent drives)

The engine names no driver. Any agent that speaks MCP (or HTTP) and relays verbatim is one. Notes
from the research, kept for when a specific one is wired:

- 豆包 app 智能体 (incl. Coze bots published to 豆包): **shut down 2026-07-15**. Dead.
- 豆包 desktop client, custom MCP connector: exists per third-party docs, desktop only, account
  from Canada unverified. **It cannot satisfy §7.1**: the chat model rephrases at will and we never
  see what it showed, so TC-03 cannot be enforced.
- Our own driver on Doubao realtime voice (`openspeech` WebSocket): `ChatTTSText` speaks the text
  we supply — verbatim by construction; the ASR transcript is the answer. Needs a Volcengine
  (China) account with real-name verification; availability for a Canadian resident unverified.
- Our own text driver on BytePlus ModelArk (Doubao models, Canada listed): verbatim by
  construction, but then "豆包" is only the model, not the app.
