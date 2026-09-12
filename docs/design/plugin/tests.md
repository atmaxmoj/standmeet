# Tests

Status: **2026-09-09.** What the existing suite does under this change, and what the design owes.
Counted across 614 e2e specs.

The discriminator throughout: **does a spec assert the subtractive rule, or a product truth?** The
first changes by design. The second must stay green from the first commit to the last, and is the
safety net.

## 1. Red by design — they encode the rule that is being replaced

```
acl-block-matrix.spec.ts     "pure AND-with-code-deny truth table",
                                  exhausting role-granted? × code-deny? over four rows
acl-global-master.spec.ts         "global is the top-level ban master: can only narrow,
                                  never widen"
block-enable-disable.spec.ts states its own model in the preamble:
    exposed = exists(origin) ∧ owner_enabled ∧ connector_deps_met ∧ role_acl ∧ quota
```

Five conjuncts become one sentence: **mounted, or not mounted** (`access-control.md`).

These must be rewritten **deliberately**, as the product rule changing — never edited to make a run
go green. A rewrite that quietly weakens an assertion here removes the only check on the ACL model.

## 2. Green throughout — the safety net

`supplier-provider-agnostic.spec.ts` is the single most valuable guard for this migration:

> install a **non-Google** calendar connector (CalDAV, kind=protocol) into the `calendar` category
> slot → a session granted `calendar.book` still assembles `calendar_book`, and booking actually
> works

That is precisely the definition/provider seam this design is built on: swap the provider, the
consumer is untouched. It should be green at every commit of the migration.

Same class, same treatment:

| spec | the product truth it holds |
|---|---|
| `supplier-retry-invalid-grant-no-retry` | an `invalid_grant` must not be retried — becomes the `retry` block's criterion |
| `connector-scope-readback` | a refresh that omits `scope` must leave granted scopes byte-identical |
| `connector-booker-handle-no-leak` | credentials never reach the consumer — the `credentials` block's central claim |
| `block-dependency-greyed` | the owner is told *"needs Google Calendar — not connected"*. The assertion survives; the mechanism becomes a mount failure |

Reading durable state is **not** implementation coupling. The suite is largely
architecture-independent, which is what makes it usable as the net.

### The microsite side has its own net

19 microsite specs (the other 18 matching "composer" are the résumé composer and the chat input —
a different feature). The load-bearing one is `microsite-design-system.spec.ts`, and it checks the
**mechanism**, in its own words: *"Tailwind processed the tokens and the fonts loaded, not just that
the file built."*

```ts
const font = await line.evaluate((el) => getComputedStyle(el).fontFamily);
expect(font.toLowerCase(), 'font-serif must map to the Newsreader token').toContain('newsreader');
```

It sits exactly where this design cuts: today the fonts and Tailwind are **hard-coded into
`builder/template/theme.css`**. Once a font arrives inside a block, the assertion survives and the
mechanism underneath it changes — which makes it the microsite-side equivalent of
`supplier-provider-agnostic`.

## 3. Owed — the design's own claims have no tests

> **Status 2026-09-10: seven of the nine are written and GREEN**, on the real stack, every owner
> action driven by clicking. One row is withdrawn (below); one belongs to the microsite workstream
> and is still owed. The specs are `e2e/test/block-*.spec.ts`.
>
> They were written **before** the substrate that satisfies them and were red for days, which is the
> only way a guard's green carries information. Two of them earned that during this build: the
> ACL row failed on an assertion that could not distinguish "the code carries the bundle" from "the
> code's label happens to be the bundle's name", and tightening it to a control that exists only
> once a bundle is really attached is what exposed the frontend dropping the field entirely.

| claim | how it fails |
|---|---|
| ~~**blocks stack**~~ | **Withdrawn 2026-09-10.** The flagship was `retry` wrapping `google-calendar`; the owner overruled it — each block does its own retry — so there is no wrapping to demonstrate. What survives is the seam relation, and it already has a spec on the real stack: `supplier-provider-agnostic` swaps CalDAV in for Google with no consumer touched. No new test is owed. |
| **adding a block costs no code** ✅ | a fixture block that exists only as data appears in the admin with its settings form rendered from its `Config` schema. **This is the acceptance test for the whole design** — `block-costs-no-code` |
| **omission fails closed** ✅ | a block that mounts no `net` attempts an outbound call and cannot make it — `block-omission-fails-closed`. Note what its second case does **not** assert: the sentence the visitor reads is written by the model, and the e2e model is a mock, so pinning wording would test the mock. It asserts the turn survives the caged block's failure and leaks none of the machinery |
| **unmount is immediate** ✅ | removed from the bundle → the tool is uncallable at once; a call in flight fails (`block-model.md`) — `block-unmount-is-immediate` |
| **failure has three faces** ✅ | tool absent from the list · the visitor gets an honest "I can't" · the owner gets a persistent entry naming the block, with the child process's stderr — `block-failure-three-faces` |
| **the ACL answer is a list** ✅ | "what can this code do" is read, not simulated over three layers — `block-acl-is-a-list` |
| **wrapping runs no install scripts** | wrap a package that carries a `postinstall`; assert that script did not execute (`microsite-build.md`). **Still owed** — microsite workstream |
| **one realm per session** ✅ | two sessions run side by side, each seeing only its own tools; the registry is not copied — `block-realm-per-session` |
| **a page uses something we did not ship** | a microsite mounts a block carrying a font or a chart library that is not one of `builder/package.json`'s six, and the built page resolves it — checked the way `microsite-design-system` checks Newsreader, through computed style, not through "the build succeeded". **Still owed** — microsite workstream |

### Two traps in writing these

**Do not write them as absence assertions.** Half the rows above read naturally as "the tool is not
there", and a spec that asserts absence also passes when the page rendered nothing at all. Fetch the
tool list and assert its contents.

**Prove each guard can go red.** A new guard's first green means nothing until the mutation that
should break it has been shown to break it. This has already bitten once here: a test of realm
isolation stayed green when `Isolate` was broken, because duplicate providers were being resolved by
registration order — the weakness was in the design, and only the mutation found it.

*Both traps were sprung during the build, which is the reason to keep them written down.* The
absence trap: three rows first read `.not.toEqual([...])` alone and would have passed on a session
that assembled nothing — each now names the block that must survive alongside the one that must go.
The red-first trap: the assertion that a code carries its bundle was `toContainText(bundle)`, and the
code's **label** is the bundle's name too, so it went green against a code carrying nothing. The
defect it was hiding was real — the frontend's `toCreateBody` rebuilt the request field by field and
dropped `bundle` — and it only surfaced once the assertion named a control that exists solely when a
bundle is genuinely attached. **A string that could have come from two sources proves neither.**
