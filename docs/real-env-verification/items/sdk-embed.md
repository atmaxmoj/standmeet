# sdk-embed — SDK / web-components: cross-origin embed

- **Status:** ⬜ not started (new round)
- **Module:** the shipped embed (Web Component / React binding / single-`<script>`) boots on a bare non-Next page on a **different origin**, issues a session cross-origin, redeems a code, streams a real answer.
- **Surface:** a real cross-origin embed on a bare HTML page (the customer-facing deliverable).
- **Real dep:** build `sdk/packages/embed`, serve `embed.global.js` from a **plain static server on a DIFFERENT origin** than the prod app; `<standmeet-chat base-url="https://<prod-app>">` on a bare page.
- **Inherits (historical finding IDs):** `F-O-1` (no CORS headers → embed can't bootstrap cross-origin).
- **Backing e2e:** **no backing spec (gap)** — `sdk/packages/{embed,react,core,agent-core,mcp-client}` is shipped with no cross-origin/CORS/embed test anywhere. This is the point.

> **The biggest single-surface gap.** Every other module swaps a mock for a real service; here there is no CI baseline at all. The embed calls sdk-core's `createClient` → `issueSession` → `streamMessage` against the owner's `base-url` from a foreign origin. If the backend never sets `Access-Control-Allow-*`, **every** embed request is blocked by the browser before it reaches business logic.

## Checks

### 1 — `embed.global.js` on a bare non-Next page on a DIFFERENT origin ⭐  (was §O1)
- **Steps:** serve the built `embed.global.js` from a local static host → open a plain HTML page there with `<standmeet-chat base-url="http://localhost:8000">` → the component boots, issues a session, redeems an access code, sends a message, renders a real streamed answer.
- **Expected:** cross-origin `issueSession` + SSE stream + code redemption all succeed from the foreign origin; the transcript renders a real-LLM answer (mono Q heading, serif answer body).
- **⭐ likely RED — CORS:** the backend currently emits **no `Access-Control-Allow-*` headers** (no CORS/OPTIONS middleware). A browser on a second origin fails the preflight/actual request and the embed **cannot bootstrap a session at all**. Verify: (a) the `OPTIONS` preflight, (b) `issueSession`, (c) SSE streaming across origins, (d) code redemption, (e) a real answer rendering.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜
### 2 — `@standmeet/react` in a vanilla Vite host (not Next)  (was §O2)
- **Steps:** mount `@standmeet/react`'s provider + `use-chat-session` in a plain Vite app served from the 2nd origin → same session/stream/redeem flow.
- **Expected:** identical cross-origin behavior to check 1 from the React binding; no reliance on Next-only globals or same-origin cookies.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜
### 3 — Web-Components single-`<script>` drop-in  (was §O3)
- **Steps:** the pure single-`<script>` drop-in on a bare page → renders and holds a full chat turn.
- **Expected:** the component registers (`standmeet-chat` custom element), renders its shell, completes a real chat turn cross-origin.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The widget actually **renders cross-origin** (not blank / CORS-blocked); the input works and a real answer streams in.

## Findings
(record here; also log `../findings.md`, ID `F-O-1` historical anchor)

- **F-O-1** (first pass): no CORS headers, preflight 405 → embed can't bootstrap cross-origin (zero coverage). 🔴 — the highest-value finding of the surface.
