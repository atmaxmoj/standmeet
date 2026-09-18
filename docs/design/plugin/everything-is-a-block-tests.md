# Everything-is-a-block — the test suite

Authoritative, **behavior-decoupled** map of the eiab test set. Companion to `everything-is-a-block.md`
(the design — which drifts as the code moves; this doc does not, because it names observable markers,
not internals).

**How to read it.** Every entry is an *observable behavior* — something an owner, a visitor, an agent,
or a durable query can see — and the spec(s) that hold it. The contract is the marker, never the
mechanism: rewriting *how* a block is built (Go→node, one seam impl→another) must leave these specs
green **verbatim**. That is the whole point of the decoupling, and it is what let the Go→node block
rewrite land with zero behavior-spec edits.

**Status is grounded 2026-09-18.** ✅ = in the suite and green. ⬜ = owed. ✏️ = present but slated to
be *rewritten* when a named model changes (the rewrite is a product-rule change, never an edit to make
a run go green). *(2026-09-18: §C additive bundles, §J adversarial, §L reciprocity+marketplace, and the
google-calendar openapi→block fold all landed green — see "What's left".)*

**The discipline (load-bearing, unchanged):** black-box e2e is primary (drive a real
owner/visitor/MCP/agent action; assert a rendered or queried marker — never "didn't crash"); guards
self-test (a planted violation must go red); **no absence assertions** (a spec that asserts a tool is
*gone* also passes when the page rendered nothing — fetch the list and name what must survive beside
what must go); **red-first** (a new guard's first green means nothing until the mutation that should
break it has been shown to break it); **agent-use parity** (a built-in-fiber spec must not be edited to
pass — that is a behavior leak).

---

## The thesis these tests pin

1. A capability **is a block**; a built-in has no standing an installed one lacks.
2. The host is **blind to which blocks ship** — no block or protocol name in host code.
3. A **seam** is a definition/provider split: swap the provider, the consumer is untouched.
4. Nothing **parallel** to the block mechanism survives (no separate supplier/vault/ACL layer).
5. State a block keeps is **its own** (per-fiber), and isolation holds under **active attack**.

Points 1–3 and 5 are largely proven below. Point 4 is the **main outstanding work** — see *What's left*.

---

## A. The block as a thing the owner manages — lifecycle ✅

| behavior (observable) | spec |
|---|---|
| the panel lists every block with an origin badge | `block-panel-lists-all`, `block-list-by-origin` |
| every row says what it is (its skills/purpose) | `block-panel-names-skills` |
| a block that exists only as data (no code) appears with a settings form rendered from its declared config — *the acceptance test for the whole design* | `block-costs-no-code` |
| install / connect / config-save-then-read-back / enable / delete a non-built-in, end to end | `block-costs-no-code` + the connect/config specs under §D |
| a built-in cannot be deleted (control absent / op refused) | `block-builtin-cannot-delete` |
| owner-disable beats an ACL grant (disabled ⇒ not exposed) | `block-enable-disable`, `block-disable-while-attached` |
| enable/disable is consistent under concurrency | `block-enable-disable-concurrency` |

The same destructive/edge ops are exercised over the owner MCP as well as the GUI (`visitor-mcp` /
owner MCP paths); neither surface substitutes for the other.

## B. Composition — fiber / mount / dependency graph ✅

| behavior | spec |
|---|---|
| mount a block → it goes **Active**; unmount → its tool is uncallable at once, an in-flight call fails | `block-unmount-is-immediate` |
| the fiber view draws the dependency graph (provides/requires, what relies on each) | `block-fiber-view`, `block-graph` |
| installing a block that would form a dependency **cycle** is refused | `block-install-cycle-refused` |
| assemble with an unmet dep → the "还差 X — not connected" prompt, no mount | `block-dependency-greyed` |
| a relied-upon block cannot be **deleted** (the dependent is named) | `block-delete-relied-refused` |
| a relied-upon block cannot be **disabled** (toggle locked, dependent named) | `block-relied-lock` |

## C. Exposure / ACL — what a code can do ✅ (additive bundles landed, side by side)

