# Custom pages mount corpus and code

> **status: ready to build.** Every decision in §7 was settled by reading the code, and the
> evidence is recorded there. One item is left to the owner and is marked.
>
> Companion to `facade-directions.md` (two trust planes) and `platform-architecture.md`
> (row G: page hosting → SDK + sandboxed page hosting).

## 1. What is true today

Verified by reading, 2026-08-22:

| Fact | Where |
|---|---|
| A built page is plain static output. The sandbox installs `react`, `react-dom`, `vite`, `@vitejs/plugin-react` — nothing else. | `builder/package.json` |
| The scaffold mounts the owner's default export and does nothing else. | `builder/template/src/main.tsx` |
| The host serves the built files byte-for-byte from `<page_id>/<build_id>/dist`, reverse-proxied from `/p/<slug>`. | `backend/internal/routes/public/custom_pages.go` |
| The SDK already packages both halves the owner would want: corpus reads and an agent turn. | `sdk/packages/react/src/index.ts` — `StandMeetProvider`, `useStandMeet`, `useChatSession`, `AnswerText`, `httpPromptSource`, `httpAgentTurnStreamer` |
| The four advertised templates are translation keys. No template artifact exists, and `custom_page.create` takes only slug and title. | `app/src/components/admin/sections/CustomPagesSection.tsx:207` |
| The outward plane already converges. Outward ops are declared once; two outward facades (`chat`, `api`) project them; direction is enforced so the planes cannot mix. | `backend/internal/infra/paritymanifest/manifest_outward.go`, `internal/infra/facadeparity` |
| Chat and the API-key facade assemble through the same registry, so ACL / denial / quota behave identically by construction. | `capreg.Registry.AssembleVisitor*`, `capload/api_key_toolset.go` |

So: an owner can host a page, and that page can render text. It cannot read one line of the
owner's corpus, and it cannot ask the owner's AI anything. The capability exists one directory
away and is unreachable from inside the sandbox.

## 2. What this asks for

A custom page can **mount** two things, each optional and independent:

- **corpus** — read the owner's published corpus: list, search, read one entry.
- **code** — an agent turn: ask, stream tokens back, render the answer.

"Mount" means the page opts in per page, not per instance. A page that mounts neither stays
exactly what it is today: static output, no network, no session.

## 3. The model: a custom page is an outward-plane client

`facade-directions.md` names exactly two planes. A custom page belongs to **outward**, with
every other visitor: humans in chat (code / BYOAI), programs holding an API key, anonymous
readers, and — when they are built — the IM bridge and a Gateway. It is not a third plane and
not a privilege class.

The point of the convergence is that this list can keep growing without the surface growing:
chat today, pages next, IM later. Each is a **projection** of one set of outward capabilities,
so a capability is declared once and every client gets it, and a client is added by writing a
projection rather than by adding endpoints.

The consequence is the whole design:

> **A custom page never carries more scope than the visitor looking at it.**

The page is markup the owner wrote. The **viewer** is who the grant belongs to. So a page that
mounts corpus resolves a role the same way every other outward actor does — access code, BYOAI
key, or the implicit public role for anonymous — and reads exactly what that role may read.
`published` still gates. The corpus ACL still gates. The page is a lens, never a bypass.

State it as an invariant, because it is the thing that can silently go wrong:

- **I-1** — a call made from `/p/<slug>` is indistinguishable, at the facade, from the same
  call made by the visitor chat with the same grant.
- **I-2** — hosting a page grants nothing. If the owner publishes a page that reads corpus and
  hands the URL to a stranger, the stranger sees the public slice, not the owner's slice.

## 4. Why the SDK cannot simply be added to the sandbox

Making `@standmeet/sdk` resolve is necessary and not sufficient. The SDK talks to an origin
over HTTP and needs to know two things the page cannot invent: **which instance** and **which
grant**. Today `StandMeetProvider` takes a `baseURL`; a page served from the instance itself
should not have to be told its own origin, and must not be able to point itself at a different
one and carry the viewer's grant there.

So the mount is a **host contract**, not an import:

1. The host injects the origin and the current grant into the page's document (see §7 fork B
   for how).
2. The page imports the SDK and calls hooks. It never sees a token it could exfiltrate beyond
   what the browser already sends.
3. Every call lands on the **visitor facade** (§5), which resolves the grant to a role and
   applies the same ACL as chat.

## 5. The visitor facade — one exit

**This section originally claimed the convergence was missing. It is not — that claim was
made by counting route files, and most of `routes/public` is static and meta (robots.txt,
sitemap, appearance.css, output, report), not capability surface. Only four files dispatch
capabilities, and they already share one assembly.** The correction matters, because building
"the visitor facade" would have rebuilt `facade-directions.md`, which is already implemented.

What is actually true: the outward plane converges at the capability layer. Outward ops are
declared once in `ManifestOutward()`; `chat` and `api` are projections; `facadeparity.Conform`
refuses to let an owner-plane op render outward. A custom page therefore needs **no new
facade** — it is a client of the existing `chat` facade, reached the same way the embed already
reaches it cross-origin.

So this section states a **rule to keep**, not work to do. The invariants below are what stop
the next client from growing the surface — and they are the acceptance test for IM and Gateway
when those are built:

- **V-1** — an outward capability is declared once, and every outward facade projects it.
  Adding a facade adds no capability; it adds a projection.
- **V-2** — the facade resolves a grant to a role in exactly one place. A custom page, a code
  in chat, a BYOAI key and an anonymous reader differ only in how the grant arrives.
- **V-3** — a new outward client (custom page, IM bridge, Gateway) is a new projection over the
  same declarations. If building one requires a new endpoint under `routes/public`, the
  convergence has failed. This is the test to apply when IM is built: if the IM bridge needs
  its own `/im/turn`, stop and fix the facade instead.
