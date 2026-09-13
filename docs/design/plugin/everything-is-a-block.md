# Everything is a block

Status: **2026-09-12.**

North star, the owner's: **everything composed is a block.** If it can be externalized, it is a
block. The base reaches out only for the substrate — the loader, the one registration door, seam
resolution. Protocol suppliers, libraries, credential management, and the persistence the base hands
down are all blocks, registered through the same door by the same mechanism.

This supersedes an earlier draft (`opening-the-seams.md`, deleted). That draft made the host *blind*
to the protocol suppliers with an in-tree registry, but wrote the supplier declaration **as Go code**
(`var _ = RegisterProtocol("caldav", Protocol{...})`) inside the supplier layer — internal
self-registration, which the standard below forbids. Its host-blind guard went green because it
measured a proxy ("does the host name a protocol"), not the goal ("is this a declaration").

## Vocabulary (use these names)

- **native key (原生密钥):** a key the backend issues to a block so the block may authenticate its
  privileged reach-back to the backend (the db bridge; the sandbox host_ops). Isolated: a block can
  only find its own.
- **non-native secret (非原生密钥):** an owner's third-party secret — a Telegram bot token, an SMTP
  password, a CalDAV password, an API key. Ordinary data, stored via the credential-manager block
  into db. The base gives it no special mechanism.

## The standard (invariants — every step is measured against these)

1. **Everything composed is a block, declared in data.** A manifest declares the whole interface:
   `provides`, `requires`, `host_ops`, `visitor_tools` / `owner_tools`, `config`. Behaviour is code;
   identity and wiring are data. Credentials are not here (rule 3). A block's **role** — supplier or
   consumer — is read from the declaration alone: `provides` non-empty ⇒ it supplies, `requires`
   non-empty ⇒ it consumes. **No structural special-casing: no supplier type, no supplier layer, no
   supplier-only registration or guard.** The role is a projection of the manifest, never a structural
   distinction.
2. **One registration door, sealed by a lint.** One interface registers a plugin, in
   `internal/routes/blockload`. A guard fails the build on any call to the plugin registry from
   elsewhere. There is no internal self-registration — a block does not register itself from inside
   the supplier layer.
3. **A block holds no state of its own.** A block that must persist `requires` the **db block** (db
   is an ordinary block — not special-cased). Credentials are the same: the **credential-manager is a
   block that `requires` db**; credentials are not a manifest field. A Telegram token or SMTP password
   is a **non-native secret** — ordinary data stored through credential-manager → db, given no special
   base treatment. The db block opens **one schema per bundle/fiber** (each composition that uses db),
   **named by the fiber**. Uninstall drops the schema (no orphan leak) **and warns of data loss — and
   the warning is a block too**.
4. **The backend's reach-back hand is an encrypted, keyed channel.** A block reaching back into the
   backend authenticates with a **native key** the backend issues it.
   - The db block's direct-db bridge (create/drop schema) is dangerous, so the channel is **strictly
     encrypted**. The native key authorizes **create**; on **delete** it confines the block to **only
     the schemas that key opened**; **bridge read/write** is likewise confined to those schemas.
   - The **sandbox `host_ops` reach-back uses a native key by the same mechanism and isolation** —
     only lighter, because it is less dangerous. Not "key vs no key"; the native key is the universal
     reach-back credential.
   - **Isolation.** A block can only find its own native key. The backend mints it at mount, bound to
     the fiber identity, into the fiber's own confined context — never into an enumerable shared
     table. A block cannot name another fiber's key (names are atoms; there is no get-by-id). Self-only
     holds **by construction**, not by a runtime check.
   - **Persistence.** What survives a remount is the `fiber identity → schema ownership` binding, held
     durably by the backend; the schema itself is durable in Postgres. The native key is a per-mount
     access token minted over that durable ownership. Remount → same fiber identity → same schema. The
     fiber's private context (its schema) is durable; the native key may be short-lived.
   - **No outward channel.** The native key never enters a visitor response, a rendered page, a tool
     result, a log line, an error, or another block. It is delivered only over the block's private,
     host-derived socket (`/run/standmeet/<id>.sock`, which the manifest cannot name). Three guards:
     (a) the native key is a **self-redacting Go type** — `String` / `MarshalJSON` return `***`, so a
     stray log or serialization leaks stars, not the value; (b) a **confinement guard** (modeled on
     `check-core-seals-only`, with a self-test) pins the type to the auth boundary; (c) `check-secrets`
     (gitleaks) backstops source and history. Defense in depth: a native key authorizes only its own
     schema, so even a leak is bounded to that fiber's data.
