# Connector design (#155)

> Status: design draft. Settles "make connectors pluggable plugins" — OpenAPI-driven per-SaaS connectors
> + generic protocol connectors, meeting at two layers: the "category contract" and the "credential form".

## 0. Goal and positioning

connector = **a consumer-agnostic "external integration with credentials"** (D-8). **Not MCP, not an agent feature**;
it has several consumers: the agent, platform features, the IM gateway, job-loop.

The shape we want (the keynote): **like a WP plugin / MCP server — anyone can build one themselves, and the owner installs it into their own instance**.
Not Nango-style "built-in catalog, shipped with the code". `Hub` is the consumer-agnostic base; connectors are plugins installed on top.

Copy no ELv2 code/files (Nango is ELv2; do not touch it). What we borrow is **open standards** (OpenAPI / generic protocols),
not any vendor's code.

---

## 1. The `kind` axis: two kinds of connector

OpenAPI can only describe HTTP APIs; many integrations are not HTTP (SMTP/IMAP/CalDAV). So connectors come in two kinds:

| kind | What it is | Who implements it | Where the credential form comes from | Coverage |
|---|---|---|---|---|
| **openapi** | One SaaS vendor's HTTP API (Google Calendar / Stripe / SendGrid) | **The author provides spec + binding** (anyone can build one) | **Derived from the spec's securitySchemes** | per-SaaS |
| **protocol** | A generic standard protocol (**SMTP** / IMAP / CalDAV / LDAP) | **We ship one built-in implementation** | **That protocol's fixed fields** (hand-defined descriptor) | Long tail — one implementation covers every server speaking that protocol |

A **category** can be satisfied by either kind: `calendar` = Google (openapi) or CalDAV (protocol);
`mail` = SendGrid (openapi) or **SMTP (protocol)**. The contract abstracts the kind away; the consumer does not know whether HTTP or SMTP is underneath.

---

## 2. Three-layer structure

```
① Category contract (StandMeet owns it, fixed)   —— code consumers write against it
        booker → CalendarContract.ListBusy / CreateEvent
                        ▲ who implements it?
② Connector binding (declared by the author)      —— mapping from OpenAPI operation → contract method
        list_busy → operationId=freebusy.query + request/response field mapping
                        ▲ who executes it?
③ Generic runtime (one, covers all)                —— contract call → OpenAPI call (inject token) → normalized return
```

### ① Category contract = the existing consumer interface
Nothing new is invented — booker's existing `CalendarProxy` and mailer's existing `MailProxy` are themselves normalized interfaces:

```go
// Owned by StandMeet; consumers only know this, provider-agnostic.
type CalendarContract interface {
    ListBusy(ctx, conn, timeMin, timeMax) ([]BusyInterval, error)   // = the existing FreeBusy
    CreateEvent(ctx, conn, in CreateEventInput) (EventRef, error)
    CancelEvent(ctx, conn, eventID string) error
}
```

### ② Connector binding (declarative YAML, written by the author)
An openapi connector = **the SaaS vendor's official OpenAPI spec + this binding**. The binding is the
"common model mapping" Merge does by hand; we let the author **write it declaratively, with no code**:

```yaml
category: calendar
kind: openapi
spec: ./google-calendar.openapi.yaml          # the SaaS vendor's official spec (or a URL)
operations:
  list_busy:
    op: freebusy.query                        # the operationId in the OpenAPI spec
    request: { body: { timeMin: "{{.timeMin}}", timeMax: "{{.timeMax}}", items: [{id: primary}] } }
    response: { busy: "{{.calendars.primary.busy}}" }
  create_event:
    op: events.insert
    request: { path: {calendarId: primary}, body: {summary: "{{.title}}", start: {dateTime: "{{.start}}"}, end: {dateTime: "{{.end}}"}} }
    response: { id: "{{.id}}", url: "{{.htmlLink}}" }
```

Protocol connectors have no spec/binding — the built-in implementation satisfies the contract directly.

### ③ Generic runtime
```
booker.ListBusy
  → look up binding list_busy → resolve the OpenAPI operationId (get path+method+servers base)
  → fill the request from the request template → inject the owner's OAuth token → call the API
  → extract busy[] with the response template → normalized return
```
Switching provider = switching one spec+binding; booker does not change a single line.

