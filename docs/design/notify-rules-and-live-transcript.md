# Notification rules and the live transcript

Status: DRAFT 2026-09-30, for the owner's review. Decisions the owner makes are marked **Decide**.

## What the owner asked

2026-09-30, in the owner's words (summarised):

- "可以自定义一些事件 … 比如某个 code 有人第一次回答 … 或者某个 microsite 的数据有了新的改动，都可以作为登记事件".
- Story 3 (recruit): a recruiter uses my code and starts talking to "me". Through eiab + im-bridge I get a
  card on WhatsApp saying someone started a conversation. I tap the link and see the conversation's
  transcript **live, streaming**.

## What already exists (read from the code, 2026-09-30)

- The event bus: domains record thin facts into the `events` outbox in the fact's own transaction;
  a relay fans each event out to subscribers as River jobs (docs/design/event-bus-outbox-webhooks.md).
- Webhook endpoints subscribe by event type or glob, on the admin page `/admin/webhooks` and on the
  owner MCP (`webhooks.*`, `events.*`, `tasks.*`), shipped in v0.1.76.
- The owner's examples are already event types:
  - `conversation.started` (data: conversation_id, mode) and `code.redeemed` (data: code_id,
    member_id) — "someone started talking through a code";
  - `microsite.store.doc_inserted` (data: collection, doc_id) — "a microsite's data changed" (insert
    only; no update or delete event).
- Owner notification (`owner.notify`) is hard-wired: email only, on two types
  (`access_request.created`, `booking.created`). A role's `notify_owner` switch feeds it.
- im-bridge speaks Telegram and Discord (v0.1.104), and only in one direction: a visitor chats from
  inside the IM. It cannot send the owner a message.
- The owner reads a conversation with a plain GET (`conversations.get`, admin conversations page).
  Nothing streams to the owner; the only SSE stream is the visitor's own turn.

So the gap is not "more event types". It is four missing pieces:

1. **Filters.** A subscription says a type, never "only this code" or "only the first time".
   `conversation.started` does not even carry the code id.
2. **Channels.** A subscription can only be an HTTP webhook. Email is hard-wired to two types; IM
   is not a channel at all.
3. **Data-change coverage.** A microsite store has inserts only; updates and deletes record nothing.
4. **A live view.** No page shows a conversation as it happens.

## Mechanism

### A notification rule = event type + filter + channel

One owner-defined object, stored per owner, managed on the admin page and the owner MCP (one
registry, both faces generated from it):

```
rule {
  event_type   "conversation.started"          // or a glob: microsite.store.*
  filter       { subject: "code/<id>" | "microsite/<slug>" | any,
                 first_only: true }            // once per subject, ever
  channel      webhook(<endpoint id>) | email | im(<connection id>)
  template     the card's words (defaults per event type)
}
```

- The existing webhook subscription becomes a rule whose channel is webhook, so there is one
  concept, not two (**Decide**: migrate existing endpoints into rules, or keep endpoints as the
  channel object that rules point at — recommended, so an endpoint's secret and delivery log stay
  where they are).
- `owner.notify` becomes the default rules an owner starts with (access request → email,
  booking → email), editable instead of hard-wired.
- `first_only` is evaluated by the rule's own delivery job with a per-(rule, subject) marker row,
  claimed in the delivery's transaction — the same shape as the existing notify slot, so a retry
  never sends twice.
- Filters stay on the event's **subject** and a few declared **data keys**. An event type declares
  which data keys a filter may use; nothing else is filterable (the bus stays thin).

### Events to add

- `conversation.started` carries `code_id` (empty for codeless) so "this code" is filterable.
- `microsite.store.doc_updated` and `microsite.store.doc_deleted` beside `doc_inserted`, so "a
  microsite's data changed" is `microsite.store.*`.

### IM as a channel (im-bridge sends the owner a card)

- im-bridge gains an outbound path: the backend's rule delivery job calls the bridge's internal
  endpoint with (connection, card); the bridge posts it to the owner's chat.
- The owner links their own IM account once (the bridge already knows its bot; the owner sends the
  bot a pairing code from the admin page, and the bridge records the owner's chat id).
- **Channel order (owner, 2026-09-30: "我想至少能用discord").** The bridge is built on Vercel's
  Chat SDK (`chat` + `@chat-adapter/telegram`); `@chat-adapter/discord` exists at the same version
  (4.41.1) and renders embeds, which is the card. Discord comes first, then Telegram (already
  wired for visitor chat). WhatsApp needs the WhatsApp Business Cloud API — a Meta business
  account, a verified phone number, pre-approved templates for messages outside 24 hours — and
  waits until the owner has that account; the mechanism does not change.

### The live transcript

- A signed, expiring link (like the preview link: HMAC with the instance key, owner-only) opens a
  read-only transcript page for one conversation. It works without an admin sign-in, because it is
  opened from a phone's IM app; the signature is the credential, scoped to that one conversation,
  valid for 24 hours (**Decide** the window).
- The page streams: the backend publishes each turn's deltas for a conversation on a per-conversation
  channel (Redis pub/sub, already in the stack), and a new SSE endpoint relays them to the owner's
  page. The visitor's stream is untouched; the owner's view is a second listener.
- The page renders with the SDK's transcript views (`ChatTranscript`, citations, tool cards), so it
  is the same rendering the visitor sees.

## Acceptance: story 3 as one end-to-end test

1. Owner links an IM account (Telegram in the test rig; the bridge's test double records posts).
2. Owner creates a rule: `conversation.started`, subject `code/<RECRUIT-1>`, first_only, channel im.
3. A visitor opens `/?code=RECRUIT-1`, picks a name, asks a question.
4. The bridge's double received exactly one card naming the code and the visitor, with a link.
5. The link opens the transcript page without signing in; while the visitor asks a second question,
   the owner's page shows it and the answer streaming (text grows before the turn ends).
6. A second conversation on the same code sends no second card (first_only).
7. The link with a tampered signature, or after expiry, shows nothing of the conversation.

Each red on the code of 2026-09-30.

## Not in this change

- Stories 1 (any eiab block embedded in a microsite — a general capability, GitHub is one example)
  and 2 (collaborative writing on a microsite's store, with the agent reading that store through an
  index) get their own design documents; they share nothing with this one except the event types
  for store changes.
