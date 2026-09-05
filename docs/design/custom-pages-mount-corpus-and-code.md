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
| The host serves the built files byte-for-byte from `<page_id>/<build_id>/dist`, reverse-proxied from `/p/<slug>`. | `backend/internal/routes/public/microsites.go` |
| The SDK already packages both halves the owner would want: corpus reads and an agent turn. | `sdk/packages/react/src/index.ts` — `StandMeetProvider`, `useStandMeet`, `useChatSession`, `AnswerText`, `httpPromptSource`, `httpAgentTurnStreamer` |
| The four advertised templates are translation keys. No template artifact exists, and `microsite.create` takes only slug and title. | `app/src/components/admin/sections/MicrositesSection.tsx:207` |
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
- **I-3 — no access snapshot.** What the owner withdraws stops being reachable. Withdrawal
  covers three things and all three are resolved per request, never frozen at first contact:
  the **page** (rolled back or deleted → `/p/<slug>` stops serving), the **corpus** (an entry
  unpublished → the page stops showing it), and the **grant** (a code revoked → the page's
  agent stops answering). The only thing outside our reach is the viewer's own browser cache —
  and that is the boundary precisely because everything on our side of it is not cached.

  ⚠️ **Verified gap, 2026-08-23:** the asset route sets no `Cache-Control` at all
  (`routes/public/microsites.go`), while its neighbour `page.go` sets `no-cache`. With no
  header a browser may cache heuristically, so a withdrawn page can still open on reload —
  and that is not "the browser cached it", that is us failing to say not to. Fix belongs with
  I-3, not with the browser.

### The code binding — a page is a rendering of a code

The governing sentence, and everything below follows from it:

> **A page gives a code a rendering.**

The code is unchanged: same grant, same role, same identity prompt, same meters, same
transcript. The page changes only what the reader looks at. So the correct question about any
code feature is never "does the page support it" but "**why would the page have changed it**"
— and the answer must always be that it did not.

That makes the inheritance list an invariant rather than a feature list:

> **I-5** — a session opened through a page is the same session as one opened through chat with
> the same code. Everything the code carries carries: the who's-reading name prompt, member
> count against `max_members`, turns against `max_turns_per_session`, provider metering, ghost
> policy, denials, expiry and revocation — and the conversation appears on the code's side in
> `/admin/conversations`, attributed to that code, readable by the owner afterwards.

If any of those behaves differently on a page, the page has stopped being a rendering and has
become a second channel — which is the thing this whole design refuses.

A code may be attached to **one** custom page, or to none.

- Attached: presenting that code lands on **that page** — the QR on a résumé opens the page the
  owner built for that recruiter, not the default chat. The page receives the code and its
  agent runs scoped to it, so the reader gets that code's slice of the corpus.
- Not attached: today's behaviour, unchanged — the code lands on the visitor chat.

One code, at most one page. The reverse is not constrained: a page may be reachable with no
code at all (anonymous, public slice), which is what the worked example does.

This makes the landing decision a property of **the code**, not of the page — so a page never
has to ask who is arriving, and revoking the code (I-3) withdraws the landing too.

**Visible from both ends.** The binding is one fact, so both screens read it, neither stores a
second copy: `/admin/codes` shows which page a code opens, and `/admin/microsites` shows which
code opens a page. A binding you can only see from one side is a binding people forget they made.

#### How it landed — three seams, none of them the page author's job

I-5 is only an invariant if a page author cannot break it by forgetting something. Three
mechanisms carry it, and none of them lives in page source:

1. **The landing rides on the issue receipt.** `POST /api/v1/sessions` returns
   `microsite_slug` (empty = the default chat). Both ways to redeem a code — submitting on
   `/gate`, and the identity picker after arriving with `?code=` — go through the same
   `persistSession`, so the landing is stored once and neither path can be left behind on the
   old behaviour. The code never rides the URL to get there.
2. **The page adopts the session it finds.** `useChatSession` calls `adoptStoredSession()`
   before it would issue anything: if the browser already holds a session (the gate just issued
   it), the page's agent *is* that session — same token, same conversation, same meters, same
   ledger. A page that fetched `?code=` itself would work equally well right up until an author
   forgot, and a forgotten one degrades to an anonymous session that looks identical on screen.
3. **The page's own settings are read per request.** Serving `index.html` injects
   `<meta name="standmeet-page-byoai">` from the row being served, next to the `<base href>`
   already injected. So there is no second endpoint, no snapshot, and a setting withdrawn in
   the panel is gone on the next load — the same rule as the missing cache headers (I-3).

`byoaiOffered()` in the SDK is then just `!hasVisitorGrant() && pageAllowsBYOAI()` — I-4
expressed once, where both halves are known.

### Precedence: an arriving grant wins

