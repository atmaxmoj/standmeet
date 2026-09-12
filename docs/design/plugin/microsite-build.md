# The microsite build

Status: **2026-09-09.** Where node packages come from, what is built, and where the supply-chain
compartment belongs. Assumes `block-model.md`'s vocabulary.

**A microsite is not a plugin.** It is an artefact the owner authors, which is served, and which
*uses* blocks. Conflating the two — as an earlier draft did — hides that the two compartments differ
in every dimension that matters:

| | capability compartment | microsite **build** compartment |
|---|---|---|
| what runs inside | one MCP server | a bundler plus a dependency tree |
| lifetime | one call | tens of seconds, once per build |
| threat | a visitor steering the model into over-reach | build-time supply chain — a transitive `postinstall` |
| exists today | **yes**, bwrap | **no** |

## The node packages arrive WITH the block — DECIDED

The owner's framing: *"microsite 要 load node 包、字体什么的也能用上，这个就是我说的 plugin 的应用，
plugin 带着这些功能能挂上 microsite."* A microsite does not acquire dependencies. **A block carries
its own, already built, and mounting the block onto the microsite brings them along.**

**Half of this is already in the tree** — checked, not assumed. `builder/Dockerfile` does not
`npm install` the SDK; it drops the built dist into `node_modules`, and says why:

> `COPY vendor/@standmeet ./node_modules/@standmeet`
> "Dropped into node_modules rather than npm-installed so `import '@standmeet/sdk'` resolves by
> name, exactly as react does."

That is the block shape, with exactly one block in existence: ours.

**And today's defect is the connector defect, verbatim.** `builder/package.json` lists six
dependencies and `RUN npm install` freezes them into `/opt/builder/node_modules` at *image* build
time. An owner who wants a font or a chart library needs us to change the image and cut a release —
"adding a category means editing our composition root", one axis over. Star topology; third parties
are leaves.

What changes: **the vendor set is assembled per composition** instead of frozen in the image.
Whichever blocks the owner mounted, materialise places those blocks' dists.

Three consequences:

1. **The dedup cost changes magnitude, and not by sharing a store.** A block is built **once in its
   life** — at publish or install time, by its author or by that one install action — not once per
   microsite build. N pages × M builds collapses to M blocks × one. The shared thing is a finished
   immutable artefact, which the sharing rule already permits; no writable store, no hole in the
   bulkhead.
2. **`postinstall` moves house.** From "every microsite build" to "**installing a block**, once".
   That is where the compartment belongs. It is a better site in every way: one-shot, explicitly
   triggered by the owner, and a failure damages no already-published page. The implementation is
   `@lavamoat/allow-scripts` (see `isolation.md`), not ours to build.
3. **A font is an asset the block carries.** It ships inside the block's dist, so the block needs no
   runtime `net` — which is what "`net` is an atomic block you must explicitly mount" is for: a
   font-only block that mounts no `net` is visibly unable to reach out.

## Wrapping an npm package as a block — DECIDED 2026-09-09

The owner's words: *"把 npm 包包成 plugin 让 microsites 用."* The owner never writes a
`package.json`, never names a dependency, never knows which npm package is underneath. He mounts a
block called "charts" and the page can draw charts.

**Wrapping is one directory, produced once:**

1. install the package **with lifecycle scripts off** — this is the only step where npm's 0-day
   surface exists, and it is over in one shot;
2. build it into something a browser can load directly;
3. write the manifest — name, and whether it needs network.

**After that nothing dangerous remains.** A microsite using the block is a **file copy** into
`node_modules`, which is precisely what `builder/Dockerfile` already does for our own SDK:

```
COPY vendor/@standmeet ./node_modules/@standmeet
```

No install, no scripts, no network at build time. This is what "the compartment belongs at block
install" means concretely, and `@lavamoat/allow-scripts` is step 1's implementation.

**Who wraps.** Three routes, not exclusive:

| | |
|---|---|
| we pre-wrap a set | fonts, charts, dates — shipped with the product; the owner picks from a list |
| wrapped on the instance | the owner asks for one package, the wrapper runs once on his machine |
| someone else's wrap | a pre-wrapped directory fetched from GitHub |

**Start with the first.** It needs no new interface — wrapping two or three packages ourselves and
mounting them proves the whole path end to end.

## The owner's experience is WordPress's plugin screen

The owner's reference, and it settles a distinction the rest of this document kept blurring:
**installed is not the same as in use.** Two levels, not one.

| WordPress | here |
|---|---|
| install | the directory lands on the instance |
| activate | it is mounted into a bundle |
| place it on a page | one row in that microsite's composition |
| deactivate | removed from the bundle — **immediately** (`block-model.md`: no draining, no retry) |

The owner never sees npm, a build, or Go, the way a WordPress owner never sees PHP.

**This adds one thing to the manifest.** Every WordPress plugin has its own settings screen; ours
needs the same, so a block must be able to declare **what its configuration looks like**, and the
admin renders a form from that. Without it an owner installs a calendar block and has nowhere to say
which calendar.

**And one WordPress failure mode is already designed out.** A bad WordPress plugin can white-screen
the whole site, because plugins hook into everything. Here a block that fails to mount is simply
absent — the section is gone, the page still serves, and the owner gets a loud, persistent
diagnosis. That is the failure rule in `block-model.md`, and it needs no extra work.

## What still gets built

Most microsites have **no build to compartmentalise**: a composition of blocks is data, and the
blocks ship built. A build exists only where the owner wrote code of their own, and by then the
compartment's job is "read read-only files, write one `dist`" — which bwrap covers, at millisecond
start-up. Packages carrying native binaries stay **unsupported**, stated plainly.

## Why Vercel is the wrong reference class — DECIDED

Researched then rejected as too heavy. From their docs: each build gets its **own isolated virtual
machine**, provisioned on demand and **destroyed after**; the dependency cache is **restored before
installation begins**; stated limits are 45 minutes wall clock, 8 GB memory, 32 GB disk, 2–4 vCPU,
with pre-warmed containers to hide provisioning.

Three properties are the design, and they are separable from the primitive:

1. **One compartment per build, destroyed after.** Not reused, not shared.
2. **The cache is restored as a copy, per project.** Never a mounted shared store — which is what
   would otherwise be the lateral path between compartments.
3. **What is shared is the immutable part**: the pre-warmed base image with the toolchain.

That confirms the rule the vault note `untrusted-build-bulkhead` already carried: **share what
cannot be written, copy what can.**

But the cost above is the cost of isolating **mutually hostile tenants**. We are single-owner: the
bulkhead is "the owner's dependency tree vs the instance that hosts it", which is the *other*
bulkhead, and the one that does not need a microVM.

## The lighter family, and why it is a footnote

Deno Deploy and Val Town resolve dependencies as **HTTP ESM URLs** — esm.sh transforms an npm package
to standard ES modules with esbuild on the CDN side, so importing a pinned URL is the whole
mechanism. Deno's own docs list **"lack of install hooks"** among that path's limitations, which is
exactly the property a compartment is built to obtain. The general lesson is worth keeping:

> The strongest form of "make the dangerous phase safe" is to arrange for the phase not to exist.

But it does not apply to us, **because blocks carry built dists**: we never resolve npm at build or
run time. esm.sh is therefore *one way a block author may build their block*, not a service we host
and not a dependency of ours.

## Still to specify

- The exact read/write set for the owner-code build compartment, and its CPU and wall-clock limits.
- Whether `builder/package.json`'s six (react, vite, tailwind and friends) become blocks or stay the
  floor. Leaning **floor** — they are what every block reads and are identical for all of them,
  which is precisely what the sharing rule allows to be shared.
