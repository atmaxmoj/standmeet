# connector-assembly — Connectors: real OpenAPI / proxied call / CalDAV

- **Status:** ⬜ not started (new round)
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
- **Result:** ⬜
- **Result:** ⬜
### 2 — Real proxied call (Cal.com book via api key)  (was §H3)
- **Steps:** connect Cal.com with `CALCOM_API_KEY` → booker lists real slots + books through the real `api.cal.com/v2`.
- **Expected:** a real slot list, then a real booking that **actually appears on the Cal.com dashboard**.
- **Backing test:** `connector-happy-matrix.spec.ts` (openapi calendar + apiKey) · `connector-openapi-mail.spec.ts`
- **Result:** ⬜
### 3 — Real CalDAV connector (Radicale, recurring event)  (was §H6)
- **Steps:** point a CalDAV connector at the self-run Radicale (with auth) → booker lists slots + books, and drive a **recurring** event (RRULE + VTIMEZONE).
- **Expected:** real auth is enforced; REPORT filters are honored; RRULE / VTIMEZONE expand correctly (booking lands on the right expanded occurrence).
- **⚠️ mock gap:** the mock has **no auth, ignores REPORT filters, no RRULE/VTIMEZONE expansion, always-207 PROPFIND** (`caldav.go:63`).
- **Backing test:** `connector-happy-matrix.spec.ts` (protocol calendar (CalDAV))
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Uploaded operations render as a bindable list (not empty); the assemble/connect buttons fire; duplicate connector forms (F-B-1) don't reappear.

## Findings
(record here; also log `../findings.md`, ID `F-H-n` / `F-B-n` historical anchor)

- **H1 pass** (first pass): `validate_spec` on real Petstore OpenAPI 3.0 → ok, auth forms derived. UI path was blocked by F-B-1/2. CalDAV (Radicale) untested.