### The protocol path: built-in implementation (SMTP in full)

A protocol connector **has no spec, no binding, no runtime mapping** — it is a piece of **built-in Go code that speaks the
protocol directly and implements the category contract directly**; its credential form is **hand-defined and fixed**. One implementation covers every server speaking that protocol.

```go
// SMTP: kind=protocol, fills the "mail" category, implements MailContract directly.
type SMTPConnector struct{}

func (SMTPConnector) Category() string              { return "mail" }
func (SMTPConnector) CredentialForm() CredentialForm { return smtpForm } // fixed, not derived from a spec

// Implements the category contract directly (= MailContract.Send, which mailer knows).
func (SMTPConnector) Send(ctx context.Context, conn Connection, m Mail) error {
    // Open an SMTP connection with the host/port/user/pass/tls stored in conn, and deliver m.
}

// Fixed credential form (hand-defined; compare openapi, where it is derived from securitySchemes).
var smtpForm = CredentialForm{
    AuthType: "smtp",
    Fields: []CredentialField{
        {Key: "host",     Label: "SMTP Host",    Type: "text"},
        {Key: "port",     Label: "Port",         Type: "text"},
        {Key: "username", Label: "Username",     Type: "text"},
        {Key: "password", Label: "Password",     Type: "password", Secret: true},
        {Key: "from",     Label: "From Address", Type: "text"},
        {Key: "tls",      Label: "Encryption",   Type: "select", Options: []string{"starttls", "tls", "none"}},
    },
}
```

Both kinds implement **the same** `MailContract.Send`; the only differences are "how it is implemented" + "where the form comes from":

| | **openapi** (SendGrid/Gmail API) | **protocol** (SMTP) |
|---|---|---|
| How the contract is implemented | The binding declares the op→contract mapping; the generic runtime executes HTTP | Built-in Go speaks the SMTP protocol directly |
| Credential form | Derived from the spec's `securitySchemes` | Hand-defined, fixed (`smtpForm` above) |
| Who builds it | Anyone (provides spec+binding) | We ship it built in (one implementation covers the long tail) |
| Connect action | OAuth dance | Store host/pass and it is connected; no dance |

**Shared abstraction** (regardless of kind): a Connector = `{Category() which category slot it fills + CredentialForm() the setup form
+ an implementation of that category's contract}`. The kind only decides "how the contract is implemented" and "where the form comes from"; it is **completely transparent to the consumer** —
booker gets a `CalendarContract`, mailer gets a `MailContract`, and neither knows whether HTTP or SMTP is behind it.

---

## 3. How consumers "recognize the right connector"

We surveyed three (Power Platform = manual wiring / GPT Actions·MCP = LLM semantics / Merge = normalized categories). What they share:
**nobody infers "this is a calendar" automatically from a raw OpenAPI spec — category membership is always declared**. Our two kinds of consumer take two paths:

- **agent (LLM)** → **semantic**: feed it the OpenAPI operations + descriptions directly and let it read and choose (MCP/GPT style).
  **No binding needed**; drop in a spec and the agent can use it.
- **code consumers (booker/mail/job-loop)** → **normalized category**: they write against the contract, so the connector must **declare its category +
  map operations onto the contract**. This connects to the existing `Requires:["calendar"]` + the connectorDepRegistry named provider.

→ **The cost of building a connector has two tiers**: for the agent only = drop in a spec; for booker = also write the category binding.

---

## 4. Credential recognition + form rendering

Principle (borrowed from Retool/Power Platform): **the spec gives the "auth type/flow", the owner gives the "secret", and the form is generated
automatically from the type — no hand-written form per connector**.

### Recognition
```
openapi:  operations the binding uses → their security → components.securitySchemes → map fields by type
protocol: a built-in fixed descriptor (one each for SMTP/CalDAV)
```

### Each auth type → rendered fields
| Source / type | Owner fills in | Notes |
|---|---|---|
| openapi · **oauth2** | `client_id` + `client_secret` | the token is **not** filled in — Connect runs the dance and gets it automatically; scope is multi-select; shows the per-connector redirect_uri for the owner to register |
| openapi · **apiKey** | one key field | shows where it goes (header/query + name) |
| openapi · **http basic/bearer** | user+pass / token | |
| protocol · **smtp** | `host`/`port`/`username`/`password`/`TLS`/`from` | fixed by the protocol, not from a spec |

