# Isolation and trust

Status: **2026-09-09.** Where the compartments are, what a permission is, and what happens on the
one surface where no compartment can be drawn. Assumes `block-model.md`'s vocabulary.

## The bulkhead is per block, not per tenant

**Single-owner continues**, and it does **not** govern the bulkhead. The compartment is **per
microsite and per plugin**: two microsites belonging to the same owner still get their own. That is
what watertight means. The cost model follows — N compartments per instance, so **cheap matters more
than strongest**, up to the point where cheapness stops being watertight.

**The owner decides a block's trust level**, and the default is closed: a block is sandboxed unless
the owner explicitly grants in-process trust. Omission fails closed for a second, structural reason
too — a block reaches only what the `ctx` its parent handed it carries, so forgetting to grant
something yields nothing, not everything.

Note what the in-process layer is and is not: `ctx` is **least privilege**, not confinement. A Node
or Go block can ignore it and reach the filesystem directly. Enforcement is the process boundary;
`ctx` is the declaration. They stack — a block's `ctx.fs` may itself be a proxy into a confined
process, which is dsh's `fs-e2b` shape.

Worth stealing: dsh audits leaks **continuously**, not once at mount, because a row can publish a
global service later "from a timer, or an asynchronous continuation after its plugin returned".

**The isolation primitive is settled by what we already run: bwrap.** It is in production, and
requiring it of a self-hoster costs nothing extra. gVisor and Firecracker are what to research *if*
bwrap proves insufficient — and whether it does cannot be known until the compartment parameters in
this document are written.

## A permission is a block, not a flag

**A permission is not a field on a plugin; it is an atomic block the plugin's bundle mounts.**

Today a sandbox is two knobs buried in a transport config:

```json
"sandbox": { "plugin_dir": "/srv/plugins/fetch", "allow_net": true }
```

Our own tree shows why that is the wrong shape. `netfetch` and `cagedfetch` are **byte-identical
declarations differing in one boolean**, and `provision.sh` says so outright: *"shared by both
netfetch (allow_net) and cagedfetch (--network=none); they read the same immutable code, differ only
in network policy."* Same code, different policy — that is not two plugins, it is **one block and
two bundles**, and today we copy the whole declaration to express it.

So the compartment's dimensions become blocks:

```
bundle "google-calendar-connector"
  ├── net(allow: ["www.googleapis.com"])      explicit, visible, auditable
  ├── credentials(ref: "owner:gcal-oauth")    who can reach the owner's token is a list
  └── gcal-adapter                            pure adapter; never touches credential storage
```

Four things this buys, none of which a boolean field can:

| | flag today | block |
|---|---|---|
| visibility | `allow_net: true` inside a transport config | an entry in the bundle — the owner assembling it **sees** that network is included |
| granularity | true/false | `net(allow: [...])` — a connector reaches exactly one vendor |
| audit | a special-case check for one field | the same question as everything else: *which entries does this bundle contain* |
| composition | one boolean per new dimension | mount what you need; mount nothing and you have nothing |

And the default is closed **structurally**, not by a default value: no `net` entry means no network.
This is `ctx`-as-capability-list extended to the process-sandbox dimension — one way of expressing
"you have it because you were handed it", instead of two.

Credentials matter most here. Today they are spread through `credform.go` and the connection row; as
a block, the adapter receives an **already-provisioned call surface** rather than reaching into a
credential store, and "which blocks can touch the owner's Google token" becomes a list to read
rather than code to audit.

**The parameters are not ours to invent either.** An earlier draft treated this as vocabulary
design; it is a mapping onto two mechanisms we already run:

| block | what implements it today |
|---|---|
| `fs(read: …)` | bwrap `--ro-bind` |
| `fs(write: …)` | bwrap `--bind` |
| `fs(discard-on-exit)` | bwrap `--tmpfs` |
| `net()` **absent** | bwrap `--unshare-net` — all or nothing, which is the right shape for a sandboxed plugin |
| `net(allow: [hosts])` | **already exists** for connectors: `connector/egress.go` — `NewEgressAllow(hosts)`, `GuardedHTTPClient()`, plus `pinnedDialAddr` / `resolveSafeIP` / `isInternalIP`, which also defeat DNS rebinding and block internal addresses. Host-granular, at the HTTP client layer, not the network namespace |
| `credentials(ref: …)` | today spread through `credform.go` and the connection row |
| `limits(cpu/mem/wall)` | **not in bwrap**; cgroup or ulimit — the one unmapped row |

So there are **two egress mechanisms at two layers**, both correct for their side: namespace-level
all-or-nothing for a sandboxed plugin, host-level allowlisting for a connector speaking to one
vendor. The block parameters expose what exists rather than defining something new.

---

# Browser-side isolation — DECIDED 2026-09-09

Once a block can ship JS onto a microsite, third-party code shares an origin with the visitor's
credentials. The browser offers one isolation boundary — the origin — and a *library* cannot be moved
across it, because being called from the owner's code is what makes it a library.

## What is actually on the page

Measured, not assumed:

