# connector-assembly — Connectors: real OpenAPI / proxied call / CalDAV

- **Module:** Ingest a real vendor OpenAPI document, bind its operations onto the product's own categories, assemble a connector, and make a real proxied call through it. The same surface also assembles a protocol connector against a real CalDAV server.
- **Surface:** `/admin/connectors` — upload a spec, bind, assemble, connect.
- **Real dep:** A real vendor account with an API key and a published spec. For the CalDAV leg, a self-run CalDAV server with auth.
- **Backing e2e:** `connector-spec-ingest` · `connector-assemble-from-ui` · `connector-happy-matrix` · `connector-openapi-mail`.

## Checks

### 1 — A real vendor spec parses and yields real candidates ⭐
- **Steps:** Fetch a real vendor spec by URL, then upload the same file. Read what the panel derived: the operations it offers, the auth forms, and the validation messages.
- **Expected:** A large, `$ref`-heavy document parses without a crash. Real candidate operations surface. Any refusal names what the spec is missing, in terms the owner can fix.
- **Mock gap:** CI only assembles hand-written specs against the mock. A real vendor document — large, deeply referenced, with real or absent auth blocks — is only ever ingested by hand.
- **Backing test:** `connector-spec-ingest.spec.ts`

### 2 — A spec missing auth can still be assembled
- **Steps:** Use a spec that declares no authentication scheme, which is common. Supply the missing base URL. Look for a way to say what auth the API really needs.
- **Expected:** The panel offers a manual choice of scheme and a place for the token, rather than refusing outright. An owner must not have to hand-edit a vendor's file to use it.
- **Backing test:** `connector-spec-ingest.spec.ts`

### 3 — Assembling produces a connector that can actually be called ⭐
- **Steps:** From the derived candidate, with a real token filled in, complete the assemble flow. Then find the connector in the list, connect it, and dispatch one real call through it.
- **Expected:** A usable connector exists at the end, and the call reaches the vendor. Every step that is required is visible — a binding the flow needs but does not ask for is the failure this check exists to catch, because everything before it gives encouraging feedback.
- **Backing test:** `connector-assemble-from-ui.spec.ts` · the real end-to-end path → `gap`

### 4 — A proxied call reaches the vendor and its effect is visible there
- **Steps:** Through the assembled connector, list something and then create something. Open the vendor's own dashboard and look for what you created.
- **Expected:** The list holds real data and the created object exists on the vendor's side. The connector's own success reply is not the evidence.
- **Backing test:** `connector-happy-matrix.spec.ts` · `connector-openapi-mail.spec.ts`

### 5 — A real CalDAV server's rules are honoured
- **Steps:** Point a protocol connector at a real CalDAV server that requires auth. List slots and book. Then drive a recurring event with a repeat rule and a timezone block.
- **Expected:** Auth is enforced. Report filters are honoured. The repeat rule and timezone expand correctly, so a booking lands on the right occurrence.
- **Mock gap:** The mock has no auth, ignores report filters, expands no repeat rules, and answers every property request identically. Every behaviour this check is about is absent from it.
- **Backing test:** `connector-happy-matrix.spec.ts` (against the mock)

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Uploaded operations render as a bindable list rather than an empty panel.
The assemble and connect buttons fire, and what they claim can be checked somewhere other than the button itself.
Only one form exists for adding a connector — a second one that does the same job differently is how two paths drift.
Watch for a flow that validates generously at every step and produces nothing at the end; encouraging feedback all the way to an empty result is worse than an early refusal.
