# Scenario S1: any block, embedded in a microsite, used by the code holder

Status: DESIGN 2026-10-01. Not built. Decisions for the owner are at the end.

## What the owner asked

2026-09-30, in the owner's words (summarised):

- "Collaborative-development onboarding: I send a friend an access code plus a dedicated microsite.
  They can chat there and read detailed instructions. I set up a few starter issues on GitHub. eiab
  connects to GitHub, and eiab is embedded into the microsite: inside the microsite they see the specs
  and the GitHub board."
- Correction: "GitHub is only an example; what I want is the general capability." Any block (any
  external service) can be embedded in a microsite and seen or used by the visitor. GitHub is one
  acceptance case.

## What already exists (read from the code, 2026-10-01)

**The visitor's door to a block is one endpoint.** `POST /api/v1/sessions/{id}/tools/{tool}`
(`backend/internal/routes/public/chat.go:112-113`, `tools.go:3-6`) authenticates the visitor session,
assembles only the block that serves that tool (`tools.go:162`), refuses a tool the session does not
carry with `404 block_not_enabled` (`tools.go:166-172`), runs it, and writes a `[card action]` line
into the conversation (`tools.go:234-247`). An executor error reaches the browser as a static
sentence, never the raw error (`tools.go:204-211`). `QUERY` is accepted only for read-only tools
(`tools.go:46-51`).

**The grant is the code's bundle, read live.** A code carries `microsite_id` (which page it lands on)
and `bundle_id` (which blocks it may use) (`backend/db/schema.sql:375-385`). When a bundle is bound,
the bundle is the whole grant (`backend/internal/plugin/mount/mounted_gate.go:62-67`), and it is read
on every assembly, so removing a block bites an open session (`plugin/registry/bundle_gate.go:9-14`,
`realm.go:32-44`). A code with no bundle falls back to the role ACL (`bundle_gate.go:21-24`;
`docs/design/block-acl-hierarchy.md`).

**The page adopts the code's session.** Presenting a bound code lands on its microsite, and the page
adopts the session the gate stored (`docs/design/microsites-mount-corpus-and-code.md:99-104,
121-130`). A page bound to an active code is closed to codeless readers by default
(`schema.sql:827-849`).

**The SDK already drops a block tool on a page.** `BlockWidget` / `useBlockTool`
(`sdk/packages/react/src/widgets/BlockWidget.tsx`) adopt the stored session (`:59-63`), call the
endpoint through `widgetClient.callTool` (`sdk/packages/core/src/client.ts:200-208`), and show a
sentence when there is no session (`:151-157`). A codeless visitor may run only the read-only corpus
tools, and only when `public_search` is on (`:28-31`; `backend/blocks/corpus.retrieval/manifest.yaml:14-22`).
One e2e covers it, with `ask_visitor` as the witness (`e2e/test/microsite-block-widget.spec.ts:11-13`).
`CorpusWidget` is not a block tool; it reads its own public endpoints (`CorpusWidget.tsx:42`).

**Blocks can ship their own UI (MCP Apps).** A tool's `_meta.ui_resource` is read at assembly into
`ui_html` (`plugin/mount/state.go:91-93, 138-140`; wire field `plugin/registry/registry.go:262`). The
adopted session already stores each tool's `ui_html` (`sdk/packages/core/src/grant.ts:32-41`).
`McpAppCard` renders it in an `allow-scripts`-only iframe (`chat/McpAppCard.tsx:41-50`); a card asks
the host to run a tool through `mcp-ui:tool`, which goes to the same endpoint
(`chat/use-mcp-app-card.ts:62-67, 99-107`).

**Owner credentials reach a block only through a seam verb.** `blockseam.Provider.CallVerb(ctx,
ownerID, verb, args)` merges the owner's stored credentials into the args host-side, then calls the
verb on the block (`plugin/blockseam/provider.go:62-73`). A consumer block reaches it through the
`supplier.invoke` host op (`backend/blocks/calendar.book/manifest.yaml:49-50`). The openapi engine runs
any spec + binding as a block (`backend/blocks/google-calendar/manifest.yaml:28-38`;
`docs/design/plugin/openapi-runtime-block.md:67-78`). A supplier already declares owner-facing
operations as data: `owner_tools` = name + tool + description + input_schema
(`google-calendar/manifest.yaml:51-64`), and the host derives a form from scalar schemas
(`plugin/adapters/owner_op.go:7-11, 52`).