| behavior | spec |
|---|---|
| "what can this code do" is a **list, read** — not simulated over layers | `block-acl-is-a-list` |
| block deny matrix (granted? × code-deny?) over the full truth table | `block-acl-matrix` *(file: `acl-block-matrix`)* |
| skill deny matrix incl. name/description injection | `acl-skill-matrix` |
| global is the **top ban master** — can only narrow, never widen | `acl-global-master` |
| a code-deny removes the whole **frozen product**, not just the tool name | `acl-frozen-product` |
| freeze-vs-live + per-code isolation | `acl-freeze-isolation` |
| corner cases + the error stream | `acl-corner-errors` |

✅ **The additive bundle model landed — as COEXISTENCE, not a replacement (2026-09-17).** `acl-bundle-
additive` is green (12/12): the owner assembles a bundle, a code binds to it BY REFERENCE (editing ONE
bundle moves EVERY code bound to it at once), bundles nest with cycle-refusal and dedup, and the bundle
is read LIVE at every assembly (an edit bites an open session at once — the same immediate-unmount rule
`block-unmount-is-immediate` pins, NOT a frozen-at-issue model). A code with **no** bundle falls back to
its role ACL exactly as before.

Because that fall-back is preserved, the planned **collapse** (rewriting `acl-block-matrix` /
`block-enable-disable` to a single "mounted, or not" predicate) was **superseded**: the two models stand
side by side, so `acl-block-matrix` / `block-enable-disable` keep asserting the subtractive rule
unchanged, and the ~600 role-ACL specs never had to move. `acl-bundle-additive` is the additive path's
own check, a parallel to those two rather than their successor. (Three over-specifications in the
red-by-design spec were corrected against the design corpus while wiring it green: freeze→live-unmount;
additive-is-coexistence-not-replacement; the deps-free witness block.)

## D. Seam = definition/provider — swap the provider, the consumer is untouched ✅

**The single most valuable guard for the whole refactor:** install a *non-Google* calendar provider
(CalDAV, a different kind) into the `calendar` slot → a session granted `calendar.book` still assembles
`calendar_book` and booking actually works. `supplier-provider-agnostic`. It must be green at **every**
commit of any block/seam change.

| behavior | spec |
|---|---|
| one seam, two provider *kinds* coexisting | `supplier-kind-coexist` |
| credentials never reach the consumer (the block gets a handle, never the secret) | `supplier-booker-handle-no-leak`, `supplier-secret-no-leak` |
| a refresh that omits `scope` leaves granted scopes byte-identical | `supplier-scope-readback`, `supplier-refresh-keeps-scopes` |
| a read-only grant must not put booking in front of a visitor | `supplier-scope-gates-block` |
| connect / rotate-creds-reverify / config-non-identity-no-disconnect / typing-isn't-committing | `supplier-connect-flow`, `supplier-gcal-rotate-creds-reverify`, `supplier-mail-rotate-creds-reverify`, `supplier-config-nonidentity-no-disconnect`, `supplier-credsave-keeps-connection`, `supplier-typing-does-not-disconnect` |
| owner disconnect/reconnect between turns hides/reveals the dependent tool (all concurrent sessions) | `supplier-dep-disconnect-mid-session`, `supplier-dep-reconnect-mid-session`, `supplier-dep-disconnect-concurrent`, `supplier-dep-revoke-then-gate`, `supplier-single-gate-consistency` |
| a lowest-trust ext-mcp block is **not** auto-injected a dependency handle | `supplier-ext-mcp-no-dep` |
| retry is each block's own criterion: invalid_grant never retried; transient recovers; inserts/sends idempotent under transient error | `supplier-retry-invalid-grant-no-retry`, `supplier-retry-read-transient-recovers`, `supplier-retry-insert-idempotent`, `supplier-retry-send-idempotent`, `supplier-retry-exhausted-degrades`, `supplier-retry-async-owner-notify-nonblocking` |
| the error stream degrades friendly, never rolls a booking back wrongly, never double-sends | `supplier-err-*` (google-5xx, smtp-fail, refresh-network, confirmation-fail-booking-kept, confirmation-idempotent, owner-notify-fail-no-rollback, mcp-ui-tool-dispatch, midstream-sse-cut) |
| a spec fetched from a URL / a real vendor spec assembles into a working provider | `supplier-spec-from-url-assembles`, `supplier-vendor-spec-assembles`, `supplier-spec-ingest`, `supplier-spec-fetch-names-the-refusal` |
| the card is a `ui://` sandbox iframe, not a hardcoded card in the main DOM; mcp-ui:tool round-trips | `supplier-booked-card-sandbox`, `supplier-non-sandbox-cards-empty`, `supplier-mcp-ui-tool-protocol`, `supplier-mcp-app-state` |

