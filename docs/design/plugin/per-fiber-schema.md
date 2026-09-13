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
   (`internal/plugin/nativekey`); this wires it so the reach-back delivers a per-fiber key. **This is
   defense-in-depth on top of (2)'s structural confinement, not the thing that provides isolation** —
   so it is the last batch, not a prerequisite for items 6/7.

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
  verbatim. This is the "基础零件".
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