A page has its own access settings — reachable anonymously, and whether it offers **BYOK**
(the reader brings their own key). Those settings describe the page **when nobody presents a
grant**.

**The moment a code is attached, the code governs and the page's own settings are inert.** Its
role decides what the corpus call returns and what the agent may do; if the code does not allow
BYOK, the page's BYOK setting does not resurrect it.

Stated as the rule, because it is the kind of thing two screens will otherwise disagree about:

> **I-4** — page-level access settings apply only in the absence of a grant. A page reached
> through a code is scoped by that code, never by the page.

The panel must say so where the setting lives, or the owner will set "allow BYOK" on a page,
attach a code that forbids it, and reasonably expect the setting to mean something.

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

### 2026-08-23 — the first new face tested this, and found the rule was convention

Building the **visitor MCP face** (`/mcp/visitor`, bearer = an access code) was the first time
V-3 was actually exercised, and it exposed the gap between what this section claimed and what
was enforced:

- The **assembly** convergence was real. The face needed no new capability and no new endpoint
  under `routes/public` for chat — it reuses `AssembleVisitorBundle` / `AssembleVisitorForTool`
  and the ordinary session. V-3 held.
- The **parity** convergence was not enforced for it. `apiFacade()` was the only registered
  outward facade profile; `FacadeChat` was a reserved name. A face could be written, mounted and
  shipped without appearing anywhere in `ManifestOutward()`'s conformance — which is exactly what
  the first version of it did.

So V-1 and V-4 were true of `api` and true as intent, but nothing made them true of a *new*
face. The fix is registration, not exhortation: `FacadeMCPVisitor` + `mcpVisitorFacade()` +
`MCPVisitorMissing()`, mirroring the api ratchet.

**What each check actually proves** — worth stating, because two of the three are weaker than
they look:

| check | catches | does not catch |
|---|---|---|
| `TestOutward_MCPVisitorRatchet` | a new outward op added to the manifest without a renderer | a face mounted with the wrong list — both sides read `APIRenderableTools()` |
| `TestOutward_OwnerOpOnMCPVisitorIsLeak` | an owner capability rendered on the visitor face | nothing about what is live |
| `visitor-mcp.spec.ts` `tools/list` | a mis-mounted or over-filtered live face; an owner tool reaching the wire | manifest-level drift |

Only the third asks the running system. The leak test is the one that justifies registering the
facade at all: the owner MCP face and the visitor MCP face live in one process and differ by a
URL prefix, so "an owner op renders to a visitor" is a plausible mistake, not a theoretical one.

**Still open:** a real-env item driving this face with an actual desktop client. The e2e proves
the protocol; it does not prove Claude Desktop connects.

**Note on scope.** V-1..V-4 describe the destination. This design does not require the 24
endpoints to move in one change; it requires that the microsite mount be built **on** the
facade rather than beside it, so the count stops growing.

## 5b. Authoring belongs on the panel too

The owner-plane rule is **completeness**: every owner op renders on every owner facade
(`facade-parity.md`). Custom-page authoring does not — `microsite.list` is on admin, and
`create` / `write_file` / `build` / `get_build` / `promote_to_staging` / `promote_to_live` /
`rollback` / `delete` are MCP-only.

That is registered as a deliberate exception, and **its reason is circular**:

> `fp.Only("authoring a custom page means writing code and driving the sandbox builder; the
> panel has no such surface", "mcp")` — `internal/owner/ops/microsites.go`

"The panel has no such surface" describes the state it is being used to justify. Worse, it is
encoded where the ratchet reads it, so the gate stops reporting the gap. This is the same shape
as F-C-47 (an uploaded connector with nowhere to enter credentials) and F-C-57 (an exposure
switch with nowhere to complete the grant): **the capability is whole, the face is missing.**

**Requirement:** the panel carries authoring. The owner pastes source, builds, watches the
build, and promotes — from `/admin/microsites`. The exception is removed rather than reworded,
so the ratchet demands the routes and keeps demanding them.

The MCP path stays. This is parity, not migration: the owner drives it from Claude when that is
convenient, and from the panel when that is.

## 6. What "mount" looks like to the owner

The lifecycle stays MCP-driven — that decision already holds and the admin panel already says
so. Mounting is a page property the owner sets alongside the source:

- `microsite.set_mounts { slug, corpus: bool, code: bool }`, or the same two fields on
  `microsite.create` / `.write_file`. The exact op shape is fork C.
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
host keeps every page's source (`microsite.write_file`), so rebuild-all is mechanisable —
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

**C. Where the mount is declared — nowhere. The import is the mount.**

This was going to be `microsite.set_mounts { slug, corpus, code }`. Building it showed the op
is not needed: vite bundles what the entry reaches, so a page that does not import
`@standmeet/sdk` ships none of it, and a page that imports it has mounted it. The opt-in the
requirement asked for is expressed by the source itself.