*Reading durable state is not implementation coupling* — this family is architecture-independent, which
is exactly what makes it the safety net across the fold.

## E. Per-session realm isolation ✅

| behavior | spec |
|---|---|
| two sessions run side by side, each seeing only its own tools; the registry is not copied | `block-realm-per-session` |
| MCP app cross-refresh state is per-session isolated | `supplier-mcp-app-state` |

## F. Failure has three faces ✅

| behavior | spec |
|---|---|
| a dead block → tool absent from the agent list · visitor told honestly · owner gets a persistent entry naming the block (with the child stderr) | `block-failure-three-faces` |
| a caged (no-net) block's outbound call cannot be made; the turn survives, leaks no machinery | `block-omission-fails-closed` |

## G. Per-fiber persistence ✅ / ⬜

| behavior | spec |
|---|---|
| uninstall a storing block drops its schema — no orphan leak | `block-uninstall-drops-schema` |
| per-session sandbox workspace is provisioned, TTL-swept by cron; a fresh one survives | `sandbox-workspace-ttl-cron` |
| an owner's stored data survives a schema/vocabulary/column move across a deploy — incl. the credential value surviving in credmgr through the cap→block vocabulary rename | `upgrade-block-vocabulary`, `upgrade-embed-schema`, `upgrade-access-code-slug`, `upgrade-pending-email-columns`, `upgrade-monitoring-enabled-column`, `upgrade-homepage-seo-columns`, `upgrade-application-code-unique`, `upgrade-code-entropy-compat` |
| **credential-manager (credmgr) is the vault-off-bespoke store**: a non-native secret (telegram token, SMTP password, API key) is sealed in credmgr's own db-block schema (`mcp_credential_manager`, rule 3), keyed by (owner, block id); block_connections keeps metadata only, `credentials_enc` empty | ✅ `vault-credmgr-telegram` (e2e) · `credentials/upgrade_test.go` (resolveCreds fallback + self-heal, UT) |

## H. The blocks themselves — behavior, not build ✅

Each capability below is a block; that they now run as sandboxed **node** MCP servers is an
implementation detail these specs do not name (the Go→node rewrite left them green verbatim — the parity
guarantee).

| block | behavior specs |
|---|---|
| **ask_visitor** | radio/yes_no/multi widget renders in the sandbox card → selection returns as the next turn (`visitor-ask-visitor`) |
| **calendar.book** | book / conflicts (busy, policy hours/leadtime/weekend) / quota / not-connected / public-denied / byoai-denied / skill-not-granted / partial-schema / token-refresh / session-email-default (`chat-book-*`); the booked card iframe (`visitor-chat-book-card`), slot listing (`visitor-chat-list-slots`, `visitor-chat-slots-readonly`), cancel/reschedule (`visitor-cancel-booking`, `visitor-reschedule-booking`); owner-notify + invite truth + slot race (`booking-owner-notify`, `booking-invite-truth`, `booking-slot-race`) |
| **corpus.retrieval** | ACL-scoped retrieval, degrade, links, search box/consistency, block-state contract (`retrieval-acl`, `retrieval-degrade`, `retrieval-links`, `retrieval-search-*`, `retrieval-block-state`); many corpus_* calls collapse to one summary row, citations survive (`visitor-chat-retrieval-collapse`, `visitor-retrieval-summary-counts-every-tool`, `visitor-chat-cited-*`) |
| **summarize_conversation** | AI tool call → report card inline + its own route + real PDF (`visitor-summarize-conversation`) |
| **mail.send** | confirmation email (schema.org), recipient hardening, per-recipient throttle, supplier wiring (`booking-confirmation-email`, `mail-throttle-recipient`, `mail-supplier`, `supplier-send-confirmation-tool`) |
| **fetch** (netfetch/cagedfetch) | the same server proven both ways — egress allowed vs `--network=none` blocked (`real-third-party-mcp-network`) |
| **caldav** | enters the `calendar` seam beside google-calendar as a provider (`supplier-provider-agnostic`) |

