# Per-fiber schema — design + test matrix (everything-is-a-block items 6, 7, 41, 42, 44)

Status: **design, 2026-09-13.** Companion to `everything-is-a-block.md` (rule 3, rule 4) and
`everything-is-a-block-tests.md` (Stage 2 items 6/7, adversarial 41/42/44).

## Why this doc exists

Items 6/7 (and the adversarial 41/42/44 that sit on them) are the one part of the plan not built.
They are not a bounded test-writing task: they require a **fiber identity** threaded through the mount
→ storage-binding → schema → provisioning lifecycle, and today every one of those is hardcoded to the
**block id**. This is a multi-subsystem change that cannot go green in one commit, so — per the
project's decide-then-drive rule — the design and test matrix are pinned first, then executed in
individually-green batches.

## Ground truth today (citations)

- Schema is `mcp_<sanitized id>`, derived purely from host-trusted `(kind, id)` —
  `internal/plugin/blockstore/schema.go:61`. **The blockstore primitive already accepts an arbitrary
  id**; it is not the thing that needs changing.
- Every live caller passes the **block id** (`m.ID`):
  - provisioning: `cmd/server/blockwire/storage.go:54` `store.Provision(ctx, KindMCP, m.ID)`, called at
    startup per builtin and on install (`installed_mount.go:36`), **once, not per session**.
  - the reach-back binding: `cmd/server/blockwire/per_block.go:36`
    `boundBlockStore{store, KindMCP, id: m.ID}` — bound at **mount time**, process-global.
  - config binding: `blockconfig.New(store, KindMCP, blockID)` (`storage.go:203`).
  - install uniqueness: `installed_blocks UNIQUE(owner_id, block_id)` — one row per (owner, block);
    re-install is an upsert, never a second instance.
- The reach-back socket is **already confined by construction**: `blockdesk.BoundStore`
  (`internal/routes/blockdesk/store_socket.go:18`) has **no kind/id/schema parameter** — the host
  binds it to one namespace before handing it over. A block literally cannot name another's schema.
  → **item 7's isolation property holds today by construction**; what is missing is a *second* fiber to
  be isolated *from*.
- The `effect` calculus (`internal/plugin/effect/`) models fibers + multi-instantiation
  (`fiber.go:106`) but **every method panics and nothing in production imports it** — a formal model,
  not wiring.
- Bundles exist: `bundles(id uuid PK, owner_id, name, UNIQUE(owner_id,name))`, membership
  `bundle_blocks(bundle_id, block_id)`; a **block can be in several bundles**; a code points at a bundle
  via `access_codes.bundle_id`. `bundles.id` is a per-owner, per-composition id.

## The decision: the fiber identity is the **bundle**

Rule 3 says "one schema per **bundle**/fiber (each composition that uses db)". The product's existing
unit of composition is the **bundle**. So:

> A storing block used within a bundle gets a schema keyed by **(bundle_id, block_id)**, not by
> block_id alone. Two bundles that each contain the storing block get **two distinct schemas**.

This realizes item 6 on the substrate that already exists (bundles), instead of building a whole new
multi-instantiation runtime from the unwired `effect` calculus. A "fiber" in the running product **is**
a bundle's mount of a block.

**Default fiber (no bundle).** A block reached without a bundle (a code with `bundle_id = NULL`, or a
builtin used directly) keeps a single owner-default schema. Its fiber id is a reserved sentinel
(`_root`), so its schema name is stable and never collides with a real bundle uuid. This keeps every
current caller working (today's `mcp_<block>` becomes the `_root` fiber's schema) — the change is
additive, not a migration of existing data on the happy path.

### Schema name

`schemaName(kind, fiberID)` where `fiberID = "<bundleShort>__<blockSuffix>"` for a bundle mount, and
`"root__<blockSuffix>"` for the default. Still `^(supplier|mcp|microsite)_[a-z0-9_]+$` after
sanitising — the DROP guard is unchanged. `bundleShort` = the bundle uuid with dashes stripped (already
`[a-z0-9]`).

