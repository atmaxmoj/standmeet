# assistant.cue — the cue card is made on the server

Status: built 2026-10-20. Source spec: the owner's "StandMeet 服务端出卡" (2026-10-20).
Owner's words: "mcp接口也是，暴露出来，让facade可以agent自己接管".

## Decision

- StandMeet makes the screen assistant's cue card. The server holds the one copy of the
  mechanism: role scope, retrieval, context, prompt, model call.
- The desktop app (Screen Assistant, a Cheating Daddy fork) is a facade. It captures audio, runs
  Whisper locally, calls `assistant.cue`, and shows the card.
- Any other driver (a mock-interview agent) calls the same tools. It gets the same card.

## Tools (owner MCP, `assistant.bundle`, owner-only)

| Tool | Class | What it does |
|---|---|---|
| `assistant.prepare` | read | Loads the role's notes. Returns `notes` (count), `hint` (names for a speech recognizer's prompt), `rounds`, `role`. |
| `assistant.context` | read | Returns the system prompt `assistant.cue` would send, with `sources`, `matrix`, `stack_named`. It calls no model. It writes nothing. An agent with its own model uses it. |
| `assistant.cue` | write | Writes the card on the owner's model. It streams the card into the feed under `feed_id`. It returns `card`, `feed_id`, `model`; with `debug`, also the prompt. |
| `assistant.push` / `assistant.read` | write / read | The feed, unchanged. |

Inputs of `assistant.context` and `assistant.cue`:

- `question` (required): the other side's line, verbatim.
- `role_id`: a role id or name. Absent: every wiki note.
- `round`: one of `general recruiter behavioural manager technical design executive mentor`.
  Absent: `general`.
- `call_id`: one id per interview. The card sees the call so far (the last 20 messages). A line
  that names an applied job's company locks the call onto that job's brief.
- `user_context`: extra words from the owner.
- `id` (`assistant.cue` only): the feed event id. Absent: a new id.

Errors the caller sees as text: `no such role`, `the role's scope holds no notes`,
`no such round`, `question is required`, `the model call failed: <upstream>`.

## Mechanism

Code: `backend/internal/owner/jobs/cues/` (the mechanism) and `backend/cmd/server/port/`
`screen_assistant.go`, `cue_model.go` (the ports).

1. The role's `corpus_uris` are the ceiling. The notes are read genre by genre (wiki, output,
   subjectivity) in `corpus.list` order. A note is kept only when
   `access.MatchesAnyCorpusGlob` admits its `genre://path`.
2. The text, the BM25 index, the context and the prompt are a line-for-line port of the app's
   `src/utils/standmeet.js` and `prompts.js`. JavaScript semantics are kept: `\s` is Unicode
   whitespace, `trim()` is JavaScript's, `slice()` counts UTF-16 units, ties keep index order.
3. The index is cached per owner, scope and role description. It is rebuilt when
   `Corpus.Version` changes (note count + newest `updated_at`, one query per question).
4. The phone screen: the subjectivity note titled "Phone screen" and every applied job with a
   brief are read for each question.
5. The model: the role's provider, else the owner's default. On DeepSeek the card runs
   `deepseek-flash` with thinking off, `max_tokens` 800. Usage is billed as `screen_assistant`.
6. The card streams into the feed (one push per 300 ms, the final text last), then goes onto the
   call's history.
7. The rewrite (`cues/rewrite.go`) runs first, by default (owner, 2026-10-21). The model turns the
   line as heard into the line as meant: fillers, stutters and false starts out, a mis-heard
   owner name restored. Code refuses a rewrite that adds a name nothing heard sounds like, a new
   number, or more than 3 words. Any failure keeps the line as heard. The card model sees both
   lines. A caller with a clean line passes `rewrite: false`.

## Acceptance

- `e2e/test/assistant-cue.spec.ts`: the card comes from the owner's model and reaches the feed and
  the page; the scope is a ceiling; the matrix turns on for a named technology; a call keeps its
  conversation; the Mentor round never sees a `fact` note; errors say what is wrong.
- The fork's `npm run eval:parity`: for every role, round and eval question, the app's system
  prompt and `assistant.context`'s are byte-identical on the live corpus.
- The fork's `npm run eval`: the card quality gate, now through `assistant.cue`.

## Differences from the source spec

- The spec described the app at commit `6319c8f`. The port is of the app as shipped (rounds,
  note kinds, closing rules, Context section, the Whisper hint).
- `round`, `call_id` and `user_context` are added: the app's card depended on them.
- The card streams into the feed. The spec allowed a non-streamed v1; a live card needs its first
  line in under a second.
- `assistant.context` is added: an agent that runs its own model takes the prompt over.