| where | what |
|---|---|
| `localStorage['standmeet:visitor-session']` | `session_token`, `conversation_id`, `system_prompt_part_ids`, `system_prompt_persona`, `dock_buttons` |
| `localStorage['standmeet:byoai:v2']` | the visitor's own LLM API key as ciphertext `{iv, ct}`, plus provider/endpoint/model in clear |
| IndexedDB `standmeet-byoai/wrap/v1` | a **non-extractable** AES-256-GCM `CryptoKey` |

**There is no visitor cookie.** Cookies are owner-side only — `smt_session` (HttpOnly) plus a
double-submit CSRF cookie, `routes/admin/auth.go:97`.

**The valuable secret is the visitor's own API key, and it is already defended.**
`app/src/lib/gate/byoai-vault.ts:5-17` splits ciphertext (localStorage) from a non-extractable key
(IndexedDB): "even if XSS gets an indexedDB handle, it can only call encrypt/decrypt, never export
the key"; either store alone is useless. Note also that `session_token` is not merely a bearer —
`infra/cryptobox/envelope.go:5-8` uses it as HKDF input material for the BYOAI envelope, "the only
secret the browser and server share".

That defends **taking a secret away**. It does not defend **using it in place**: page code can call
decrypt and hold plaintext briefly. **The gap is exactly that plaintext moment, and nothing stops it
leaving — there is zero CSP in the tree.**

## Prior art — three references answering three different questions

| who | isolates | how | what they paid |
|---|---|---|---|
| **MetaMask / LavaMoat** | libraries in their own dependency tree | SES `lockdown()` freezing intrinsics, one Compartment per package, per-package policy | a generated policy file to maintain |
| **Figma** | third-party plugins that read/write the document | **QuickJS cross-compiled to WASM** — the plugin runs in a *different JS engine* | slower; changing architecture was "disruptive to our developers" |
| **Shopify Web Pixels** | third-party analytics scripts | one sandboxed iframe per pixel, no shared cookies/localStorage/DOM, events pushed in over a messaging API | openly: "some third-party pixels may not work" |

**Figma's incident buys the criterion.** They started on the Realms shim — a boundary drawn *inside*
one JS VM — and abandoned it, because that shim "uses the same JavaScript VM for all code both inside
and outside the sandbox", so an object from outside could be confused with one from inside. QuickJS
in WASM ended that class, since the object representations differ.

> **Same VM is hardening. A different engine or a different origin is isolation.** They are not
> interchangeable strength levels.

SES is therefore hardening: it holds only as long as `lockdown()` froze everything.

## Third-party browser blocks are ALLOWED

The owner's call, and the reason is structural rather than a preference: the whole point of the block
shape is that a third party can extend the product without editing us. Refusing them on the page
would carve the exception out of exactly the surface a visitor sees. Same position as Shopify —
allowed, isolated, **with the compatibility loss stated out loud** rather than pretended away.

## What we do

1. **CSP, first.** `default-src 'none'`, and `connect-src` **generated from the mounted blocks' `net`
   declarations** rather than hand-written — one fact, one source. Ship report-only, then enforce.
   It is the only control that is not applied per-secret, so it covers secrets not yet written. It is
   also, precisely, the browser-side implementation of the `net` block above — `default-src 'none'`
   is "mount nothing and you have nothing", in the browser's own words.
   A CSP violation report is also the only signal that does not require knowing in advance what to
   watch for: a block that declared no network and tried anyway is an alarm, not a log line.
2. **iframe for the widget tier**, and write the postMessage protocol that `WidgetBlock.tsx:10`
   records as deferred. The primitive is already in the tree (`McpAppCard.tsx:45`,
   `sandbox="allow-scripts"` with no `allow-same-origin`). What the block may ask the page to do
   across that boundary **is the browser-side `ctx`**, and it is unwritten.
3. **The block-install compartment is `@lavamoat/allow-scripts`, not ours to build.** The decision
   that the compartment belongs at block install (see `microsite-build.md`) is a maintained product
   elsewhere — lifecycle scripts blocked by default, explicit allowlist, the move pnpm 11 made its
   default.
4. **One vault entry on the visitor side, and a gate watching for bypass.** The structural answer to
   "someone adds a secret later and forgets": a new secret routed through the vault inherits split
   storage and a non-extractable key without its author knowing why. The gate then watches one
   entrance instead of N secrets.

**Division of labour, in one line:** the vault governs how a new secret is stored, CSP governs
whether any secret can leave, the violation report covers what we did not think of. The first two are
structure; the third is an eye.

## What we do not do

- **No in-page SES/LavaMoat runtime before CSP.** Figma walked the same-VM road and left it; it is
  hardening, and it costs a policy file to maintain. CSP is per-page and covers code nobody has
  written yet; SES is per-package and must be maintained. Since third-party libraries **are**
  allowed, SES is the eventual answer for that tier — just not the first thing built.
- **No QuickJS-in-WASM.** It serves exactly one tier — third-party code that must read and write page
  data — and we do not have that tier. If it appears, this is the answer, **not** SES.

## Two things CSP does not close

`connect-src` is per **document**, not per script, so the page's allowlist is the union of every
mounted block's `net`. Server-side each block gets its own process; in the browser one block's host
is every block's host. And `'self'` is permanently in that union, because our own SDK must reach our
backend — so a compromised library can always act as the visitor against our own API. Neither is
designable away; both belong in whatever we tell block authors.