## What threads where (the build)

1. **Session carries the fiber id.** `mount/session.go`'s per-session context gains `FiberID` (derived
   at assembly from the visitor's `bundle_id`, `_root` when none). Assembly already has the code →
   bundle.
2. **The store/config binding moves from mount-time to assembly-time.** Today `per_block.go` binds
   `boundBlockStore{id: m.ID}` once at mount (global). It must bind `{id: fiberID}` per assembled
   session, so a visitor on bundle A and a visitor on bundle B reach different schemas of the same
   block. This is the load-bearing change.
3. **Provisioning becomes lazy + per-fiber.** Instead of provisioning `mcp_<block>` once at
   install/startup, provision `mcp_<fiber>` on first write for that fiber (or when a bundle gains the
   storing block). `CREATE SCHEMA IF NOT EXISTS` stays idempotent.
4. **Uninstall / bundle-delete drops the fiber's schema(s).** Deleting a bundle drops every
   `mcp_<bundle>__*`; uninstalling a block drops its `_root` schema and each bundle's schema for it.
   Extends today's `blockOps.uninstall` drop (item 8) to the fiber set. Data-loss warning (item 9)
   fires per dropped fiber that held rows.
5. **Native key (rule 4) is minted at mount, bound to the fiber id.** The issuer exists
   (`internal/plugin/nativekey`); this wires it so the reach-back delivers a per-fiber key.

## Trust model (corrected 2026-09-13 after reading the socket path)

The host-side store handler receives the fiber identity **from the request**: the host plants the
`SessionContext` on the tool call's `_meta`, and the **sandboxed plugin forwards it** to the per-block
socket (`internal/infra/hostsocket/server.go:16-18`). This is already how per-owner config resolves —
`internal/routes/blockdesk/config_socket.go:53` decodes `owner_id` from the request and trusts it.

Consequence, in two parts:

- **Item 6 (a per-fiber schema exists) ships at the existing trust level.** Keying storage by the
  forwarded `(owner, bundle)` is exactly as trusted as config today — not a new assumption.
- **Items 7/41/42 (isolation against a block that FORGES the forwarded id) require the native key.**
  A malicious block controls what it forwards, so it could claim another fiber's `(owner, bundle)` and
  reach that schema. The forwarded-identity trust is therefore a **latent cross-owner hole that already
  exists for config and billing**, and rule 4's native key — host-minted, unforgeable, resolved
  host-side to the fiber — is the **systemic fix for all of them**. So the native key is the isolation
  mechanism the adversarial items need, not defense-in-depth, and it closes config's existing hole too.

## Batches (corrected order)

- **B1 — per-fiber schema (item 6).** The store socket request carries the fiber id (forwarded like
  `owner_id` in config_socket); `boundBlockStore` resolves the schema from it per op; lazy provision.
  Fiber = the code's bundle, else `root_<owner>` (so no-bundle codes stay per-owner-unified, and the
  cross-owner sharing of `mcp_<block>` is fixed on the way). **Migration**: the sole existing owner's
  `mcp_<block>` data moves to its `root_<owner>__<block>` schema — tested with real old data
  (schema-lives-in-the-volume). e2e: two bundles for one owner → two schemas; owner-A data not visible
  to owner B.
- **B2 — lifecycle (item 9 extend).** Bundle-delete / uninstall drop the fiber schema set + per-fiber
  data-loss warning.
- **B3 — native key at mount (rule 4) → items 7/41/42/44.** Mint the per-fiber native key at mount;
  the reach-back authenticates with it; the store handler resolves the fiber from the **key**, not from
  the forwarded plaintext, closing the forgery hole (config + storage). Adversarial e2e: a block that
  forges `(owner, bundle)` is refused; there is no get-by-id for another fiber's key. Add the
  legitimate `.Reveal()` caller to `check-native-key-confined` ALLOWED.