**The other way to connect a service: ext-mcp.** The owner registers an MCP server URL with an auth
header (`schema.sql:447-467`). Visitor sessions get its tools as `ext_<server>_<tool>`
(`routes/blockload/ext_mcp.go:197-221`). Three properties matter here:
1. Servers come from the role (`ext_mcp.go:99-115`), and the whole loader is one block id `ext.mcp`
   (`:32`), so a bundle cannot pick one server.
2. Every tool the server lists is exposed, under the owner's header (`:169, 197-217`).
3. `read_only` is the server's own hint (`:215`).

## The gap

The scenario fails today at five points. Each point names what is missing, not more of what exists.

1. **No owner-credentialed block has a visitor face.** A supplier block's verbs are reachable only
   from another block (`supplier.invoke`) or the owner (`owner_tools`). GitHub needs one of two
   things today: a hand-written consumer block per service, which is glue, or ext-mcp, which
   exposes every tool on the owner's token (point 3 above).
2. **The visitor list is not an allowlist.** `visitor_tools` is a declaration that is reconciled
   against the block's `tools/list`. The real list binds (`plugin/mount/tool_drift.go:13-14`).
   `read_only` is the block's own claim (`state.go:94-96`). A host that lends the owner's
   credential cannot let the block decide its own exposure.
3. **The widget cannot show a result.** `BlockWidget` prints `JSON.stringify(result)` in a `<pre>`
   (`BlockWidget.tsx:170-173`). It ignores the tool's `ui_html` that the session already carries.
   It has no generic view either.
4. **The widget cannot write.** It passes fixed `args` (`BlockWidget.tsx:121-128`). It has no form,
   and the visitor tool spec carries `input_schema` (`registry.go:263`) but no read/write flag.
5. **Writes are unmetered and unaudited.** A code session's tool calls skip every rate limit; only
   the public tier is throttled (`tools.go:92-102`). No event records a visitor's tool call; the
   access domain's events stop at `code.redeemed` (`backend/internal/access/usecase/events.go:13-21`).

## Mechanism

One rule. Any block that supplies a seam may declare **visitor operations** in its manifest. They have
the shape of `owner_tools`, and each one says if it is read or write. The host exposes exactly
those operations to visitor sessions. Each call goes through `CallVerb`, so the owner's credential is
merged host-side. Everything else (grant, endpoint, widget, card, events) is the existing machinery.
The host never names GitHub.

### 1. Manifest: `visitor_tools` gains the `owner_tools` fields

```yaml
id: github                      # data only: openapi engine + spec.yaml + binding.yaml
title: GitHub
provides: github
transport: { kind: sandbox_stdio, command: node, args: ["/plugin/openapi-mcp.js"],
             auth_scheme: bearer, spec: spec.yaml, binding: binding.yaml,
             sandbox: { plugin_dir: /srv/plugins/github, allow_net: true } }
config:   [ { key: repo, label: Repository (owner/name), type: string } ]
visitor_tools:
  - name: github_issues        # what the visitor and the agent call
    tool: list_issues          # the binding verb it runs
    read_only: true
    description: Open issues of the configured repository, with labels.
    input_schema: '{"type":"object","properties":{"label":{"type":"string"}}}'
    ui: board.html             # optional block-provided card (MCP Apps); else the generic view
  - name: github_comment
    tool: comment_issue
    read_only: false
    requires: [github:issues.write]
    input_schema: '{"type":"object","properties":{"number":{"type":"integer"},
                    "body":{"type":"string"}},"required":["number","body"]}'
```

- `name`, `requires`, `quota`, and `code_config` keep today's meaning. The fields `tool`,
  `description`, `input_schema`, and `read_only` are added. They are the `owner_tools` fields, so a
  supplier declares both faces in one vocabulary.
- **Declared means allowed.** On a block with `provides`, the host exposes `visitor_tools` and
  nothing else. A binding verb that is not listed (for example `delete_issue`) has no visitor name,
  so it is unreachable. Drift reconciliation still logs, but it never widens exposure. Sandbox
  blocks that hold no credential (ask_visitor, corpus.retrieval) keep today's behaviour.
- **The host declares `read_only`.** It comes from the manifest, not from the server's hint. It
  drives `QUERY` (`tools.go:46-51`), the widget's mode, and the write meter below.
- **The binding is the redaction.** The binding's response JSONata is the only data a visitor can
  receive. A field that the binding does not project (an email or a private URL) never leaves the
  host.

### 2. Host: one generic fiber per supplier with visitor tools

`blockload` registers one fiber for each manifest that has both `provides` and `visitor_tools`. The
fiber has these properties:

- Its ID is the block id. The bundle gate (`mounted_gate.go:62-67`) therefore picks it per block:
  the owner puts `github` in the "collab" bundle and nothing else.
- Each tool's run is `Provider.CallVerb(ctx, in.OwnerID, tool, args)`. The tool name is a string,
  the verb is a string, and the args are JSON. There is no typed contract per seam.
- Per-tool `requires` hides a write that the credential's scopes cannot perform. The mechanism is
  the existing F-B-8 one (`calendar.book/manifest.yaml:21-36`).
- The tool spec gains two fields on the wire: `read_only` and `block`.

The chat agent, the API-key facade, and the widget all read this one registry. A tool that a code
may call from the page is therefore also a tool its agent may call in the chat. That is the
"one registry, every face" rule, and nobody has to apply it by hand.

### 3. SDK: `BlockWidget` renders and writes

- **Render.** The tool spec carries `ui_html`, so the widget renders `McpAppCard` with the result.
  The card is the block's own view, for example a board grouped by label. With no `ui_html`, the
  widget renders a generic view. An array of objects is a table whose columns are the first item's
  keys. An object is a key/value list. A string value is rendered with the SDK's markdown renderer.
  The `<pre>` goes. The generic view is a semantic class in `@standmeet/sdk/styles.css`; the TSX
  carries no styles.
- **Write.** A tool with `read_only: false` renders a form derived from `input_schema`. Scalars only,
  with the same rule as `owner_op.go:52`: a schema the host cannot render is refused when the block
  loads. Submit is a `POST`. The result goes to the same view, and the `[card action]` line is
  written as today.
- **Refusal is a sentence.** `block_not_enabled`, `rate_limited`, and a missing scope each map to
  one i18n line. The widget never shows a dead button (BlockWidget.tsx:148-150).
- The page author writes `<BlockWidget tool="github_issues" autoRun />`. `microsite.guide` lists the
  visitor tools of the blocks in the bound code's bundle, so the owner's agent knows which names
  exist.

### 4. Security, stated per question

| Question | Answer |
|---|---|
| What can a visitor call? | The intersection of the bound bundle (live) and the tools declared in `visitor_tools`. Nothing else, from any face. |
| Does the visitor get the owner's token? | No. `CallVerb` merges the credential inside the host-to-block call. The browser receives the binding's projected result or a static error sentence (`tools.go:204-211`). |
| Read or write? | The manifest declares `read_only` per tool. Writes need `POST`. A codeless (public) session never gets a write; `PUBLIC_SAFE_TOOLS` stays corpus-only. |
| Rate limits | A new write meter on the tools endpoint: each non-read-only call on a code session takes one token from a per-(code, block) bucket, using the same guard type as `PubSearchGuard` (`routes/public/guards.go:8`). Over the cap, the endpoint returns `429 rate_limited`. A block may also declare `quota` (count-based, existing). |
| Audit | A new event, `block.tool_called` (subject `code/<id>`; data: block_id, tool, read_only, ok). It is recorded for every write, and it flows through the event bus, so a notification rule can watch it (`notify-rules-and-live-transcript.md`). The `[card action]` transcript line stays. Reads are not recorded as events: their volume is high and they change nothing. |
| Revocation | Removing a block from the bundle, or revoking the code, takes effect on the next call (`bundle_gate.go:9-14`). |
| Card scripts | A card is block-supplied code in an opaque-origin iframe. The server-side grant is the only boundary. Client-side checks are not counted as security. |

## Acceptance: one black-box Playwright spec, real stack

The spec is `e2e/test/scenario-s1-block-in-microsite.spec.ts` and it runs through `make`.

**GitHub stand-in.** Add `mock-stack/job-board/github.go` to the `external-mock` service
(`mock-stack/job-board/main.go:1-7`). It serves `GET /github/repos/{o}/{r}/issues` from a fixture
with three issues labelled `good first issue`. It records `POST .../issues/{n}/comments` with the
`Authorization` header. It exposes the record at `/github/_recorded`, in the same style as
`webhook_sink.go`. The block's spec `servers` URL is `${GITHUB_API_BASE:-https://api.github.com}`,
and dev compose points it at the mock (the same pattern as `bearer-api/spec.yaml:6`).

Owner setup goes through the owner API: install `github`, connect it with the token `ghp_TESTONLY`,
create the bundle `collab` = [`github`, `corpus.retrieval`, `google-calendar`], write the corpus note
`specs/onboarding`, and build the microsite `onboarding`. The microsite holds a `BlockWidget` for
`github_issues`, `github_comment`, `corpus_read`, and `calendar_busy`. Then issue the code
`COLLAB-1`, bound to that microsite and bundle.

