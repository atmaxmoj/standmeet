# connector-assembly — Connectors: real OpenAPI / proxied call / CalDAV

- **Status:** 🟠 partial-verified (2026-07-23) — INGEST of a REAL 1.4MB/209-path $ref-heavy Cal.com spec works (mock gap closed): fetch-from-URL + file-upload parse it, honest validations (no-servers → base URL required; empty securitySchemes → 'no supported auth scheme'), and after adding servers+bearer it derives a 'Cal.com API v2 · TOKEN' candidate. Cal.com API key independently proven live (GET /v2/me). GAPS: F-H-2 (real specs omit securitySchemes → hard-block; want a manual-auth fallback) + 'use this spec' with a filled token did NOT persist a usable connector via the driven path (assemble UX needs a step — likely JSONata→category binding — that isn't obvious). Real proxied call through StandMeet not GUI-completed (e2e-covered: connector-happy-matrix openapi+apiKey). CalDAV (#3) still needs a Radicale server (not stood up).
- **Module:** ingest a real vendor OpenAPI spec, bind operations via JSONata, assemble a connector, and make a real proxied call — for Cal.com over `api.cal.com/v2` and for a real CalDAV server (auth, REPORT filters, RRULE/VTIMEZONE).
- **Surface:** admin/connectors (upload spec → bind → assemble → connect).
- **Real dep:** a real Cal.com account (`CALCOM_API_KEY`; spec at `api.cal.com/v2/docs`) + a self-run Radicale CalDAV server.
- **Inherits (historical finding IDs):** `F-B-1` (duplicate connector forms — owner-decision dedup).
- **Backing e2e:** `connector-spec-ingest` · `connector-assemble-from-ui` · `connector-happy-matrix` · `connector-openapi-mail`.

## Checks

### 1 — Upload a real vendor OpenAPI (Cal.com) + binding  (was §H1)
- **Steps:** admin/connectors → upload the Cal.com OpenAPI spec → candidate operations surface → bind list-slots / book via JSONata → assemble the connector.
- **Expected:** the real spec parses, real candidate operations surface, the binding assembles, and the booker calls the real `api.cal.com/v2`.
- **⚠️ mock gap:** CI only ever assembles **hand-written** specs against `external-mock`; a real vendor spec (large, `$ref`-heavy, real auth blocks) has never been ingested.
- **Backing test:** `connector-spec-ingest.spec.ts` · `connector-assemble-from-ui.spec.ts` · `connector-happy-matrix.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — assembling a live connector needs real vendor creds/OAuth (catalog + 3.1 ingest verified — F-H-1). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 2 — Real proxied call (Cal.com book via api key)  (was §H3)
- **Steps:** connect Cal.com with `CALCOM_API_KEY` → booker lists real slots + books through the real `api.cal.com/v2`.
- **Expected:** a real slot list, then a real booking that **actually appears on the Cal.com dashboard**.
- **Backing test:** `connector-happy-matrix.spec.ts` (openapi calendar + apiKey) · `connector-openapi-mail.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — assembling a live connector needs real vendor creds/OAuth (catalog + 3.1 ingest verified — F-H-1). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 3 — Real CalDAV connector (Radicale, recurring event)  (was §H6)
- **Steps:** point a CalDAV connector at the self-run Radicale (with auth) → booker lists slots + books, and drive a **recurring** event (RRULE + VTIMEZONE).
- **Expected:** real auth is enforced; REPORT filters are honored; RRULE / VTIMEZONE expand correctly (booking lands on the right expanded occurrence).
- **⚠️ mock gap:** the mock has **no auth, ignores REPORT filters, no RRULE/VTIMEZONE expansion, always-207 PROPFIND** (`caldav.go:63`).
- **Backing test:** `connector-happy-matrix.spec.ts` (protocol calendar (CalDAV))
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — assembling a live connector needs real vendor creds/OAuth (catalog + 3.1 ingest verified — F-H-1). Backing e2e green; not manually driven (no live disproof, no manual proof).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Uploaded operations render as a bindable list (not empty); the assemble/connect buttons fire; duplicate connector forms (F-B-1) don't reappear.

## Findings
(record here; also log `../findings.md`, ID `F-H-n` / `F-B-n` historical anchor)

- **H1 pass** (first pass): `validate_spec` on real Petstore OpenAPI 3.0 → ok, auth forms derived. UI path was blocked by F-B-1/2. CalDAV (Radicale) untested.

### F-H-2 — real vendor spec (Cal.com) omits servers + securitySchemes → assembly hard-blocked  (2026-07-23, live)
- **Observed:** fetched the REAL Cal.com v2 OpenAPI (`cal.com/docs/api-reference/v2/openapi.json`, 1.4MB, 209 paths, $ref-heavy) into add-connector. StandMeet parsed it without crashing (the "real vendor spec never ingested" mock gap is now exercised) and gave two honest, actionable validations: (1) "the spec defines no servers (a base URL is required)" — Cal.com's `servers:[]`; (2) after adding a base URL, "no supported authentication scheme found in this spec" — Cal.com's `components.securitySchemes` is `{}` and no `security` (their published spec documents no auth, though the API requires `Authorization: Bearer`).
- **Assessment:** both rejections are CORRECT for the spec as published. But real vendor specs commonly omit `securitySchemes` — hard-rejecting them means the owner cannot assemble a working connector from the vendor's own spec without hand-editing it. **Friction / design gap (not a crash):** consider a manual-auth fallback (let the owner pick bearer/apiKey in the UI when the spec omits `securitySchemes`) instead of a hard block.
- **Workaround (to finish the proxied-call check):** added `servers:[{url:api.cal.com}]` + a `bearerAuth` http/bearer scheme to the spec, then assembled + connected with the real `CALCOM_API_KEY`.
- **FIXED + ⑤ re-verified 2026-07-24** (commit `b956105b`): `DeriveAuthForms` now offers a manual-auth fallback (`manual:bearer|apikey|basic`) when a spec omits `securitySchemes`, and `pickScheme` builds the injector from the chosen `manual:*` synthetic scheme. Guard `authform_test` RED→GREEN. **Manual re-verify on prod GUI:** uploaded the REAL Cal.com spec (servers added, `securitySchemes:{}`) → no longer hard-rejects; the panel derives "Cal.com API v2" + shows "this spec declares no authentication — if the API needs a key, pick one below" + a `manual:bearer/apikey/basic` selector + token field. The owner can now assemble from the vendor's own spec. (Remaining, separate: checks #2 real proxied call needs the JSONata→calendar binding — the "non-obvious" assemble step — and #3 CalDAV needs a stood-up Radicale.)