(The obsolete "native key last / defense-in-depth" framing above is superseded by this section.)

## Test matrix

Black-box e2e primary; a DB-integration UT where a primitive is faster to pin. RED-first: each states
what fails before the code exists.

- **6 — schema per fiber (e2e).** Two bundles for one owner, both containing the storing block; a
  visitor on each writes one doc. `querySQL`: exactly two schemas `mcp_<bundleA>__<block>` and
  `mcp_<bundleB>__<block>` exist, one row each. RED today: one shared `mcp_<block>` with two rows.
- **7 — fiber isolation (e2e, adversarial).** The bundle-A visitor's block, driven to query, sees only
  A's row, never B's; there is no socket parameter by which it could name B's schema (assert the read
  returns only A's doc; assert the tool surface exposes no schema/collection-of-another param). RED:
  a shared schema returns both rows.
- **41 — db cross-schema (adversarial).** A block actively attempts `other_schema.table`, `SET
  search_path`, `information_schema` enumeration of another fiber's schema, `DROP` of a schema it did
  not open — all refused/empty. RED: without per-fiber binding, "another fiber's schema" is the same
  schema and the read returns rows. (Now reachable because item 6 creates a *second* schema to target.)
- **42 — native-key theft (adversarial).** A fiber cannot obtain another fiber's native key (no
  get-by-id; the name is an atom, `_root`/bundle-derived but not enumerable), cannot reuse a
  post-unmount key. RED: an enumerable key table returns another fiber's key. (Batch 5.)
- **44 — cross-block socket (adversarial).** A block cannot dial another block's reach-back socket —
  the path is host-derived (`/run/standmeet/<id>.sock`), the manifest cannot name another's. Assert the
  attempt has no path. (Structural; provable once two fibers/sockets coexist.)
- **9 (extend) — data-loss warning per fiber.** Dropping a bundle that held rows raises the persistent
  warning naming the fiber. Extends the existing item-9 coverage.

## Batches (each individually green, test-first, self-committed)

- **B1 — fiber-id derivation (UT + wiring, no behavior change).** Introduce `FiberID` (a small type),
  `RootFiber` sentinel, and `fiberSchemaID(fiberID, blockID)`; UT the derivation + the `_root`
  back-compat (today's `mcp_<block>` == the `_root` fiber). No caller changes yet → suite green
  verbatim. This is the "basic part".
- **B2 — session + assembly carry FiberID.** Thread bundle → FiberID into `session.go`; default `_root`.
  Parity: the whole agent-use suite stays green verbatim (FiberID present, still `_root` everywhere).
- **B3 — per-fiber binding + provisioning (item 6/7 e2e).** Move the store/config binding to
  assembly-time keyed by FiberID; lazy per-fiber provision. Lands the item 6 + 7 e2e GREEN.
- **B4 — lifecycle (item 9 extend).** Bundle-delete / uninstall drop the fiber schema set + per-fiber
  data-loss warning. e2e + `querySQL` gone.
- **B5 — native key at mount (rule 4, items 42; hardens 7/41/44).** Mint the per-fiber native key at
  mount via the issuer; the reach-back authenticates with it; add the legitimate `.Reveal()` caller to
  `check-native-key-confined` ALLOWED. Adversarial 41/42/44 e2e GREEN.

## Open questions to resolve during B1/B2

- Does `access_codes.bundle_id` reach assembly cleanly, or does the role snapshot need to carry it?
  (B2 answers by reading the assembly input.)
- Multi-tenant note: today `mcp_<block>` omits owner_id — one schema shared across owners. Per-fiber by
  bundle uuid (globally unique) incidentally makes storage per-owner too. The `_root` default must
  therefore key on owner as well (`root_<owner>__<block>`) to preserve per-owner isolation for
  no-bundle blocks — confirm in B1.

## Execution plan (2026-10-02) — decided, supersedes the batch lists above

Owner 2026-10-02: "do it, but first settle which tests must be written and run, and which code
structure marks each checkpoint". Ground truth re-read the same day (it corrects this doc and the
ledger):

