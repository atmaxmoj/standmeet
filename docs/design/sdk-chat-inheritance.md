# The SDK is how chat is inherited

Status: APPROVED 2026-09-29 (owner: "sdk要像一个机制能继承过来"). Ledger at the bottom.

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

Deleted: `AgentWidget`'s `InlineAgent` / `AnswerText` path and the SDK's
`use-chat-session.ts`; `embed.ts`'s DOM rendering (the custom element mounts `<Agent>`).

The SDK's session storage key (`standmeet:visitor-session`) and the app's
(`standmeet-session`) become one store with one key; the reader migrates the old key once.

## What the SDK takes from its host

Injected through `StandMeetProvider`, so the SDK imports nothing from Next:

- `t` / locale: the SDK catalogs (`sdk/packages/react/src/i18n.ts`, 8 locales) receive every
  key the moved views use, copied from `app/src/i18n/messages/*`. The app passes its locale.
- `hrefs`: `citation(c)` and `corpusLink(path)`. The app passes its locale-in-URL routing; a
  microsite on the same origin uses the default (`/wiki/<path>`, `/output/<path>`).
- `Link`: an anchor component; default `<a>`.

## Styles

- The SDK build emits `dist/styles.css` (CSS modules via esbuild `local-css`, plus KaTeX).
  The app's layout and the builder template's `main.tsx` import `@standmeet/sdk/styles.css`.
- Tailwind classes inside SDK views are generated only if the host scans the SDK:
  the builder already has `@source "../node_modules/@standmeet/sdk"`; the app's `globals.css`
  gets the same `@source`. A missing `@source` produces zero CSS and no error
  ([[computed-class-generates-nothing]]), so a test checks a computed style, not a class name.

## Enforcement

- **Gate `check-chat-only-in-sdk.sh`:** outside `sdk/packages/react/`, no file imports the turn
  streamer (`httpAgentTurnStreamer`, `VisitorTurnAgent`) or renders a transcript. No exclusions.
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

## Later, on this mechanism

Each is one part or one verb in the SDK, inherited by every surface:
select a sentence to ask about it (answer next to it); "not in my notes — send it to the owner";
export a conversation as a brief for the hiring team.

## Ledger

Order is fixed (owner, 2026-09-29): feasibility → this doc → worktree → tests first → own
ports → implement → acceptance → merge → release with the nolint branch → deploy → smoke →
sync docs.

- [x] Feasibility (this doc)
- [ ] Worktree + own dev stack (`make stack-init`)
- [ ] Tests first, seen RED: parity spec; `/p/<slug>?code=` spec; rail layout geometry spec
- [ ] Implement: move engine + views; provider adapters; styles; `<Agent layout>`; embed mounts `<Agent>`; gate; `?code=` fix
- [ ] Acceptance: new specs green, REPEAT=5; every existing chat / agent-widget / embed spec green; `make lint`
- [ ] Merge to main (with the nolint branch)
- [ ] Release, upgrade sijie.xyz, rebuild live microsites
- [ ] Smoke on sijie.xyz with a selftest code: `/p/mattermost` rail answers with citations
- [ ] Sync docs (this ledger, CLAUDE.md surfaces, memory)
