# Everything is a block — test plan

Companion to `everything-is-a-block.md`. Test-first, small commits: each item states its **RED**
(what makes it fail before the code exists) and its **assertion** (the observable marker). Discipline
from `CLAUDE.md` + memory: **black-box e2e is primary** (drive a real owner/visitor/MCP action, assert
a rendered or queried marker — never "didn't crash"); **guards self-test** (a planted violation must go
red); **no absence tests**; **agent-use parity** (built-in-fiber specs stay green verbatim). One stage,
one commit or a few; bottom-up.

## Stage 1 — the door + the lint

Registration lives in one place; a guard forbids it anywhere else.

1. **`check-register-via-door` guard (RED-first).** New guard scans for `reg.Register(` /
   `reg.MustRegister(` / `depReg.Register(` outside `internal/routes/blockload` and the `registry`
   package. Self-test: plant such a call in a non-door package → guard red; remove → green. Baseline is
   shrink-only. RED today: it flags `cmd/server/blockwire/supplier_register.go:100` and
   `internal/owner/jobs/jobs.go:106-108`.
2. **Registration moved behind the door.** Move the seam-provider registration (blockwire) and the job
   fibers (owner/jobs) into `blockload`. GREEN: guard baseline reaches 0.
3. **No behaviour change (black-box).** The whole agent-use + owner suite stays green **verbatim** —
   registration moved, not what is registered.

## Stage 2 — db block + native key + credential-manager

The foundation everything stateful stands on. This wires the effect calculus (`internal/plugin/effect`
is contract-only today) far enough to provision/drop a schema as an `Effect`.

Unit / guard:

4. **Native-key type redacts (unit).** `String()` / `MarshalJSON()` / `MarshalText()` on the native-key
   type return `***`. RED: a plain `string` alias leaks the value; assert the redaction.
5. **Native-key confinement guard (RED-first).** New guard (modeled on `check-core-seals-only`, with a
   self-test): the native-key type may appear only in the reach-back auth package. Plant a use in a
   response / log / serializer package → red.

e2e (real Postgres, real mount):

6. **Schema is per bundle/fiber, named by the fiber.** Mount two fibers of a storing block for one
   owner → two distinct schemas. `querySQL` asserts two schemas exist, each named from its fiber id.
7. **Native-key isolation (RED-first).** A fiber that tries to read or drop a schema it did **not** open
   is refused (assert the op errors / returns empty). A block cannot obtain another fiber's native key
   — there is no get-by-id; assert the attempt has no path to succeed.
8. **Uninstall drops the schema, no orphan (RED-first).** Install a storing block, write a doc,
   uninstall → its schema is gone (`querySQL`: schema absent). RED today: `assembly.Repo.Uninstall`
   leaves it (the measured `mcp_acme_widget_zzfixture` leak). GREEN once Dispose = `blockstore.Store.Drop`.
9. **Data-loss warning is a block.** Uninstall-with-data → the owner sees a persistent warning surfaced
   by the warning block; assert it renders in admin.
10. **Upgrade path.** An existing owner's stored connection/token survives the blockstore→db-block move:
    seed on the old shape, `restartBackend` (= deploy), the data still resolves.
11. **credential-manager is a block requiring db.** A non-native secret (a token) stored via
    credential-manager → db round-trips: write then read back the same value. RED: the old per-supplier
    vault path.

## Stage 3 — telegram → plugin

12. **Declared, Go shell gone.** `blocks/telegram/manifest.yaml` present; no `telegramSupplier` /
    `telegramVaultAdapter` Go; host-blind baseline drops `telegram`.
13. **Parity: telegram still works.** `im-config-telegram` stays green **verbatim** — owner saves a
    token (now a non-native secret via credential-manager → db), the im-bridge reads it, the bot runs.

## Stage 4 — caldav → plugin

14. **caldav gets the manifest it never had.** `blocks/caldav/manifest.yaml` (provides `calendar`); the
    CalDAV client enters as a block (library-as-block). Host-blind: no `caldav` literal in host.
15. **Parity: calendar still works.** Calendar connect + `chat-book-*` stay green **verbatim**, caldav a
    block beside `google-calendar` on the same seam.

## Stage 5 — smtp → plugin

16. **smtp as a block.** provides `mail`; credentials via credential-manager; no base-provided mail path
    survives. Host-blind baseline reaches 0.
17. **Parity: mail still works.** `supplier-happy-matrix` / `-send-confirmation` / `mail-supplier` /
    `booking-confirmation-email` stay green **verbatim**.