- The booker is `infra/plugins/booker/booker-mcp.js` (JS), not Go. It forwards no `fiber_id`.
- Native keys are **already minted** per fiber at dial (`mount/mounted_dial.go:45`) and for owner
  tools (`mount/owner_tools.go:60`, fiber `root_<owner>`), and verified at the host socket — but
  `hostsocket/server.go checkKey` **discards the fiber the key resolves to**. The store still trusts
  the forwarded plaintext.
- The owner-tool key and a no-bundle visitor's key both resolve to `root_<owner>`: the host cannot
  tell "owner, fan out" from "root visitor".
- Slot holds (F-B-15) live in the claims table of whatever schema the call lands in. Per-fiber claims
  would let two bundles' visitors take the same slot.
- Block config (`blockconfig`) lives in the legacy `mcp_<block>` schema and stays there.
- Found while planning, fixed first (checkpoint 0): `bookings_list` and `calendar_cancel_booking` were
  visitor tools — a granted visitor read every booking's name and email and could cancel any.

### Decisions

1. **The key is the identity.** The host socket passes the fiber its key resolves to into the
   handler; the store ignores any `fiber_id` the block sends. The booker needs no change for routing.
2. **Owner calls get their own fiber**, `owner_<owner>`, minted for owner tools only. A store call on
   an owner fiber **fans out** across the owner's fibers (root + every bundle that holds the block):
   reads union the schemas; delete-by-id finds the schema holding the id.
3. **Claims never split by fiber**: claim/release always use the block's legacy schema
   (`mcp_<block>`), whatever fiber calls, so F-B-15 holds across bundles. The claim key carries its
   own scope (the booker puts the owner id in it), so one table serves every owner.
4. **Quota counts the calling fiber's schema** (`max_bookings` is per code; a code has one fiber).
5. **Rebinding a code to another bundle** starts a new fiber for new bookings. Old bookings stay
   visible and cancellable to the owner (fan-out); a visitor's conversation-scoped cancel of a booking
   made under the old bundle no longer finds it. Accepted and documented; rebinding mid-conversation
   is rare.
6. **Schema names fit without merging**: a name over Postgres's 63 bytes keeps its first 54 bytes
   plus 8 hex digits of the whole name's sha256 (`blockstore.fitSchemaName`). Postgres would cut it
   silently and fold two fibers into one schema; refusing it instead (the first plan) broke every
   block whose id is 15+ characters, since `root_<uuid>_` alone is 42 bytes.

### Checkpoints (each green, committed, before the next)

