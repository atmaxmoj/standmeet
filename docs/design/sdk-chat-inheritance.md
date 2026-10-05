# The SDK is how chat is inherited

Status: APPROVED 2026-09-29 (owner: "the SDK should work like a mechanism that things inherit"). Ledger at the bottom.

## Problem

Three chat implementations exist, and each one evolves on its own:

| Copy | Where | What it has |
|---|---|---|
| App chat | `app/src/components/visitor/*`, `app/src/lib/page/use-chat.ts` | Markdown + KaTeX + Mermaid, tool cards, citations, ghost questions, per-document threads, long-paste attachments, rail, floating dock |
| `AgentWidget` | `sdk/packages/react/src/widgets/AgentWidget.tsx` | An input, an example list, plain-text answers |
| `<standmeet-chat>` | `sdk/packages/embed/src/embed.ts` | Hand-rolled DOM transcript |

A microsite (for example `/p/mattermost`, the page a recruiter opens) gets the thinnest copy.
Its agent is a text box at the bottom of the page, with no citations and no way to ask while
reading. Every app improvement since the widget was written has skipped microsites.
`ChatTranscript`'s own header records the same failure once before (#35: the floating dock had
its own crude copy). Porting features across is the thing that keeps failing; the fix is a
structure in which there is nothing to port.

## Mechanism

**Every chat surface — the app included — is a consumer of `@standmeet/sdk`.** A chat feature
is written once, in the SDK, and every surface has it on the next build.

Three layers:

1. **The server decides what a conversation holds (data inheritance).** Persona, corpus scope,
   quota, dock buttons and ghost questions come from the code's session, never from a surface.
   This already holds for dock buttons (`adoptedDockButtons`); it becomes the rule for all.
2. **The SDK renders an answer by its parts (capability inheritance).** The turn stream already
   carries typed events: text, tool calls, citations (from `tool_completed`), cards, partial.
   The SDK owns the one renderer for each part (`ChatTranscript`, `ToolCallCards`,
   `CitationsList`, `McpAppCard`, `PartialNotice`, `ChatMarkdown`). A new capability is a new
   part plus one renderer in the SDK, and it appears on every surface.
