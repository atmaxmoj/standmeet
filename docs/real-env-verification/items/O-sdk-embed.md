# §O — SDK / web-components embed

- **Status:** ⬜ not-run
- **Scope:** runnable-now — no external credential; needs only a **local 2nd origin**.
- **Prereqs/creds:** `[SDK-HOST]` — build `sdk/packages/embed` and serve `embed.global.js` from a **plain static server on a DIFFERENT origin** (different host:port) than the prod app, so requests cross the origin boundary for real. Drop `<standmeet-chat base-url="https://<prod-app>">` onto a **bare non-Next HTML page** (no framework, no app cookies).
- **Real service:** a real **cross-origin embed** on a bare non-Next page, replacing… nothing — this surface has **zero automated coverage** and the app does **not** dogfood it (`app/src` keeps its own `agent-turn` copy).
- **Backing e2e:** **no backing spec (gap)** — this is the point. `sdk/packages/{embed,react,core,agent-core,mcp-client}` is a shipped, customer-facing deliverable (CLAUDE.md) with no cross-origin/CORS/embed test anywhere in `e2e/test/` or `sdk/`. (`agent-core-package-invariants.spec.ts` only lint-guards bundle size + purity — not the running embed.) The nearest signing-path spec is `c3-mcp-client-stdio` (owner MCP, unrelated surface).

> **Why this is the biggest single-surface gap.** Every other item swaps a mock for a real service; here there is no CI baseline at all. The embed Web Component (`sdk/packages/embed/src/embed.ts`) calls sdk-core's `createClient` → `issueSession({ mode, code })` → `streamMessage` directly against the owner's `base-url` from a foreign origin. If the backend never sets `Access-Control-Allow-*`, **every** embed request is blocked by the browser before it reaches business logic — so the whole surface could be dead on arrival and no test would know.

## Sub-items

### O1 — `embed.global.js` on a bare non-Next page on a DIFFERENT origin ⭐
- **Steps:** serve the built `embed.global.js` from a local static host (e.g. `http://localhost:7099`) → open a plain HTML page there with `<standmeet-chat base-url="http://localhost:8000">` → the component boots, issues a session, redeems an access code, sends a message, renders a real streamed answer.
- **Expected:** cross-origin `issueSession` + SSE stream + code redemption all succeed from the foreign origin; the transcript renders a real-LLM answer (visitor Q as mono small-heading, answer as serif body, matching the design).
- **⭐ likely RED — CORS:** the backend currently emits **no `Access-Control-Allow-*` headers** (no `Access-Control-Allow` in any Go source; no CORS/OPTIONS middleware found). A browser on a second origin will fail the preflight/actual request and the embed **cannot bootstrap a session at all**. This is the highest-value finding of the item — verify: (a) the cross-origin `OPTIONS` preflight, (b) session bootstrap (`issueSession`), (c) SSE streaming across origins (event framing + `withCredentials`/token), (d) access-code redemption (`code` attribute → session `mode:'code'`), (e) a real answer rendering. **High-value Finding candidate.**
- **Backing test:** no backing spec (gap)
- **Result:** ⬜

### O2 — `@standmeet/react` in a vanilla Vite host (not Next)
- **Steps:** mount `@standmeet/react`'s provider + `use-chat-session` in a plain Vite app served from the 2nd origin → same session/stream/redeem flow.
- **Expected:** identical cross-origin behavior to O1 from the React binding; no reliance on Next-only globals or same-origin cookies.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜

### O3 — Web-Components single-`<script>` drop-in
- **Steps:** the pure single-`<script>` drop-in (`<script src=".../embed.global.js">` + `<standmeet-chat>`) on a bare page → renders and holds a full chat turn.
- **Expected:** the component registers (`standmeet-chat` custom element), renders its shell, and completes a real chat turn cross-origin.
- **Backing test:** no backing spec (gap)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-O-n`)