**Both sources emit the same descriptor → one generic renderer on the frontend** (adding any connector writes no new form):

```go
type CredentialForm struct {
    AuthType    string            // "oauth2" | "api_key" | "basic" | "bearer" | "smtp" ...
    Fields      []CredentialField
    RedirectURI string            // oauth2: shown to the owner to register (per-connector)
    NeedsDance  bool              // oauth2: after the fields are filled there is a Connect button
}
type CredentialField struct {
    Key, Label, Type string       // "client_id","Client ID","password"
    Secret  bool                  // stored encrypted + masked
    Options []string              // select (scope)
    Help    string
}
```

### After submit
- **oauth2**: store client_id/secret (encrypted) → Connect → dance → store token → Connected;
- **apiKey/basic/bearer/smtp**: store the secret (encrypted) → Connected directly (no dance).

---

## 5. UML

### 5.1 Static structure (class/component)
```
                              consumers
   ┌──────────┬───────────┬──────────────┬───────────────┐
   │ booker   │ mailer    │ job-loop     │ agent (LLM)   │
   │ (code)   │ (code)    │ (code)       │               │
   └────┬─────┴─────┬─────┴──────┬───────┴──────┬────────┘
        │ requires  │ requires   │              │ reads operations
        ▼ "calendar"▼ "mail"     ▼              ▼ picks semantically (no contract)
   ┌──────────────────────────────────────┐    (consumes OpenAPI operations directly)
   │     Category Contracts (we own them)  │
   │   CalendarContract     MailContract    │
   │   ListBusy/CreateEvent  Send           │
   └───────────────────┬──────────────────┘
                       │ «implements»
                       ▼
   ┌───────────────────────────────────────────────────┐
   │  Connector   (registered in Hub; fills DepRegistry │
   │               by category)                         │
   │  kind: openapi | protocol                          │
   └──────────────┬────────────────────┬───────────────┘
             openapi                 protocol
                  │                       │
                  ▼                       ▼
   ┌───────────────────────┐   ┌────────────────────────┐
   │ Binding + OpenAPI spec │   │ Protocol impl (built-in)│
   │  op → contract mapping │   │  SMTP / CalDAV / IMAP   │
   └───────────┬───────────┘   └───────────┬────────────┘
               │ «executed by»             │
               ▼                           │
   ┌───────────────────────┐               │
   │ OpenAPI runtime        │               │
   │ HTTP + OAuth proxy     │               │
   └───────────┬───────────┘               │
               └────────────┬──────────────┘
                            ▼
                  ┌────────────────────┐
                  │ Connection          │  the owner's credentials/token (encrypted)
                  │ (credential store)  │
                  └────────────────────┘
```

### 5.2 Setup flow (the owner installs a connector in the UI)
```
owner             admin UI            backend                       SaaS
 │ paste spec/    │                  │                            │
 │ pick built-in  │                  │                            │
 │───────────────▶│  request form    │                            │
 │                │─────────────────▶│ DeriveCredentialForm        │
 │                │                  │  (securitySchemes /         │
 │                │                  │   protocol-fixed)           │
 │                │◀─────────────────│ CredentialForm descriptor   │
 │ fill client_id/│ generic renderer │                            │
 │ secret (or key)│ renders it       │                            │
 │───────────────▶│─────────────────▶│ store encrypted credentials │
 │ click Connect  │                  │  (oauth2) run dance ───────▶│ authorize
 │                │                  │◀──────── code ──────────────│
 │                │                  │  exchange token ───────────▶│ token
 │                │◀─────────────────│ store token → Connected      │
 │◀──"Connected"──│                  │                            │
```

### 5.3 Consumption flow (booker uses a calendar without knowing who is behind it)
```
booker → CalendarContract.ListBusy(conn, t0, t1)
            │
            ▼  (Connector dispatches by kind)
   openapi:  Binding.list_busy → runtime fills request + injects token → GET freebusy → extract busy[]
   protocol: CalDAV impl → REPORT free-busy → parse
            │
            ▼
   []BusyInterval  ──normalize──▶  booker (provider-agnostic)
```

---

