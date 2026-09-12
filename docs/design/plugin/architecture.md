# Architecture — where the code goes

Status: **2026-09-09.** Assumes `block-model.md`. Continues
`docs/design/backend-domain-modules.md`; where they differ, the merge of the two axes decided here
wins, and the reason is given.

## The layout

```
backend/
├─ internal/plugin/        the kernel. Loading, and nothing else.
├─ internal/<domain>/      corpus · conversation · access · owner · infra …
│                          NOT TOUCHED. Not one line.
└─ blocks/                 sibling of internal/, never inside it.
                           Every block, grouped by area.
```

**In `internal/` there are exactly two actions: create `plugin/`, delete `connector/` and
`capabilities/`.** Nothing else moves. `internal/infra/` in particular stays where it is and keeps
being imported — it is already the right shape (see *Block or library* below).

An **installed** block is not in the repository at all: it arrives at runtime and lives in a
directory on a data volume, the way `/srv/plugins/` already works. A source tree and a runtime store
are different things.

`blocks/` sits beside `internal/` so a built-in block has no more standing than an installed one —
it is simply pre-shipped. Under `internal/` ours would be importable where theirs is not: a
privileged core again, this time by directory.

## The kernel

```
internal/plugin/
    context.go     Context, realm, derivation, resolve a service by name
    fiber.go       one block's life: waiting · live · failed · torn down
    registry.go    the service table — one flat table, divergence at lookup
    mount.go       mount a bundle — the only entry point in the system
```

It knows no capability and no domain. Everything else is a block.

> **Where the code stands against this — 2026-09-11, honest rather than aspirational.**
>
> The two old axis packages **are deleted**, and `internal/plugin/` exists with the manifest, the
> loader, the seam resolver, the mount path and the realm derivation in it. The vocabulary rename
> has landed: one loaded block is a `Fiber`, a block that supplies a seam is a `Supplier`, the
> manifest field is `seam`, and the tables are `block_connections` / `block_enabled` /
> `code_block_denials` / `api_key_block_denials` / `api_open_blocks`
> (`db/migrations/2026-09-11-block-vocabulary.sql`).
>
> What still does **not** match: the kernel is not four files directly in `internal/plugin/` — it is
> sub-packages (`registry/`, `mount/`, `adapters/`, `blockstore/`, …). The file split is a shape
> difference, not a vocabulary one, and it is outstanding.

There is **no tier between the kernel and ordinary blocks** — no `generic/`, no `state/`. Inventing
one was the same mistake three times over (see *The recurring trap*). dsh has a vendored kernel of
nine files and, beside it, packages that are all peers.

## Blocks: definition, provider, consumer

Grouped by area, and within an area the three roles sit **side by side, no hierarchy**. This is
dsh's shape, read from its tree:

```
dsh          web/    web · web-fetch-http · web-search-exa
                     web-search-perplexity · web-search-deepseek · tool-web
             llm/    llm · llm-deepseek · llm-pi-ai · llm-retry · token-meter
             e2b/    e2b · fs-e2b · subprocess-e2b
```

Ours:

```
blocks/
├─ calendar/
│    calendar/           service definition — a name and its verb schemas. DATA, no logic
│    calendar-gcal/      provider
│    calendar-caldav/    provider
│    tool-calendar/      consumer — injects `tools`, exposes it to the agent
├─ mail/
│    mail/  mail-smtp/
├─ corpus/
│    tool-corpus-search/
├─ mcp/
│    mcp-client/         generic provider: spawns an external MCP server, registers its tools
├─ obsidian/
│    obsidian/           an ingest provider
├─ tools/                provides the `tools` service
├─ credentials/
└─ retry/  quota/  net/  cross-cutting providers, wrapping other providers
```

Two things to notice:

- **The service definition holds no logic** — a name and verb schemas. This is the existing design's
  "the category declaration becomes **data**, `contract.CalendarProxy` dies", now with a home.
- **Cross-cutting blocks are peers of vendor blocks**, not a layer above. `retry/` is a sibling of
  `calendar-gcal/`, exactly as dsh's `llm-retry` is a sibling of `llm-deepseek`.

## Block or library — the dividing line

Not *generic vs specific*. **Mounted vs imported.**

Verified by reading dsh's packages for `inject` / `extends Service`:

| dsh package | |
|---|---|
| `core/tools`, `fs/fs`, `fs/tool-fs-search`, `mcp/mcp-client` | **plugin** |
| `fs/fs-local`, `credentials`, `sandbox` | **library** — no inject, no Service |

A library is imported and called; a block is mounted and composed. The same capability often has
both: a thin plugin over a library, which is exactly `fs` (plugin) over `fs-local` (library).

This is why there is no generic tier. Reusable machinery — OpenAPI execution, the SMTP wire
protocol, a CalDAV client — is a **library**, sitting next to the block that uses it. Turning every
piece of machinery into a mountable block is what creates a caste of "blocks everyone must mount".