5. **A library enters as a block too.** Wire code — the CalDAV client, the SMTP wire — is delivered
   and registered as a block through the one door, not imported as bespoke host Go outside the block
   system.
6. **Externalization uses our own mechanism, not "MCP".** A sandboxed MCP server is one *transport*
   for an external block, not the definition of "external".
7. **If it can be externalized, it is a block.** The base reaches out only for the substrate. A seam
   with more than one provider has *all* of them as blocks (`google-calendar` is a block, so CalDAV
   must be; SMTP is externalizable, so SMTP is a block too).

## Seam resolution needs no manual ordering

Resolution is by name, recomputed at assembly. Registration order does not matter. A block goes
Active when its required seams are supplied (`L-Begin` fires because its premises hold); otherwise it
is simply not exposed. There is no load order to arrange (`fiber.go`: "there is no load order to
arrange").

## What violates the standard today

- **CalDAV is pure code with no declaration.** `internal/plugin/adapters/protocol_caldav.go` is 237
  lines of CalDAV client and there is no `backend/blocks/caldav/manifest.yaml` — a `calendar` provider
  as bespoke base code beside the `google-calendar` block.
- **Telegram is a Go shell around a token** (`protocol_telegram.go`).
- **The host selects protocol impls by name** — `switch m.Protocol` in
  `blockwire/supplier_register.go`, `switch protocol` in `credform.go`.
- **Persistence is a host_op, not a block.** `blockstore.*` over `blockdesk`; no bridge / native-key
  isolation model; nobody can `requires` it.
- **Registration is scattered in the composition root.** `DepRegistry.Register` from
  `cmd/server/blockwire`, not through one door.
- **"supplier" is reified as a special layer** — a `Supplier` interface, the `adapters` layer,
  `supplier_register.go`, `routes/supplier`, `check-supplier-boundary.sh`. It is only "a block whose
  `provides` is non-empty."

## Plan (test-first, green at each step; one effort, not separate rounds; bottom-up)

Order is bottom-up so the base lands first and leaf work is not reworked afterward.

1. **The door + the lint.** Name the one interface in `blockload`. Add a guard (ratchet + self-test)
   that fails on any registry call outside it. Move composition-root registration behind the door.
2. **The db block + native key + credential-manager block.** `blockstore` becomes a block (`provides`
   db; not special-cased): direct-db over an encrypted channel authenticated by a backend-issued
   native key; the key authorizes create and confines delete/bridge to its own schemas; schema per
   bundle/fiber, named by the fiber. Uninstall drops the schema (no leak) and a warning block reports
   the loss. The credential-manager becomes a block (`requires` db); credentials move off
   manifests/vaults into it. The native key is a self-redacting type; add its confinement guard. Wire
   the `Effect`/`Dispose` per `effects.md` (Dispose = the existing `blockstore.Store.Drop`), closing
   the orphan-schema leak.
3. **Telegram becomes a plugin.** Delete the Go shell; a manifest declares it; the token goes
   credential-manager → db as a non-native secret.
4. **CalDAV becomes a plugin.** Add the `blocks/caldav` manifest it has never had; the CalDAV client
   enters as a block (library-as-block) providing the `calendar` seam beside `google-calendar`.
5. **SMTP becomes a plugin.** The SMTP wire enters as a block providing the `mail` seam; credentials
   via credential-manager. No base-provided mail path survives.

As each member of the reified supplier layer moves to the uniform block mechanism, fold the layer
away (the `Supplier` type, `check-supplier-boundary`, etc.).

## Owner UI

The admin carries a plugin **nav group** with two views:

- **block** — the catalogue and per-block management: built-in, installed, and marketplace-installable
  block definitions; connect (credentials), config, enable/delete. This is today's "Suppliers"
  section, renamed: a supplier is just a block, so the view is **block**. The owner can also **author
  their own block by writing its declaration** (a manifest) — not only install a built-in or a
  marketplace one.
- **fiber** — the running instances. **To actually use a block, the owner goes to fiber**:
  instantiate it, mount it, compose it with others. `block` is "what exists"; `fiber` is "put it to
  work", and where the owner assembles the compositions they want. When a fiber's `requires` cannot
  all be met, the fiber view **resolves and shows what is still missing** — it names the seam that has
  no provider and the block the owner still needs to add or connect, instead of failing silently.
- **The composition is a graph.** A dependency is not a line, and not even always a tree — a block may
  `require` several seams, and providers are shared (one `smtp` feeds both `mail.send` and a booking's
  confirmation). The declared graph is not guaranteed acyclic; **resolution enforces a DAG — a cycle
  is detected, warned, and refused (the composition is not mounted).** The fiber view **draws that
  graph** for the owner.
- **Fibers can be built-in.** Some compositions ship as always-on built-in fibers (corpus retrieval,
  summarize, ask-visitor), not only owner-assembled ones.
- **Access codes attach fibers.** Which fibers a code admits is which tools its visitors get; the codes
  section wires fibers onto a code.

Block, fiber, and assembly are unfamiliar words to a lay owner, so **every control here carries a
thorough `(?)` help tooltip** — spelling out what a block is, what a fiber is, and how to assemble
one. Write these in detail; do not assume the owner knows the vocabulary.

Not to be confused with the two content composers: the résumé composer is **Puck**; **microsites are
written directly in React** on the SDK. Neither is the general block/fiber composer — that is the
fiber view.

## Tests

- **The lint is the structural gate.** Its self-test plants a `Register` call outside the door and
  requires red; the baseline only shrinks.
- **Native-key confinement, RED-first.** The confinement guard's self-test plants a use that writes
  the native key into a response / log / sandbox output and requires red. Assert the native-key type's
  `String` / `MarshalJSON` redact.
- **Native-key isolation, RED-first.** A block that tries to delete or read a schema it did not open
  is refused by the key. A block cannot obtain another fiber's native key (no get-by-id; the name is
  not computable).
- **Black-box e2e must not move.** Every step changes composition, not behaviour; the supplier / mail
  / telegram / calendar specs stay green, driven by real actions (a real test email, a real slot list,
  a real Telegram message).
- **The db block is a schema change.** Test the upgrade path (an existing owner's token / connection
  survives) and the new behaviour (uninstall drops the composition's schema, no orphan). A capability
  that moves house moves its test with it.
- **block / fiber is a new owner surface — test it both ways.** These controls did not exist before,
  so they need new e2e on **both** surfaces: (a) **GUI** — drive the real block / fiber panel: install
  / connect / configure / enable a block, assemble a fiber and assert it goes Active, and the `(?)`
  tooltips render; (b) **owner MCP** — the same block / fiber operations through the owner's AI-client
  toolset (list / install / connect / assemble / mount). Neither substitutes for the other; a
  GUI-only or MCP-only test leaves half the surface uncovered.
- **A cyclic composition is refused.** Declare a cycle in `requires`; resolution detects it, warns, and
  refuses to mount. RED-first: the cycle must be rejected, never silently mounted.

## Details still to pin

- **Native key implementation.** How it is minted / signed, how it binds to schema ownership, and its
  rotation and revocation. The mechanism is settled (rule 4); these are implementation details.