| # | Code structure that marks it done | Proven by |
|---|---|---|
| 0 | `Manifest.OwnerOnlyTools()`; the visitor binding drops them; booker refuses list/cancel-by-id on a visitor `_meta` | e2e `booking-owner-tools-not-for-visitors` (red before) |
| 1 | `hostsocket` hands the key's fiber to the handler; `blockdesk` store/claim handlers read only that; owner tools mint `owner_<id>` | UT: a forged `fiber_id` in the request is replaced by the key's; e2e item 8 adversary |
| 2 | `boundBlockStore` routes by the key's fiber; claim/release pinned to the owner root; schema-name length guard | e2e T1 (two bundles → two schemas), T5 (slot race across bundles) |
| 3 | `blockstore` gains a schema-listing op (leaf, pgx only); owner-fiber reads fan out; delete-by-id across fibers | e2e T3 (owner lists and cancels both bundles' bookings) |
| 4 | `blockquota` counts the calling fiber | e2e T4 (max_bookings in a bundle) |
| 5 | bundle delete drops `mcp_b_<bundle>_*` with the data-loss warning; uninstall drops every fiber schema of the block | e2e T6 |
| 6 | SQL migration moves the sole owner's bookings/confirmations from `mcp_<block>` to `mcp_root_<owner>_<block>` (config collections stay), `to_regclass`-guarded | e2e T7 upgrade spec with real old rows |
| 7 | `resetInstance` drops fiber schemas so specs start clean | the T-specs pass twice in a row |

### Tests to write (red on the code before their checkpoint)

- **T1** two bundles, each with calendar.book; a visitor on each books → exactly
  `mcp_b_<A>_calendar_book` and `mcp_b_<B>_calendar_book` hold one booking each.
- **T2** visitor A's conversation-scoped cancel / send_confirmation never touch B's booking.
- **T3** the owner (API token) lists both bookings and cancels B's by id.
- **T4** `max_bookings=1` on a bundle code hides the tool after one booking.
- **T5** two bundles' visitors ask for the same slot at once → one booking.
- **T6** deleting bundle A drops its schema and raises the warning naming the dropped records.
- **T7** upgrade: a booking stored on the old shape survives; the owner lists it; its visitor cancels it.
- **T8** adversary block sends another fiber's id → it reaches only its own schema.

### Status (2026-10-02): built

| # | Where it landed |
|---|---|
| 0 | `Manifest.OwnerOnlyTools`, `mount.visitorFacing`, booker `ownerOnly` (v0.1.112) |
| 1 | `hostop.CallerFiber`; `hostsocket.dispatch` puts the key's fiber on the ctx; `blockdesk` reads only it; owner tools mint `registry.OwnerFiber` |
| 2–3 | `blockwire/bound_store.go`: write → own fiber (owner → root), owner reads fan out over `OwnerFibers` ∩ `blockstore.Existing`, claims in the legacy schema |
| 4 | `blockquota.Counter.Allow/Remaining(fiber, …)` count in `FiberSchemaID(fiber, block)` |
| 5 | `blockwire/fiber_lifecycle.go`: bundle delete drops `b_<bundle>` of every storing block; uninstall drops legacy + every owner fiber; data-loss warning per drop |
| 6 | `blockwire/fiber_migrate.go` at boot (after installed blocks restore): legacy non-`blockconfig*` records → the sole owner's root fiber |
| 7 | e2e `resetInstance` drops `mcp_(b|root)_*`; `blockstore`'s provisioned cache is package-wide and cleared on `Drop` |

Specs: `booking-per-fiber-storage` (T1–T6), `upgrade-per-fiber-storage` (T7),
`security-fiber-forgery` (T8). Found on the way and fixed: an owner-installed block that orders
host ops was never given its socket (only builtins were served), so it could not start —
`deps.ServeHostOps`, called from `MountInstalledBlockAs`.

### Existing specs to re-run after the last checkpoint

All booking specs (`chat-book-*`, `visitor-cancel-booking`, `visitor-reschedule-booking`,
`tool-calendar-cancel-booking`, `booking-*`, `api-key-booking-*`, `quota-not-consumed-on-failure`,
`chat-quota-exhausted-tells-the-model`, `tool-endpoint-calendar-book`, `mcp-skill-grant-booking`,
`supplier-err-confirmation-fail-booking-kept`), bundles (`acl-bundle-additive`, `session-block-bundle`,
`b3-bundle-blocks`), lifecycle (`block-uninstall-drops-schema`, `uninstall-data-loss-warning`,
`block-delete-relied-refused`), `security-block-isolation-adversarial`, `upgrade-block-vocabulary`,
`upgrade-bundle-includes`, `norm-outward-toolset`, `owner-mcp-parity-reads`, the dsh specs; Go UT
(`nativekey`, `hostsocket`, `blockstore`, `blockwire`, `registry`, eval-harness booker assembly);
`make lint`; then the full suite once, since the change crosses every storing call.