- **V-4** — the parity ratchet covers the outward plane by role-consistency, as
  `facade-directions.md` specifies. A capability grantable to a role renders on every outward
  facade unless the class is explicitly excepted, and the exception is written down.

**Note on scope.** V-1..V-4 describe the destination. This design does not require the 24
endpoints to move in one change; it requires that the custom-page mount be built **on** the
facade rather than beside it, so the count stops growing.

## 6. What "mount" looks like to the owner

The lifecycle stays MCP-driven — that decision already holds and the admin panel already says
so. Mounting is a page property the owner sets alongside the source:

- `custom_page.set_mounts { slug, corpus: bool, code: bool }`, or the same two fields on
  `custom_page.create` / `.write_file`. The exact op shape is fork C.
- The admin list shows what each page mounts, because a page that reads corpus is a page the
  owner should be able to notice at a glance.
- A page that mounts nothing must not ship the SDK at all. A static page stays static and
  small; mounting is what pulls the runtime in.

## 7. Decisions

Each of these looked like an owner call. Reading the code settled all but one.

**A. How the SDK reaches the page — bundled.**

Add the SDK to the builder image and let vite bundle it into `dist`.

Evidence for rejecting the alternative: externalising needs the host to serve a shared SDK
asset, and **the host serves no such asset today**. When the audit drove `sdk-embed`, the rig
built `dist/embed.global.js` and served it from a separate static server on another origin
(`e2e/manual-runs/2026-08-07T0027/trajectory/sdk-embed/sdk-embed.md`). So "reuse what is
already served" is not available; externalising means building a new served path and a
version-skew story, while bundling means adding one workspace dependency beside `react` in
`builder/package.json`.

Bundling also preserves the current serving model exactly: a built page stays a self-contained
directory of static files, with no runtime dependency on a host asset path.

*The cost, stated so nobody is surprised:* an SDK fix does not reach already-built pages. The
host keeps every page's source (`custom_page.write_file`), so rebuild-all is mechanisable —
build it when the first SDK fix needs it, not before.

**B. How the grant reaches the page — the page issues a session, like every other client.**

No host-injected token, no new mechanism. The embed web component already does exactly this:
it reads an optional `code` attribute and calls `issueSession({ mode, code })`, then uses the
returned `session_token` for turns (`sdk/packages/embed/src/embed.ts:187-194`). Anonymous is
the same call without a code.

A custom page is a strictly easier case than the embed, because it is same-origin. It carries
the code the same way every visitor surface does — in the URL — and the facade resolves it to
a role. **This is what makes I-1 and I-2 true rather than aspirational**: the page has no way
to obtain a grant the viewer does not already have.

**C. Where the mount is declared — on the page, read at build.**

The mount changes what the build emits, so it must be known when `custom_page.build` runs. It
is a property of the page, not of a file or of one build. One op, one home:
`custom_page.set_mounts { slug, corpus, code }`.

**D. The four advertised templates — build one, stop naming the rest.**

They are translation keys with nothing behind them (§1). Naming four things the owner cannot
obtain is the failure mode this repo already has a name for. Ship **one** real template — the
one that mounts corpus, since that is the case worth demonstrating — and remove the other
three labels until they exist.

**Open, and it is yours:** what the first real template should *be*. `press-kit` was the
placeholder name. A press kit that pulls the owner's published corpus is a plausible first
page, but so is a reading list or a "what I'm working on" page. This decides what the example
in §9 looks like, and it is a product-taste question, not a mechanism one.

## 8. Non-goals

- Not a page builder UI. The lifecycle stays MCP-driven.
- Not arbitrary server-side code. The page is still static output; "code" means an agent turn
  through the facade, not execution on the host.
- Not a second ACL. If a page needs a rule the corpus ACL cannot express, that is a corpus ACL
  gap and belongs there.

## 9. How this gets verified

The audit item for `custom-pages` currently proves the lifecycle. It cannot prove any of the
above, because the page it builds renders one heading. Add:

- a page that mounts corpus, viewed **anonymously**, shows the public slice and nothing else;
- the same page, viewed with a code that grants more, shows more — same build, same URL;
- a page that mounts code holds a real turn and renders the answer;
- a page that mounts neither issues **zero** requests to the facade;
- the negative that matters: a page cannot read what the viewer's role cannot read. Prove it
  with a corpus entry that is private, and assert on the page, not on the API.

The last one is the invariant. If only the first three exist, a page that leaks the owner's
private corpus passes the suite.

## 10. Build order

Four slices. Each is separately verifiable, and the order is a dependency order, not a
preference.

**S1 — nothing to build.** The outward plane is already declared, projected and direction-
enforced (§1, §5). S1 is a **check**, not a slice: confirm a page needs no new outward op and
no new endpoint. If at any point in S2–S4 the answer is "add a route under `routes/public`",
stop — that is the convergence failing, and the fix is upstream in `ManifestOutward()`.

**S2 — the page can carry a session.** SDK into the builder image, `set_mounts`, and the build
emitting the SDK only when a mount asks for it. Done when a page that mounts nothing issues
zero requests, and a page that mounts `code` holds a real turn through the facade.

**S3 — corpus mount.** `useStandMeet` reads through the same facade with the same role. Done
when the anonymous / coded / private-entry triple in §9 holds — the private-entry negative is
the one that must be written first.

**S4 — one real template, and the false labels removed.**

**S4 is not decoration.** The acceptance for this work is a page with real function — corpus
on it, an agent on it, and a design that someone would actually publish. A page that renders a
heading proves the lifecycle and nothing else; that is what the current audit shot shows, and
it is why this document exists.