## 6. Mapping onto existing code (nearly seamless)
- Category contract = the existing `CalendarProxy` / `MailProxy`; nothing new invented;
- `Requires:["calendar"]` + connectorDepRegistry = the existing **category binding slot**;
- the hand-built gcal → degrades into "one built-in openapi binding", deletable later;
- the hand-built mail (SMTP) → becomes a built-in SMTP connector with `kind=protocol`.

## 7. Decisions (settled)
1. **Mapping language = JSONata (only that one)**. Borrow an existing JSON transformation standard; do not invent our own syntax; do not run two.
   JSONata was chosen because it **covers both extraction and construction** (a simple path is just `foo.bar`, as simple as JMESPath), and
   **AWS Step Functions (2024) uses it for "transforming payloads between steps" = the same scenario as our "contract ↔ API shape"**;
   Node-RED has it built in; IBM made it — production-proven in the same scenario; a Go library exists. No JMESPath (AWS itself moved from
   JSONPath to JSONata). Response uses it to extract, request uses it to construct: one language, both directions.
2. **OpenAPI version**: **3.0 only** (do not try to accept every version).
3. **Multiple securitySchemes**: **the owner chooses in the UI**. The credential form is dynamic — derivation lists every scheme available
   in the spec; the UI has one selector, and the chosen one decides which set of fields renders (OAuth2 → client_id/secret+Connect; apiKey → key field).
4. **Ownership and catalog of bindings/specs**: built-ins ship with the repo; **the owner can upload a** spec+binding **in their own instance's UI** (self-hosted,
   no central review); a public catalog is left to #156.

> Note: both consumer paths (agent = reads operations semantically / code = category contract) **are already settled**, see §3; they are not decisions.
> What remains is only **scheduling**: build the code-contract path first (booker is waiting); the agent-tooling path follows in parallel.

---

## 8. Test plan (TDD red contracts, by area)

The whole UI/backend is **built from scratch**, and **users upload arbitrary specs** → the error/edge surface is huge. ~30-50 cases; write red tests by area (`test.fixme`,
aligned with the interface sketch below), and implementation turns them green area by area. **The old ~30 connector/booking e2e specs are the regression net: keep them green, do not touch them.**

### Target interface (calibrated after the audit — distinguishing "already real" from "new")
- **Route**: `/admin/connectors` (nav testid `admin-nav-connectors` already exists).
- **Already-real testids (the new contract must reuse them; do not invent other names)**: `connector-add-open` (add button) /
  `connector-card-{category}` (a card in the add catalog, e.g. calendar/email/s3) / `connector-config-save` (save) /
  `connector-field-{key}` (config field). **The mail connector has its own `mail-*` namespace** (`mail-host`/`mail-port`/
  `mail-save-credentials`/`mail-verified`/`mail-disconnect`…), not `connector-*`.
- **New testids (spec-driven flow, to be built)**: `connector-spec-input` (paste/upload spec) / `connector-spec-submit` /
  `connector-spec-error` / `connector-candidate` / `connector-scheme-select` (multiple schemes) /
  `connector-connect-button` / `connector-status` (connected|not) / `connector-disconnect-button` /
  `connector-redirect-uri` (read-only) / `connector-error`.
- **REST (agents converge; generalize the existing gcal set to `{id}`)**:
  `POST /api/admin/connectors` (openapi `{spec,binding}` | protocol `{kind,protocol,category}` → `201 {id}`,
  4xx `{error}`) / `POST …/{id}/credentials` (response is masked) / `POST …/{id}/connect` (oauth returns `{auth_url}`,
  protocol returns `{connected}`) / `GET …/{id}/status` (`{id,category,kind,has_credentials,connected}`) /
  `POST/DELETE …/{id}/disconnect` / `GET /api/admin/connectors` (`{connectors:[…]}`).
  Runtime direct-verification diag: `POST /internal/diag/connector/{id}/{list-busy,create-event}`.
- **Mock endpoints (to be built, added to external-mock)**: `/__mock/oauth/*` (programmable authorize/token, covering deny/
  invalid_client/state/network) / `/__mock/caldav/{id}/{events,fail,reset}` / extend `/__mock/smtp/*`.
- **Category contracts**: `CalendarContract.{ListBusy,CreateEvent,CancelEvent}` / `MailContract.Send` (= the existing proxies).