Nothing is lost by dropping it, because the flag was never a security gate — I-1 and I-2 hold
regardless of who imports what, since the page can only ever obtain the viewer's own grant.

What a `set_mounts` op would still buy is **owner visibility**: the admin list saying which
pages reach the corpus. That is worth having and is a different, smaller feature — a read over
the stored source, not a switch.

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

The audit item for `microsites` currently proves the lifecycle. It cannot prove any of the
above, because the page it builds renders one heading. Add:

- a page that mounts corpus, viewed **anonymously**, shows the public slice and nothing else;
- the same page, viewed with a code that grants more, shows more — same build, same URL;
- a page that mounts code holds a real turn and renders the answer;
- a page that mounts neither issues **zero** requests to the facade;
- the negative that matters: a page cannot read what the viewer's role cannot read. Prove it
  with a corpus entry that is private, and assert on the page, not on the API.

The last one is the invariant. If only the first three exist, a page that leaks the owner's
private corpus passes the suite.

**The existing coverage is three tests** — the happy lifecycle, a "no dead button" check, and
staging→live→delete — plus one path-traversal test. Nine ops, and **not one failure case**.
Missing, and each is a case an owner will actually hit:

- a build that **fails** (source that does not compile) — the owner must be told what broke,
  and the live page must not change;
- promoting a build that is not built;
- `rollback` — and after it, `/p/<slug>` stops serving (I-3);
- delete while live — same;
- a slug that already exists;
- a page that imports the SDK — nothing covers this at all today;
- **withdrawal takes effect (I-3)**: unpublish a corpus entry the page shows, reload, it is
  gone; revoke the code the page carries, and its agent stops answering;
- **the code binding**: a code attached to a page lands there; the same code with the page
  detached lands on chat; a code cannot be attached to two pages; the binding reads the same
  from `/admin/codes` and from `/admin/microsites`;
- **precedence (I-4)**: a page with BYOK enabled, reached through a code that forbids it, does
  not offer BYOK. Assert on the page — asserting the stored setting proves nothing, since the
  defect is that the setting is honoured when it should be inert;
- **inheritance (I-5)** — the set that decides whether a page is a rendering or a second
  channel. Each of these is a case, not a bullet on a checklist:
  - the **who's-reading** prompt appears on the page and the name reaches the transcript;
  - a second reader on the same code counts against `max_members`, and the page refuses past it;
  - turns count against `max_turns_per_session`, and the page says so when the allowance is out;
  - the conversation is **visible on the code's side**: it appears in `/admin/conversations`
    attributed to that code, with the page's turns in it — an owner must not have to guess
    which surface a transcript came from;
  - revoking the code mid-session stops the page's agent (I-3);
  - provider metering and ghost policy behave as they do in chat.

  **Write these against chat as the oracle**, not against fresh expectations: the assertion is
  "the page does what the same code does in chat", so a change to code semantics moves both at
  once and cannot drift into a page-only branch.

The failure cases are the ones that decide whether an owner trusts the panel. A build that
fails silently and leaves the old page up is indistinguishable, from the owner's chair, from a
build that worked.

## 10. Build order

Four slices. Each is separately verifiable, and the order is a dependency order, not a
preference.

**S1 — nothing to build.** The outward plane is already declared, projected and direction-
enforced (§1, §5). S1 is a **check**, not a slice: confirm a page needs no new outward op and
no new endpoint. If at any point in S2–S4 the answer is "add a route under `routes/public`",
stop — that is the convergence failing, and the fix is upstream in `ManifestOutward()`.

**S2 — the page can carry a session. ✅ built.** The SDK closure is staged into the builder
image (`infra/scripts/builder-vendor.sh`), so `import "@standmeet/sdk"` resolves. No mount flag
was needed — see fork C.

**S3 — corpus mount. ✅ built.** A page reads pinned corpus with `fetchPage`, opens an entry
with `fetchWikiLanding`, and holds an anonymous turn with `useChatSession`, all through the
existing chat facade. Driven on prod: `corpus_search` ×2, `corpus_read` ×4 against real notes,
4039-character answer. The §9 negative — a page cannot read what the viewer's role cannot —
is **not yet guarded**, and is the next thing to write.

**S4 — one real template, and the false labels removed.** The worked example exists
(`docs/design/examples/reading-room.App.tsx`); promoting it to a selectable template and
removing the three labels that name nothing is still open.

**S4 is not decoration.** The acceptance for this work is a page with real function — corpus
on it, an agent on it, and a design that someone would actually publish. A page that renders a
heading proves the lifecycle and nothing else; that is what the current audit shot shows, and
it is why this document exists.