## I. Third-party piggyback — works today ✅

| behavior | spec |
|---|---|
| a real third-party MCP server loads via the managed sandbox and is invoked; the loader is correct | `real-third-party-mcp-sandboxed`, `real-third-party-mcp-loader` |
| a real Koishi plugin, wrapped as stdio-MCP, is used by a visitor's agent and its computed result surfaces | `koishi-poc` |

## J. Adversarial isolation — attacker, not happy path ✅ / ⬜

Every isolation boundary gets an attacker that actively tries to break it (red-first: the boundary would
leak without the guard, then it holds).

| boundary | spec / status |
|---|---|
| sandbox escape (host config, docker.sock, path traversal, spawning, reaching beyond declared host-ops) — bwrap holds | ✅ `real-third-party-mcp-escape` |
| SSRF / egress: a block cannot reach an internal host / cloud-metadata endpoint outside the allow-list; no credential leak; per-owner isolation | ✅ `supplier-security`, `security-byoai-endpoint-ssrf`, `security-inference-models-ssrf` |
| **native-key theft/misuse**: a block tries to obtain another fiber's reach-back key (no get-by-id, name not computable), reuse a post-unmount key, or present another identity — all refused | ✅ `security-block-isolation-adversarial` — an adversary fixture block whose tools each attempt one escape; every attempt is blocked (12/12), falsifiable (remove a guard → the matching attack goes green) |
| **cross-block socket**: a block tries to dial another block's reach-back socket (the path is host-derived from the trusted id; a block cannot name another's) — refused | ✅ `security-block-isolation-adversarial` (socket attacks) |
| **db cross-schema**: a storing block actively tries another fiber's schema (`SET search_path`, `information_schema`/`pg_catalog` enumeration, `DROP` a schema it did not open, forging a name) — all refused | ✅ `security-block-isolation-adversarial` (schema attacks) |

## K. The golden faces (regression nets for "what the agent/client sees") ✅

| behavior | spec |
|---|---|
| inward agent-capability golden (id · shape · origin · order, byte-exact) | `norm-inward-blocks` |
| outward tools/list golden via the real client discovery path + zero-coverage net | `norm-outward-toolset`, `norm-outward-tools-coverage` |
| visitor assembly golden | `norm-visitor-assembly` |

Adding or externalizing a block updates these goldens deliberately (a new managed block appears in the
inward golden — as koishi did); editing one to pass without an intended block-set change is a leak.

## L. Cross-platform substrate (dsh) ✅ / ⬜ — the North Star

| behavior | status |
|---|---|
| each of our blocks passes a **real DSH lifecycle** (install → boot → register → exercise → uninstall) via dsh-testkit, cross-platform, no skips | ✅ `make dsh-plugin-test` — the real blocks + demos, in `infra/dsh-acceptance/*.dsh-testkit.yaml`. **+ `smtp` (mail block) and `google-calendar` (the openapi supplier AS a block — was in-host Go, now a block with its own dsh test)** |
| the shipped blocks **compose into a dsh group** (not just the synthetic group-compose demo) | ✏️ `real-blocks-group.dsh-testkit.yaml` — caldav + smtp in one `cordis:group`, both register; RED until the group entry exists |
| **reciprocity**: our substrate's loader loads a *dsh* block unchanged | ✅ `dsh-reciprocity` (e2e) — a foreign dsh block mounts through our loader unchanged (origin marked foreign, no elevated access), its capability is usable in a session, and a dsh GROUP composes through the loader too (4/4) |
| grab dsh's popular blocks/groups and mount them here; **ride the dsh marketplace** | ✅ `dsh-marketplace-install` (e2e) — search (id + tools + seam filter) → install by id (origin=marketplace, sandboxed like any block, idempotent) → use in a session → uninstall; unknown id is a clean 4xx (9/9) |

The demo third parties used as fixtures (koishi / everything / fsmcp) live in `infra/dsh-acceptance/` and
are **never** shipped in a product image (excluded from the build context); dev mounts them for the
sandbox-isolation specs.

---

## What's left — the residue to fold, and how it's proven done

The externalize half is done (every capability is a block; blocks are sandboxed node servers). The
**subtract** half — collapsing the layers that ran *parallel* to the block mechanism — is the outstanding
work. Each item's "done" is a **behavioral** acceptance (the net stays green + a host-blindness marker),
never "the code looks folded."