3. **A surface only picks a layout.** `<Agent layout="inline" | "rail" | "dock" />`.
   - `inline`: in the page flow (today's `AgentWidget` position).
   - `rail`: a sticky right-hand column on wide screens; it falls back to `dock` below the
     reader breakpoint (the wiki rule).
   - `dock`: the floating pill that opens a panel (`FloatingChatDock`).
   The app's `/c/<slug>` room composes the same SDK pieces with its own page chrome
   (`SessionStrip`, `VisitorNamePicker`), which stay in the app.

`AgentWidget` stays as an export (live microsites import it). It becomes `<Agent>` with
`layout="inline"` by default and a `layout` prop.

## What moves into the SDK

Moved with `git mv` and the app imports rewritten. Nothing is rewritten from scratch.

- Engine: `lib/page/use-chat.ts`, `use-chat-restore.ts`, `dialog-stream.ts`,
  `use-chat-session.ts`, `tool-call-shape.ts`, `thinking-words.ts`, `use-ghost-logger.ts`.
- Stores: `lib/visitor/session-store.ts`, `ghosts-store.ts`, `block-store.ts`,
  `dock-buttons-store.ts`, `tool-specs-store.ts`.
- Composer helpers: `ghost-text.ts`, `composer-keys.ts`, `composer-attachments.ts`.
- Views: `ChatTranscript`, `ToolCallCards`, `McpAppCard` (replaces the SDK's second copy),
  `markdown` (+ callouts, vault links, helpers, `MermaidBlock`, `TikZBlock`), `PartialNotice`,
  `ComposerAttachments`, `GhostText`, the dock panel of `FloatingChatDock`, the rail shell of
  `ReaderChatRail`.

Deleted: `AgentWidget`'s own inline engine and renderer (now `export { Agent as AgentWidget }`),
the SDK's second engine (`chat-byok.ts`, the old `use-chat-session.ts` state machine), and
`embed.ts`'s hand-rolled DOM (the custom element mounts `<Agent>` in a shadow root). Kept as public
API for authors, re-implemented on the one engine: `useChatSession` (a view of `useChat`) and
`AnswerText` (the chat's markdown renderer).

Two storage keys stay, because they hold two different facts: `standmeet:visitor-session` is the
issued session (the chat's credential, `stored-session.ts`); `standmeet-session` is the display
state (quota, label, name) the session strip and the quota lock read (`session-store.ts`).

What the old widget engine did that the app's did not, and the one engine now does for everyone:
a page's own thread kept in this browser (`persistKey`), a tier change (the visitor brings their
own key) that keeps the conversation, a saved key that can't be read failing as
`byoai_key_unreadable` instead of running on the owner's tier, and error codes carried to the
transcript (`data-error-code`) and spoken in the page's language.

## What the SDK takes from its host

The SDK imports nothing from Next:

- Language: the SDK catalogs (`sdk/packages/react/src/i18n.tsx`, 8 locales, typed so a missing key
  in any locale is a compile error) hold every key the moved views use, taken from
  `app/src/i18n/messages/*` and deleted there. The app states its locale once in the root layout
  (`<ChatLangProvider lang>`). Anywhere else the chat speaks the `lang` prop, else the language the
  page declares (`<html lang>`, followed live), else English. Never the stored `sm-lang`:
  localStorage is shared by every page on the instance, so one bilingual page's toggle put
  "向 AI 提问" on an English letter. `usePageLang` (a bilingual page's toggle) sets `<html lang>`.
- The visitor's language choice (2026-10-04): one home, the `NEXT_LOCALE` cookie the app already
  renders from (`visitor-lang.ts`). `<LangSwitch />` writes it and declares `<html lang>`;
  `usePageLang` reads it first (then the old `sm-lang`, then the browser) and follows the switch. A
  page that renders no switch is not bilingual and keeps its author's language. The app's pages
  carry the app's URL-prefixed `LocaleSwitch` (gate, wiki, writings, chat room, default home); a
  first visit follows `Accept-Language`, the same signal a bilingual page reads. Each turn sends
  `page_lang` (the page's declared language); the backend turns a known code into one instruction
  line: answer in the page's language unless the visitor writes in another.
- The reader's `?lang=` on corpus links: `reader-lang.ts` reads it from a host that provides it
  (`ReaderLangProvider`) or from the page URL. The app's own reader components keep their
  next/navigation hooks, built on the same pure helpers (`withLang`, `corpusHref`).
- The instance's origin: `setChatBaseURL` (only the embed, which runs on another origin).

## Styles

- No styles in TSX (owner rule): every chat view names semantic classes (`smc-*`, and the dock's
  `sm-floating-chat-*`) defined in `src/chat/chat.css`, with a fallback on every design token, so
  the chat looks right on a host that defines none (the embed on a third-party site has no
  Tailwind at all).
- The SDK build emits `dist/index.css` (chat.css, chat-markdown.css, tool-call-cards.css and
  KaTeX's sheet), published as `@standmeet/sdk/styles.css`. The app's `globals.css` and the builder
  template's `main.tsx` import it; the embed injects it as text into its shadow root.
- The build keeps code splitting (mermaid and sanitize-html stay lazy) and states `'use client'`
  once per output file (a Next server component renders the chat as a client component).

## Enforcement

- **Gate `check-chat-only-in-sdk.sh`** (in `make lint`): the surfaces (app, microsite template,
  embed, the SDK's other widgets) may not run a turn themselves (`VisitorTurnAgent`,
  `httpAgentTurnStreamer`, `.streamMessage(`, `streamChatMessage`). Red on the pre-change tree
  (the embed and the admin code self-test each ran their own). No exclusions.
- **Parity e2e:** the same code and the same scripted turn, asked on the app room, on a
  microsite `<Agent>` and on `<standmeet-chat>`, must render the same testids:
  `answer-body`, `citations` with a `citation-row`, the tool card, and the ghost question.
  Before the move this is RED on the microsite and the embed.

## Also in this change

- `/p/<slug>?code=CODE` redirects to `/gate` and drops the code. A recruiter who opens a
  microsite link with a code lands on the gate with an empty field. The code must be redeemed
  on arrival, like `/<handle>?code=`.
- `/p/mattermost` switches its agent to `layout="rail"`.
- Live microsites bake the SDK at build time ([[builder-image-bakes-the-sdk]]): after the
  upgrade, each live microsite is rebuilt (inert marker file) to pick up the new SDK.

## Packaging (what the acceptance run taught)

- The SDK bundles its dependencies (only React is the host's), built for the browser with the
  `worker` export condition: the chat runs in the browser and in the app's server render, and a
  dependency's browser build may touch the DOM at import (decode-named-character-reference did —
  every server-rendered page 500'd).
- mermaid is never bundled. The app serves its ESM build at `/vendor/mermaid/` (copied at build)
  and the chat loads it with a module script when an answer has a diagram. Bundled, it was ~100
  chunks every microsite build processed (builder vite step ~2s → ~40s).
- The embed is `/embed.js`, a 167-byte loader, which imports the chat as a code-split ES module
  from `/embed/` (~1 MB first load; heavy parts lazy). `/embed/*` and `/vendor/*` send CORS.
- Styles are plain CSS with semantic classes; tsup does not compile CSS modules (every
  `styles.x` read undefined). The parity spec checks a computed style, not only markup.
- The release strips `data-testid` (the SDK's tsup plugin strips JSX attributes only). A testid
  passed as an object key ships to visitors (the release gate caught `agent-widget`), and a CSS
  rule that selects `[data-testid=…]` never applies in production. Testids are JSX attributes;
  styles select classes.

## Found on sijie.xyz and fixed (smokes of v0.1.97–v0.1.100)

Each has an e2e in `agent-inherits-app-chat.spec.ts`, seen red on the old code.

- The rail and the dock did not follow the conversation (their own scroll box stayed put).
  `usePinToBottom` is the one implementation; the app room uses it too.
- A page thread was keyed by the page alone: a second code on the same page showed the first
  code's conversation. The key is page + the code holding the session.
- The chat's language leaked from another page (see "What the SDK takes from its host").
- An answer was split into paragraphs on every blank line before markdown, cutting a fenced block
  with a blank line inside (a mermaid diagram between subgraphs). `splitParas` keeps fences and
  `$$` blocks whole.

## Added after release (owner, 2026-09-30)

- A diagram (mermaid, TikZ) has a button in its top-right corner that opens it large in the middle
  of the screen, growing out of its own box (FLIP, Web Animations API; skipped under reduced
  motion) on a fixed dark scrim. `ZoomableFigure`, so every surface has it.

## Known ceilings

- The dock's own fallback placeholder ("Ask a follow-up…") is English; a microsite passes its own.
- The admin code self-test keeps its compact preview UI but runs on the one engine (`useChat` with
  a caller-issued, ephemeral session).
- A page thread persisted before v0.1.100 keeps its old paragraph split in that browser (the
  stored dialog holds split paragraphs); re-splitting on load is queued.

## Later, on this mechanism

Each is one part or one verb in the SDK, inherited by every surface:
select a sentence to ask about it (answer next to it); "not in my notes — send it to the owner";
export a conversation as a brief for the hiring team.

## Ledger

Order is fixed (owner, 2026-09-29): feasibility → this doc → worktree → tests first → own
ports → implement → acceptance → merge → release with the nolint branch → deploy → smoke →
sync docs.

- [x] Feasibility (this doc)
- [x] Worktree + own dev stack (`make stack-init`: standmeet-wt-sdk-chat, app :38927)
- [x] Tests first, seen RED (dd0c26ffa): `agent-inherits-app-chat.spec.ts` — code link, parity, rail geometry, phone dock, embed
- [x] Implement: move engine + views; styles in CSS; `<Agent layout>`; embed mounts `<Agent>`; gate; `?code=` fix; 13 existing specs moved to the unified testids
- [x] Acceptance: full suite on the final code (nolint merged in). Second half 1186/1186; first
      half 913 + the 2 embed reds fixed; the new spec REPEAT=5. Reds found and fixed on the way:
      BYOK key-lost reset, quota refusal shown as "session expired", SSR 500 (DOM at import), CSS
      modules not compiled, useChatSession error, microsite build time; stale specs (paged list
      tools, owner-only golden). High-load reds rerun one by one, green.
- [x] Merge to main with the nolint branch (022803f98)
- [x] Release: v0.1.96 never built (tag pushes did not reach CircleCI — the repo had no webhook;
      re-followed, tags now trigger the release). v0.1.97 failed the release strip gate (a testid
      object key) → fixed and shipped; v0.1.98–v0.1.100 carry the smoke fixes and the diagram zoom.
- [x] Deploy: sijie.xyz upgraded to each version; the 10 live microsites rebuilt each time;
      `/p/mattermost` switched to `layout="rail"` with its copy rewritten for the panel.
- [x] Smoke with selftest codes (revoked after): code link → name → page; rail answers with a tool
      card, citations, markdown; booking landed on the real calendar and both mails in the inbox
      (booking cancelled); English rail on a browser that stored Chinese; per-code thread; diagram
      zoom animates and the whole diagram draws. Phone width not drivable in this Chrome — covered
      by the 390px e2e.
- [x] Sync docs (this ledger, CLAUDE.md, memory)
