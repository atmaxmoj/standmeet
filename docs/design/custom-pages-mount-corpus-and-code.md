# Custom pages mount corpus and code

> **status: seed.** The mechanism below is derived from what the code already does; the
> forks in §7 are not. Read §7 before building.
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
| The outward HTTP surface is 24 flat endpoints. There is no single visitor entry. | `backend/internal/routes/public/*.go` |

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
readers. It is not a third plane and not a privilege class.

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

Today's 24 endpoints under `routes/public` grew one at a time. Each new outward client adds
its own path, and a page or a Gateway would add more. That is the shape this design refuses.

**Requirement:** there is one visitor facade. Every outward actor exits through it —
the visitor chat, a custom page, the API-key surface, and any future Gateway.

This mirrors two conventions the repo already runs on:

- outbound capability converges on the dispatcher (`dispatcher-outbound-convergence`);
- inbound host operations converge on hostdesk (`hostdesk.md`).

The visitor plane is the third convergence, and it is the one still missing. Concretely:

- **V-1** — an outward capability is declared once, and every outward facade projects it.
  Adding a facade adds no capability; it adds a projection.
- **V-2** — the facade resolves a grant to a role in exactly one place. A custom page, a code
  in chat, a BYOAI key and an anonymous reader differ only in how the grant arrives.
- **V-3** — a new outward facade (Gateway) is a new projection over the same declarations. If
  building one requires a new endpoint under `routes/public`, the convergence has failed.
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

## 7. The forks — these are decisions, not derivations

**A. How the SDK reaches the page.**

- *Bundled* — add `@standmeet/sdk` to the builder image; vite bundles it into `dist`. The page
  is self-contained and pinned to the SDK version present at build time. An SDK fix requires
  rebuilding every page.
- *Externalised* — the host serves the SDK at a fixed path; vite marks it external. Pages stay
  small and all upgrade together. A breaking SDK change breaks every page at once, with no
  rebuild to catch it.

The trade is version pinning against central upgrade. It is a real fork and it belongs to the
owner.

**B. How the grant reaches the page.**

The viewer's session already exists as a cookie or as a code in the URL. Options range from
"the page inherits whatever the browser already carries" to "the host stamps a scoped,
short-lived token into the document at serve time". These differ in what a copied page URL can
do off-instance. Decide before building; it is the security surface of the whole feature.

**C. Where the mount is declared.** On create, on write, or as its own op. Cheap either way;
pick one so there is a single home.

**D. Do the four advertised templates become real?** They are named on screen and do not
exist. Either build them — and a template that mounts corpus is the natural first one — or
stop naming them. Leaving them is the worst of the three.

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