## Cross-cutting (assert across the whole refactor)

18. **Agent-use parity.** Built-in-fiber specs — `chat-book-success` / `chat-book-conflict-*`,
    `visitor-chat-*`, `supplier-happy-matrix` / `-send-confirmation` / `-provider-agnostic`, `block-*`
    lifecycle, and the `norm-outward-toolset` tools/list golden — stay green **verbatim** (editing one
    to pass is a behaviour leak). Exception: a spec that assembles its own non-built-in fiber must mount
    it first.
19. **Agent sees only Active fibers (new).** An unmounted / inactive fiber's tools are absent from the
    agent's list and un-invokable; mounting makes them appear.
20. **Cyclic composition refused (RED-first).** Declare a cycle in `requires` → resolution detects it,
    warns, refuses to mount. Never silently mounted.
21. **Seam resolution is order-independent.** Register providers in different orders → identical
    resolved set; a block goes Active when its `requires` are supplied, regardless of registration order.
22. **Host-blind guard at 0.** No protocol or block literal in host Go.
23. **Supplier layer folded.** As members move to the uniform block mechanism, the `Supplier` type and
    `check-supplier-boundary` are removed; no supplier-only path is reintroduced.

## Owner UI (block / fiber panel)

24. **block view — GUI e2e.** Drive the real panel: list blocks; connect (fill credentials); config (a
    manifest-declared field saved then read back); enable/disable; **write your own** (author a block
    from a declaration and see it listed). Assert real effects, not just visibility.
25. **fiber view — GUI e2e.** New fiber: pick a block, mount, assert it goes **Active**; resolve-missing
    (a block whose `requires` is unmet → the "还差 X" prompt appears); the dependency graph renders
    (mermaid node present). Assert markers.
26. **owner MCP — e2e.** The same block/fiber operations through the owner's MCP toolset (list / install
    / connect / assemble / mount). Both surfaces; neither substitutes for the other.
27. **(?) tooltips render** the how-to steps.

## Block & fiber CRUD — happy, edge, error (e2e, black-box, both GUI and owner MCP)

Happy flow (drive the real panel / MCP; assert the real effect, not visibility):

29. Block **install / connect / config / enable / delete a non-built-in** each work end to end — block
    appears / disappears, connected badge flips, a config value is saved then read back.
30. Fiber **assemble → Active**, **unmount → gone**.

Edge / error (RED-first: prove the *wrong* reaction — allowing it — fails before the guard; then assert
the *correct* reaction; each error is user-friendly, never a stack trace):

31. **Delete a built-in** → the delete control is absent / the op is refused.
32. **Delete a block a fiber uses** → refused, the fiber named.
33. **Unmount or deactivate a relied-upon fiber** → refused / toggle locked, the dependent named.
34. **Delete or unmount with data** → data-loss modal; confirm Drops the schema (`querySQL`: gone),
    cancel keeps it.
35. **Assemble with unmet deps** → "还差 X", no mount.
36. **Assemble a cycle** → refused.
37. **Bad credential on connect** → friendly error, stays disconnected.
38. **Invalid owner-written declaration** → validation error, not installed.
39. **Disable a block under a mounted fiber** → the fiber loses it, dependents go inactive, a warning
    shows.
40. **A block dies mid-action** → the three faces: tool absent from the agent, visitor told honestly,
    owner gets a persistent entry (`block-failure-three-faces`).

The destructive / edge ops run over the owner MCP too, with the same reactions.

## Koishi POC (validate the works-today piggyback)

28. **A real third-party Koishi plugin, used by an agent, for real.** Wrap a real `koishi-plugin-*` as
    a stdio-MCP server (Koishi core + `@koishijs/plugin-mock` to drive it headlessly + the MCP SDK);
    declare it in `infra/dev-plugins.json` like `server-everything`; grant it to a code; drive the agent
    to call its tool; assert the real Koishi-computed result surfaces (the scripted reply renders only if
    the real tool ran — the `real-third-party-mcp-loader` pattern). Credit the plugin author in the
    wrapper header, a `CREDITS`, and `everything-is-a-block.md`.

## How each stage lands

Bottom-up, test-first, small commits: **1 → 2 → 3 → 4 → 5**, cross-cutting asserted continuously, owner
UI after its backend exists, Koishi POC independently (it rides the existing external-MCP path). A stage
is done when its own tests are green **and** the parity suite is green verbatim.