| # | Step (visitor unless noted) | Visible marker | Red on 2026-10-01 because |
|---|---|---|---|
| 1 | Open `/?code=COLLAB-1` and pick a name. | The microsite heading shows. Under `data-tool="github_issues"`, the visitor sees a table with three rows that carry the fixture titles. | The verb has no visitor face, so the call returns `404 block_not_enabled`. A result would be a `<pre>`. |
| 2 | Same widget, with the block's `board.html` declared. | The card iframe `mcp-app-card-github_issues` shows the column `good first issue` with three items. | `BlockWidget` ignores `ui_html`. |
| 3 | Comment "I'll take #2" on issue 2 through the `github_comment` form. | The widget shows the comment URL. `/github/_recorded` holds one POST with that body and the header `Bearer ghp_TESTONLY`. | The widget has no form, and no write verb is exposed. |
| 4 | Check the browser for the token: every response body and `localStorage` during steps 1-3. | `ghp_TESTONLY` appears nowhere. | Steps 1-3 cannot run, so this cannot pass. |
| 5 | Call the tools endpoint for `github_delete_issue` (in the binding, not declared). Send `QUERY` to `github_comment`. | `404`, then `405`. In the same session, step 1 is green. | Step 1 is red. |
| 6 | Submit 11 comments in one minute (the cap is set to 10 for this code). | The 11th call shows the rate-limit sentence. The stand-in recorded 10 POSTs. | No write meter exists for code sessions. |
| 7 | Owner: read `/admin/conversations` and the webhook sink. | The transcript shows the `[card action]` line for `github_comment`. The sink received `block.tool_called` with `tool=github_comment`. | The event type does not exist. |
| 8 | Owner removes `github` from `collab`. Visitor reloads. | Both GitHub widgets show the "not available on this code" sentence. The corpus and calendar widgets still render. | The sentence mapping is missing, and step 1 is red. |
| 9 | Generality: `corpus_read` renders `specs/onboarding` as markdown (a heading element). `calendar_busy` is three manifest lines added to `google-calendar` (`tool: free_busy`, `read_only: true`), and it shows the gcal mock's busy windows as a table. | The heading text is visible, and the table has the mock's two windows. | The result is a `<pre>`, and `free_busy` has no visitor face. |

Step 9's diff to the host is zero lines. If step 9 needs Go changes, the mechanism failed.

## Not in this change

- **Ext-mcp stays as it is.** It keeps its role-scoped lump of all tools, for the chat only. A
  per-tool allowlist for ext-mcp is a follow-up; see decision 4.
- **No live board.** The board does not update from GitHub webhooks; it refreshes on load.
- **No GraphQL.** Projects v2 is GraphQL-only, and the openapi engine is REST.
- **No node packages from blocks in the build.** Builds still use only the vendored SDK
  (`docs/design/plugin/microsite-build.md`).
- **No visitor sign-in to GitHub.** The visitor does not authenticate with GitHub; see decision 2.

## Decisions for the owner

1. **Do visitors write at all in v1?** Recommended: yes, but only through tools that are declared
   `read_only: false`, and only on codes bound to a bundle. A role-only code stays read-only.
   Cost: one more attack surface on your GitHub account, bounded by the declared verbs and the
   meter.
2. **Whose identity appears on GitHub?** (a) Your token: the comment appears as you or your bot.
   The block prefixes the body with the visitor's picked name. This is cheap, and it fits S1.
   (b) The friend's own GitHub OAuth: a per-visitor credential. That is a new credential owner and
   a new consent flow, measured in weeks. Recommended: (a) now, (b) when a collaborator needs to own
   their PRs.
3. **Write budget.** The default per-(code, block) bucket: 10 writes/hour is proposed. The other
   question is whether a widget write also spends the code's turn/gas meter. Recommended: a
   separate bucket, because a write is not an inference.
4. **Can the agent write, or only the widget?** One registry means the chat agent gets
   `github_comment` too. A prompt-injected visitor could then make your agent post. The
   alternatives: (a) allow it, and accept the risk inside the meter; (b) add `agent: false` on
   write tools, so writes are widget-only. Recommended: (b) for writes, until the claim gate and
   notification rules have run on real traffic.
5. **"Board" means issues grouped by label (REST)** in v1. A Projects-v2 board needs a GraphQL
   engine, which is a separate block arc. Confirm that a label board is enough for onboarding.