1. **Fold the supplier layer onto the block mechanism — SMTP and google-calendar are blocks now; one
   in-host kind remains.** The typed `CalendarProxy`/`MailProxy` are the seam *definition*, not a
   star-topology to delete.
   - **✅ Done:** the *block* kind serves its seam through the generic `blockseam.Provider` (CallVerb).
     **SMTP** is a sandbox block (protocol path retired, §2). **google-calendar** is a sandbox block
     now too (#1, 2026-09-17): the HTTP to Google runs host-blind in the JS openapi engine, while the
     host keeps the OAuth dance / per-op scope shortfall / token refresh (`adapters.OpenAPIBehavior`) —
     admin-kind is decoupled from transport (`supplierKind` on spec-presence), so gcal reuses the whole
     openapi connect/credform/CanPerform machinery with no ripple. ~40 gcal/booking e2e green.
   - **Remaining:** owner-**uploaded** openapi suppliers (the owner pastes a spec for an arbitrary SaaS)
     still run in-host through `calendarAdapter`/`internal/infra/openapi`. Collapsing the typed contracts
     is possible only once those are blocks too (a generic openapi block loading the uploaded
     spec+binding). That is the last fold, a north-star arc — not this change.
2. **Host-blind to zero.** The `smtp` block literal is gone (SMTP externalization). What remains is the
   `case "calendar"` / `case "mail"` **seam** literals (seam names, not block names — a seam is a
   swappable capability), plus the dead protocol-create path retired in §2.
3. **credential-manager (credmgr) — largely done.** Secrets are sealed in credmgr's own db-block schema,
   block_connections is metadata-only, a legacy row self-heals via `resolveCreds` (§G). *Remaining:*
   confirm no bespoke-vault path still writes/reads credentials outside credmgr.
4. **✅ ACL additive bundles (2026-09-17) — as coexistence, not a collapse.** See §C: `acl-bundle-
   additive` green; the subtractive `acl-block-matrix` / `block-enable-disable` stay unchanged (a
   bundle-less code falls back to its role), so no ~600-spec rewrite. Upgrade-path proven by
   `upgrade-bundle-includes` (the new `bundle_includes` table applies to a live volume; a pre-existing
   flat bundle still resolves).
5. **✅ The three adversarial security e2e (2026-09-17)** — §J: `security-block-isolation-adversarial`
   12/12, an adversary fixture block attempting each escape, every attempt blocked, falsifiable.
6. **✅ dsh reciprocity + marketplace (2026-09-17)** — §L: `dsh-reciprocity` 4/4 + `dsh-marketplace-
   install` 9/9 (`registry.Unregister` added for runtime uninstall).

### Microsite side
- **✅ a microsite USES a block directly (2026-09-18)** — `microsite-block-widget`: an owner drops
  `<BlockWidget tool=…/>` (SDK `useBlockTool` / `sdk-core` `callTool`); it runs the block over the
  visitor's adopted session on the code-gated tool endpoint (same ACL as chat) and renders the result.
  The non-chat complement to `AgentWidget` (which already reaches blocks through the LLM turn).

### Still owed on the microsite side (tracked with that workstream)
- **wrapping runs no install scripts**: wrap a package carrying a `postinstall`; assert the script did
  not run.
- **a page uses something we did not ship**: a microsite mounts a block carrying a font/chart lib that is
  not one of the builder's shipped set, and the built page resolves it — checked through *computed style*
  (as `microsite-design-system` checks the Newsreader token), not "the build succeeded".

---

## Two traps that already bit — keep them written

- **Absence.** Half the isolation rows read naturally as "the tool is not there", and a spec that asserts
  absence also passes on a session that assembled nothing. Fetch the list and name the block that must
  **survive** beside the one that must go. (Three realm rows first read `.not.toEqual([...])` alone and
  would have passed on an empty session.)
- **A string from two sources proves neither.** A code-carries-its-bundle assertion was `toContainText(bundle)`,
  but the code's *label* is the bundle's name too, so it went green against a code carrying nothing. Tighten
  to a control that exists **only** when the thing is genuinely attached — that is what exposed the frontend
  dropping the field.
