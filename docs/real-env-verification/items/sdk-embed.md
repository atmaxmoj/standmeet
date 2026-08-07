# sdk-embed — SDK / web-components: cross-origin embed

- **Module:** The shipped embed — the web component, the React binding, and the single-script drop-in — boots on a plain page served from a DIFFERENT origin than the instance, issues a session, redeems a code, and streams a real answer.
- **Surface:** A bare HTML page on a second origin, carrying the embed and pointed at the instance's base URL. This is the customer-facing deliverable.
- **Real dep:** A built embed bundle served by a plain static server on an origin that is not the app's. A running instance to point at.
- **Backing e2e:** `public-cors` covers the cross-origin bootstrap. The embed itself, the React binding and the drop-in → `gap`.

## Checks

### 1 — The web component boots and holds a turn, cross-origin ⭐
- **Steps:** Serve the built bundle from a second origin. Open a plain HTML page there carrying the component with the instance's base URL. Watch it boot. Redeem an access code. Send a message. Read the answer.
- **Expected:** The preflight succeeds, the session issues, the code redeems, the stream arrives, and a real answer renders. Every one of those crosses an origin boundary, and the browser blocks all of them if the instance sends no cross-origin headers.
- **Mock gap:** Nothing in CI loads the built bundle from a foreign origin. This is the largest single-surface gap in the audit — every other module swaps a mock for a real service, and here there is no baseline at all.
- **Backing test:** `public-cors.spec.ts` (headers only) · the embed end to end → `gap`

### 2 — The React binding behaves the same in a non-Next host
- **Steps:** Mount the React binding's provider and session hook in a plain Vite app on the second origin. Run the same flow.
- **Expected:** Identical behaviour to check 1. Nothing depends on a Next-only global or on a same-origin cookie.
- **Backing test:** `gap`

### 3 — The single-script drop-in registers and works
- **Steps:** Put only the one script tag and the element on a bare page. Load it. Take a full chat turn.
- **Expected:** The custom element registers, the shell renders, and the turn completes.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The widget renders on the foreign page, rather than sitting blank because the browser blocked it.
The input accepts text and a real answer streams in.
Check the browser console as well as the page — a cross-origin failure is silent in the UI and loud in the console.