> Open after the audit: ① does SMTP use `mail-*` (existing) or migrate to `connector-*` (new, unified) — decide at implementation time; red tests carry both for now;
> ② `connector-card-{category}` (catalog card) vs `connector-row-{category}` in the new contract (installed slot row) are two views; keep both.

### Areas (happy + err; phase marked)
- **A Ingest**: valid 3.0 parses ✓ / malformed / non-3.0 rejected / no servers/operations / URL failure / oversized.
- **B Credential form derivation**: oauth2/apiKey/basic/bearer each render correctly / **multi-scheme selector** / no scheme / unsupported type.
- **C JSONata binding**: request construction ✓ / response extraction ✓ / syntax error rejected at setup / missing field at runtime handled gracefully / op does not exist / unknown category / incomplete mapping.
- **D Connect flow**: oauth2 dance ✓ / non-dance ✓ / user denies consent / wrong client fails token exchange / state/CSRF / network down / redirect_uri shown / reconnect/rotate / disconnect.
- **E protocol (SMTP)**: fill form → connection test ✓ / wrong host/port / auth error / TLS mismatch.
- **F Consumption loop**: openapi calendar → booker book ✓ / **non-gcal calendar → booker with not one line changed ✓** (the crux of category normalization) / SMTP → send mail ✓ / runtime 5xx degrades / mismatched response shape falls back / dep-gating connect/disconnect.
- **G Upload/management**: upload a custom spec+binding → setup ✓ / built-in vs uploaded / same-name overwrite / delete → cap re-gated.
- **H Security** (forced by user uploads): ⚠️ **SSRF** (spec `servers` pointing at the internal network → reject/validate) / credentials never leak (extend handle_contract) / per-owner isolation.

### Phase one (trunk first)
The **happy paths of A+B+D+F** open the trunk "upload spec → derive form → OAuth → booker runs a non-gcal calendar";
**C/E/G/H + every area's err cases** follow.

---

## 9. Design decisions the red tests already assume (confirm/adjust at implementation)

The §8 red tests pin the places the design left blank into testable contracts. Go over them before implementing:

- **Category slot rule** (§1, one category, two kinds): a category slot has **only one active connector at a time**, and the owner **activates it explicitly**; connecting a second one **does not take the slot automatically**; when the active one disconnects → **fall back to another connected candidate** (⚠️ or change it to "no fallback, re-gate, owner picks again" — the red tests keep an alt assertion). dep-gating is tied to "at least one active connected", not to a specific provider.
  - New REST: `POST /api/admin/connectors/{id}/activate`; status/list rows carry an `active` bool.
- **Agent tooling mechanism** (§3, the second consumer path): **opt-in** (`expose_as_agent_tools:true` when creating the connector); tool name `op_<operationId>` (dot → underscore, D-3 snake_case); description taken from the operation `summary`; **per-op ACL shares the gate with cap** (exposed only when connected + granted); **category-only connectors do not leak raw ops** (only the normalized cap is exposed).
  - New diag: `POST /internal/diag/connector/{id}/agent-call` (returns the raw SaaS response; the agent path has no contract).
- **disconnect keeps credentials** (does not clear them) — consistent with the existing `admin-gcal-disconnect`; one-click reconnect without re-entering.
- **Spec ingest**: external `$ref` is **rejected** (no central fetch); only **3.0** accepted; YAML/JSON share the parse path; a size limit rejects oversized specs.
- **openIdConnect ≈ oauth2** (derived with the same shape, plus a discovery URL hint).
- **Credential derivation**: with multiple schemes the owner chooses; the oauth2 scopes selected are **actually carried into the dance** (the mock records the authorize scope to verify).
- **Mock endpoints to build** (in external-mock): `/__mock/oauth/*` (programmable authorize/token + records scope/call count),
  `/__mock/sendgrid/*`, `/__mock/caldav/{id}/*`, `/__mock/ssrf/*`, + gcal `set_freebusy_raw`/`set_event_shape`.
- **New diag**: `POST /internal/diag/connector/{id}/send` (the mail version, matching list-busy/create-event).

> All of these are hard-coded as assertions in the red tests — at implementation, either follow them and turn them green, or change the design + change the matching red tests.
