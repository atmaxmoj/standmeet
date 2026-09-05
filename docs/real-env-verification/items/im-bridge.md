# im-bridge — a visitor chats with the owner's AI from inside an IM

- **Module:** The IM bridge (`im-bridge/`). Someone holding an access code sends a direct message to the owner's bot on a chat platform, and talks to the owner's AI there. The code is unchanged by this — same grant, same role, same quotas, same transcript; only where the reader sits differs.
- **Surface:** A direct-message thread on a real chat platform, plus `/admin/conversations` and `/admin/codes` on the owner's side.
- **Real dep:** A real chat platform account and a real bot, real corpus, and a real model. The bridge's own logic is fully covered by unit tests against a stand-in adapter — what those cannot cover is the platform: message length caps, rate limits, markdown dialects, and whether a DM even reaches the handler.
- **Backing e2e:** `im-bridge` unit suite (`make im-bridge-test`) — 34 tests over the code-recognition, conversation, chunking, config and wiring layers.

> **Configuration is owner-facing, not environment-facing.** The bot token is a credential like any other connector's — it belongs in `/admin/connectors`, encrypted in `owner_connectors`, not in `.env`. The compose service therefore carries only wiring (the backend address and the visitor entry point) and the bridge asks the instance which token to use, the same shape as the builder polling `/internal/builds/claim`.
>
> **Not built yet:** the Telegram connector entry in the admin UI and the `/internal/im/config` route behind it. The bridge already speaks that contract and waits gracefully until it answers, so this is a defined seam rather than an open question. It is not a ten-minute addition: every connector today has a *backend* consumer (smtp sends, calendar books), and a credential consumed only by a sidecar is a shape the connector axis does not have yet. Deciding it properly means reading the category-contract and manifest invariants, not guessing at them.

## Checks

### 1 — A code sent as a DM opens a session ⭐
- **Steps:** From a second account, DM the bot the access code (`/start LABEL-123` on Telegram, or just the code). Read the reply.
- **Expected:** The bot answers that you're in and invites a question. The session appears under that code in `/admin/conversations`, attributed to the platform display name.
- **Mock gap:** the stand-in adapter accepts any text and never rate-limits. It cannot show whether the platform delivered the DM to the handler at all — on Telegram a bot with privacy mode on, or on Discord a bot without the message-content intent, receives **nothing** and looks identical to a bridge that is simply not running.
- **Backing test:** unit suite (logic only)

### 2 — A question in the same message as the code is not swallowed ⭐
- **Steps:** DM `LABEL-123 what do you work on?` as the very first message.
- **Expected:** The session opens **and** the question is answered. The person does not have to retype what they just sent.
- **Note:** this is the check that distinguishes a bridge someone actually used from one that only ever saw `/start`. People paste a code and keep typing.
- **Backing test:** unit suite

### 3 — Everything the code carries carries here too
- **Steps:** On a code with `max_turns_per_session: 1`, ask twice. Then revoke the code mid-conversation and ask again. Then use a code that is full on `max_members`.
- **Expected:** Each behaves exactly as it does in web chat with the same code, and **the sentence the visitor reads is the same sentence**. A revoked code drops the bridge's session so the next message starts over rather than hitting the same wall forever.
- **Write it against web chat as the oracle**, not against fresh expectations: the assertion is "the IM does what the same code does in chat", so a change to code semantics moves both and cannot drift into an IM-only branch.
- **Backing test:** unit suite covers the branch logic; the sentences come from the backend, so only a real run proves they arrive intact.

### 4 — The bot does not answer itself, or another bot
- **Steps:** Have the bot's own reply echo back (most platforms do). Then have a second bot DM it.
- **Expected:** Silence in both cases.
- **Note:** the cost of getting this wrong is not a wrong answer, it is an unbounded loop that spends the owner's inference budget and burns the code's turn quota. Two bots left talking will run until a rate limit stops them.
- **Backing test:** unit suite

### 5 — A long answer survives the platform
- **Steps:** Ask something the corpus answers at length (the ones that produce 2000+ characters in web chat).
- **Expected:** The reader gets the whole answer, or a deliberate split — not a silent truncation and not a platform error.
- **Note:** **the stand-in cannot express this at all** — it accepts any length happily. Telegram caps a message at 4096 characters and Discord at 2000, and going over is a *rejected send*, not a truncation: the reader gets nothing while the bridge looks fine. Writing this item is what surfaced it; the bridge now splits on paragraph/sentence boundaries under a 1900-character budget (the tighter platform, with margin). What a real run still decides is whether 1900 is right for each platform and whether several messages in a row trip a rate limit.
- **Backing test:** `chunk.test.ts` + the wiring suite (a long answer goes out as several messages, each within budget)

### 6 — Markdown arrives as formatting, not as syntax
- **Steps:** Ask something whose answer contains bold, a list, and a link.
- **Expected:** It renders. If the platform's dialect differs, the bridge converts — the reader must not see `**stars**` or a raw URL where a link belongs.
- **Note:** same family as F-P-1 on microsites: our answers carry markdown, and every surface has to decide what to do with it. The bridge posts `{ markdown }` rather than a bare string — the SDK's docs are explicit that a bare string is sent "without any formatting conversion", so the first version of this bridge would have shown readers `**stars**`. Writing this item is what caught it. The SDK then renders per platform (Slack's `markdown_text`, HTML for Teams, and so on).
- **Backing test:** the wiring suite asserts the bridge posts through the markdown path; **which dialect each platform actually produces is only visible on a real run**.

### 7 — Two people on one code do not see each other
- **Steps:** From two accounts, DM the same code, then ask different questions.
- **Expected:** Two members on that code, two transcripts, and neither sees the other's messages.
- **Backing test:** unit suite (session keyed per platform user id)

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

There is no UI here beyond the words the bot sends, so read those as someone who has only them.
Does the first reply say what to do next, or just that something was wrong?
When a code is refused, does the reader learn whether to re-paste it or to ask for a new one?
Is there anywhere in the owner's panel that says this bridge exists, and that a code can be used from a chat app? If not, the capability is real and undiscoverable — the same gap the visitor MCP has.
