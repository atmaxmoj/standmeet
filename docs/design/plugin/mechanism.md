# The mechanism, measured

Status: **seed / 2026-09-09.** Findings from reading `dsh`'s kernel, not a proposal.

Everything here was read from `~/Develop/reference/deepseek-harness`. Line counts and commit counts
are from that clone.

## The one property that matters

A plugin architecture is not interesting because it "has plugins". It is interesting when **a block
can host a block** — when the interface a block *receives* is the same one it can *offer*. Otherwise
the interface lives at the root, every plugin is a leaf, and you have a star.

Cordis hands a plugin a `ctx`. Every way of deriving one returns the same type:

```ts
extend(meta = {}): this
isolate(name: string, label?: symbol): this
intercept<K>(name: K, config): this
```

and `ctx.plugin()` — "mount a plugin under me" — exists on all of them. The stud and the socket are
the same object, nesting is unbounded.

## Four properties, and what each costs

### 1. A block declares what it needs and what it offers — nothing registers it

```ts
export class E2BFileSystem extends FileSystem {   // provides the `fs` service
  static inject = ['e2b']                          // consumes the `e2b` service
  …
}
```

That file is 628 lines; those are the only two that make it composable. The other 626 are
filesystem business. **Neither direction mentions a registry, and no line anywhere sequences the
two.** Provision is a side effect of the base class's constructor; requirement is a static field.

**Cost: two lines per block.** This is the number that decides whether the shape is worth adopting.

### 2. Load order is derived, not configured

A fiber (the runtime handle for one loaded plugin) starts in `PENDING` and does not run its body
until every injected service exists. `dsh-base`'s config header states the consequence:

> "Row order carries no load semantics (activation is service-availability driven); the grouping is
> for readers."

So the config file's order is cosmetic. Nobody writes "A before B".

**What this replaces for us:** the hand-sequenced composition root, and the class of bug recorded in
`owner-mcp-deps-capture-ordering` (the connector dispatcher must initialise before
`buildPluginRegistry`). That constraint becomes unrepresentable rather than remembered.

### 3. Mounting is reversible, and unloading cascades

Every registration is made through `ctx.effect()`, which takes the inverse as its return value. On
unload the inverses run in reverse order; `splice(0)` makes a second call a no-op; once one disposer
returns a promise the rest chain behind it. Two guards are worth stealing verbatim:

- **`epoch`** — an in-flight async setup checks `runner.epoch !== oldEpoch` and abandons itself, so
  a reload cannot be poisoned by the previous generation's slow work landing late.
- **`INACTIVE_EFFECT`** — `ctx.effect()` throws while a fiber is unloading: *"cannot create effect on
  inactive context"*. Teardown cannot grow new work to tear down.

And the cascade: when a provider is unloaded or replaced, every fiber that injected it returns to
`PENDING`, **runs its disposers**, and re-enters when the service comes back. A dependent never
holds a dead reference.

### 4. One name, many instances — the realm

Sessions all want `ctx.planMode`, `ctx.tools`, `ctx.compaction`: the same names, each needing its
own. A group declares `isolate: <name>: true` and below it that name resolves privately.

```yaml
- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true          # one private instance per mounted session
```

Three semantics: `true` = entry-local (one instance per mount); a shared **label** = pooled across
every group naming it; **omitted** = the root realm, i.e. process-global — and
`dsh-agent-presets` **refuses that at mount**.

Mechanically it is a parent-linked map of name → symbol, and one comparison:

```ts
// context.ts — create a realm
isolate(name, label?) {
  const shadow = Object.create(this[symbols.isolate])
  shadow[name] = label ?? Symbol(name)
  return this.extend({ [symbols.isolate]: shadow })
}

// service.ts — a consumer sees this service iff the labels match
filter(ctx) {
  return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name]
}
```

**The registry is never copied per session.** One flat table; the divergence happens at lookup.

The framing in `dsh`'s own preset is better than "avoid collisions":

> "Plan state is per-agent by nature, so an entry-local realm is not a workaround here — it is the
> correct lifetime."

## Portability to Go

An early reading of `extend(): this` suggested this depends on JS prototypal inheritance and is
therefore unavailable to us. **That was too strong.** The data structure is a map with a parent
pointer plus identity comparison on an opaque token. JavaScript gets the parent link free from
`Object.create`; Go writes it out — a struct with a `parent *scope` and a lookup that walks up.

What JS gives free is the syntax, not the idea. All four properties above are expressible in Go;
none of them require the library.

## What the shape does NOT give

- **It does not remove interface design.** Each seam still needs a Service Definition. Adding a new
  *category* still means writing one — what changes is that a third party can write it in their own
  package instead of editing our composition root.
- **It does not isolate plugins.** A Cordis plugin is trusted in-process code. `ctx.sandbox` in dsh
  confines the **subprocesses a capability spawns**, not the plugin itself; stronger isolation is
  obtained by *swapping the provider* (their `e2b` packages) rather than by jailing the block. Our
  visitor-side capabilities already run out-of-process under bwrap, which is **stronger** than what
  dsh does here — and the reason our blocks cannot stack. That trade is the subject of
  `isolation.md`.
- **It says nothing about supply chain.** dsh's `plugin-inventory` is a read-only projection for the
  UI — which plugins are loaded and in what fiber state. How third-party code is allowed onto the
  machine is out of scope for the kernel, and is a separate problem.

## Evidence that the shape survives contact

- The kernel is **2,693 lines** across nine files.
- In 16,351 commits it was touched **14 times**, with **zero breaking changes**. Of the 26 breaking
  changes repo-wide: 8 `cli`, 5 `session`, 2 `apiproxy`, 0 kernel. Churn lived at the edges.
- It was **not written for dsh** — it arrived in a commit titled *"Vendor Cordis framework packages
  as source"*. Cordis is shigma's meta-framework, extracted from Koishi, where hundreds of
  third-party plugins had been isolating and hot-replacing each other for four years.
- A TUI lived 18 days and was deleted nine days before open-sourcing. What went with it was
  `apps/cli/config/tui.cordis.yml` — 110 lines. **A whole product surface was a config file, and
  removing it touched no kernel.** That a surface can be removed cleanly is better evidence of
  composability than any claim in a README.