dsh keeps small named libraries too — `packages/util/` holds `crypto`, `http-proxy`, `timeout`,
`atomic-write`, `time`, `deque` — one small package each, not a grab-bag. **Our `internal/infra/` is
that, under another name**: `cryptobox`, `httpx`, `retry`, `storage`, `sandbox` are already separate
packages. Nothing to move, nothing to invent. New libraries go beside their block instead.

## How an agent's tools get loaded

**`tools` is a service, exactly like `calendar` or `net`.** A block that adds tools injects it and
registers into it. dsh's tool plugin is one line — `packages/fs/tool-fs-search/src/index.ts:70`:

```ts
export const inject = ['tools', 'systemPrompt', 'subprocess']
```

There is **no manifest field saying "I am an agent tool"**. Such a field is a second axis rebuilt:
one class of block with a slot no other block can fill.

```
session starts
  ├─ derive a realm — this session's private `tools`
  ├─ mount the bundle this code is bound to
  │    ├─ tools block         → provides `tools`
  │    ├─ mcp-client block    → injects `tools`; spawns the sandbox, asks tools/list, registers each
  │    └─ tool-corpus-search  → injects `tools`; registers corpus_search
  ├─ resolve `tools` in this realm → List() → a plain JSON list
  └─ hand that list to the conversation domain
```

The conversation domain **does not import the kernel**: it receives a list. `tools/call` returns the
same way — a name and opaque JSON, no typed surface.

The realm is load-bearing: each session gets its own `tools`, sessions run side by side in one
process, and the registry is **never copied per session** — one flat table, divergence at lookup.

### `capreg` does not shrink. It disappears.

| today | after |
|---|---|
| the registry itself | the `tools` service |
| `global ∧ role ∧ ¬code-deny` | **gone.** Mounted, or not mounted |
| `VisitorToolSpecs(...)` | `tools.List()` |
| `SystemPromptFragment(...)` | the `systemPrompt` service — inject and register, same shape |
| per-session binding table | the realm |
| `EnableGate` / `SessionGate` | ordinary mount failure. A tool whose connector is not connected is a block that did not mount, so it is not in the list |

That last row matters: `SessionGate` is a hook only capabilities have today — another second-axis
slot. Under the block shape it is the same thing as an unsatisfied dependency.

## What happens to the two deleted directories

| what it is | where it goes |
|---|---|
| the OpenAPI runner, OAuth, the sandboxed-MCP launcher, the egress-guarded client, `credform`, the SMTP and CalDAV clients | libraries, next to the blocks that use them |
| specific adapters — Obsidian, Telegram, a vendor connector | `blocks/`, as built-in blocks |
| **state** — `connection.go`, `connection_repo.go`, `connection_codec.go`, `capstore`, `capconfig` | a `credentials` / storage **block**, because a block may not hold its own state (`block-model.md`) and every block may need this |
| `Hub`, `Slots` | gone. Resolution by name is the kernel's; the type assertion was the typed surface |
| `integration.go`, `sync.go` | **leave** — a document's sync relationship with an external source is corpus's concern |
| `service.go`, `svc_*.go` | **leave** — admin orchestration is a controller, `internal/routes/` |

An earlier draft claimed everything in those directories was "either generic or data". Counting the
41 files disproved it: state is neither. **Count before claiming a partition.**

## Who mounts

One caller: whatever mounts a bundle.

```
at boot            → the owner's bundle
at session start   → the bundle this code is bound to
at page build      → this microsite's bundle
```

The hand-sequenced composition root disappears — order is derived, so a rule like "the connector
dispatcher must initialise before the plugin registry" becomes unrepresentable rather than
remembered.

## Dependency direction

```
blocks/*        ──▶  internal/plugin   (the kernel)
blocks/*        ──▶  their own libraries
blocks/*        ──▶  each other:  NEVER
internal/<domain>/ ──▶ nothing of the above
```

Blocks meet only on a service name, through a door that takes a name and opaque JSON. `retry` does
not know `calendar-gcal` exists, and `calendar-gcal` does not know `retry` exists. That is what
"they stack" means in code.

## Route through

The kernel is a new package that touches nothing, so it goes green on its own first. Then one block
at a time, starting with `net` — smallest, no dependencies — running the existing e2e after each.
The tool-list path moves last, because it drags the ACL specs, and those **should** change: the rule
changed (`access-control.md`).

## The recurring trap

Three times in one session the same move produced a wrong design: **giving one class of block a slot
no other block can fill.**

- a trust level the owner grants to some blocks and not others;
- a manifest field saying "I am an agent tool";
- a `generic/` tier between the kernel and ordinary blocks (and its twin, `state/`).

Each looked like tidy structure and each rebuilt the two axes under a new name. The test: **can every
block fill this slot?** If not, it is an axis.
